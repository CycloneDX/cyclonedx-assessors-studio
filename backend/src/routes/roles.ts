import { Router } from 'express';
import { clampPagination } from '../utils/pagination.js';
import { auditMutations } from '../utils/audit.js';
import type { Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import { asyncHandler, handleValidationError } from '../utils/route-helpers.js';
import { logger } from '../utils/logger.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission, requireSession } from '../middleware/auth.js';
import { toSnakeCase } from '../middleware/camelCase.js';

const router = Router();
router.use(auditMutations('role'));

const createRoleSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  permissionIds: z.array(z.string().uuid()).optional(),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  permissionIds: z.array(z.string().uuid()).optional(),
});

router.get('/', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();
  // Clamped: negative/fractional values used to reach SQL and 500 (I8).
  const { limit, offset } = clampPagination(req.query as Record<string, unknown>);

  const total = await db
    .selectFrom('role')
    .select(db.fn.count<number>('id').as('count'))
    .executeTakeFirstOrThrow()
    .then(r => r.count);

  const roles = await db
    .selectFrom('role')
    .selectAll()
    .limit(limit)
    .offset(offset)
    .execute();

  const rolesWithCounts = await Promise.all(
    roles.map(async (role) => {
      const permCount = await db
        .selectFrom('role_permission')
        .where('role_id', '=', role.id)
        .select(db.fn.count<number>('permission_id').as('count'))
        .executeTakeFirstOrThrow()
        .then(r => Number(r.count));

      return {
        ...role,
        permissionCount: permCount,
      };
    })
  );

  res.json({
    data: rolesWithCounts,
    pagination: {
      limit,
      offset,
      total,
    },
  });
}));

// IMPORTANT: This route must be registered BEFORE /:id to avoid being caught by the param route
router.get('/permissions', requireAuth, asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();

  const permissions = await db
    .selectFrom('permission')
    .selectAll()
    .orderBy('category')
    .orderBy('name')
    .execute();

  res.json({ data: permissions });
}));

router.get('/:id', requireAuth, asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDatabase();

  const role = await db
    .selectFrom('role')
    .where('id', '=', req.params.id as string)
    .selectAll()
    .executeTakeFirst();

  if (!role) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }

  const permissions = await db
    .selectFrom('role_permission')
    .innerJoin('permission', 'permission.id', 'role_permission.permission_id')
    .where('role_permission.role_id', '=', req.params.id as string)
    .select(['permission.id', 'permission.key', 'permission.name', 'permission.description', 'permission.category'])
    .execute();

  res.json({
    role,
    permissions,
  });
}));

router.post(
  '/',
  requireSession,
  requirePermission('admin.roles'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = createRoleSchema.parse(req.body);
      const db = getDatabase();

      const existingRole = await db
        .selectFrom('role')
        .where('key', '=', data.key)
        .selectAll()
        .executeTakeFirst();

      if (existingRole) {
        res.status(409).json({ error: 'Role key already exists' });
        return;
      }

      const roleId = uuidv4();

      await db
        .insertInto('role')
        .values(toSnakeCase({
          id: roleId,
          key: data.key,
          name: data.name,
          description: data.description,
          isSystem: false,
        }))
        .execute();

      if (data.permissionIds && data.permissionIds.length > 0) {
        await db
          .insertInto('role_permission')
          .values(
            data.permissionIds.map(permissionId => ({
              role_id: roleId,
              permission_id: permissionId,
              created_at: new Date(),
            }))
          )
          .execute();
      }

      logger.info('Role created', {
        roleId,
        key: data.key,
        requestId: req.requestId,
      });

      res.status(201).json({
        id: roleId,
        key: data.key,
        name: data.name,
        description: data.description,
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

router.put(
  '/:id',
  requireSession,
  requirePermission('admin.roles'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const data = updateRoleSchema.parse(req.body);
      const db = getDatabase();

      const role = await db
        .selectFrom('role')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      if (!role) {
        res.status(404).json({ error: 'Role not found' });
        return;
      }

      if (role.is_system) {
        res.status(400).json({ error: 'Cannot modify system roles' });
        return;
      }

      const updateData: Record<string, unknown> = {};

      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;

      if (Object.keys(updateData).length > 0) {
        await db
          .updateTable('role')
          .set(toSnakeCase(updateData))
          .where('id', '=', req.params.id as string)
          .execute();
      }

      if (data.permissionIds !== undefined) {
        await db
          .deleteFrom('role_permission')
          .where('role_id', '=', req.params.id)
          .execute();

        if (data.permissionIds.length > 0) {
          await db
            .insertInto('role_permission')
            .values(
              data.permissionIds.map(permissionId => ({
                role_id: req.params.id as string,
                permission_id: permissionId,
                created_at: new Date(),
              }))
            )
            .execute();
        }
      }

      logger.info('Role updated', {
        roleId: req.params.id,
        requestId: req.requestId,
      });

      // Fetch and return the updated role with its permissions
      const updatedRole = await db
        .selectFrom('role')
        .where('id', '=', req.params.id as string)
        .selectAll()
        .executeTakeFirst();

      const permissions = await db
        .selectFrom('role_permission')
        .innerJoin('permission', 'permission.id', 'role_permission.permission_id')
        .where('role_permission.role_id', '=', req.params.id as string)
        .select(['permission.id', 'permission.key', 'permission.name', 'permission.description', 'permission.category'])
        .execute();

      res.json({
        ...updatedRole,
        permissions,
      });
    } catch (error) {
      if (handleValidationError(res, error)) return;
      throw error;
    }
  })
);

router.delete(
  '/:id',
  requireSession,
  requirePermission('admin.roles'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();

    const role = await db
      .selectFrom('role')
      .where('id', '=', req.params.id as string)
      .selectAll()
      .executeTakeFirst();

    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }

    if (role.is_system) {
      res.status(400).json({ error: 'Cannot delete system roles' });
      return;
    }

    await db.deleteFrom('role').where('id', '=', req.params.id as string).execute();

    logger.info('Role deleted', {
      roleId: req.params.id as string,
      requestId: req.requestId,
    });

    res.status(204).send();
  })
);

export default router;
