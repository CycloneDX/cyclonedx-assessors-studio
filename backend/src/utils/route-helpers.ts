/**
 * Route Handler Utilities
 *
 * This module provides shared utilities to reduce duplication in route handlers:
 * - asyncHandler: Wraps async route handlers with automatic error handling
 * - handleValidationError: Checks if error is ZodError and sends formatted response
 * - validateBody: Validates request body against a Zod schema
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from './logger.js';

interface RequestWithId extends Request {
  requestId?: string;
}

/**
 * Wraps an async Express route handler with try/catch.
 * If the handler throws an unhandled error, sends 500 response.
 * For ZodErrors, the handler should call handleValidationError.
 *
 * Usage:
 *   router.post('/resource', requireAuth, asyncHandler(async (req, res) => {
 *     // handler code
 *   }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response) => void {
  return (req: Request, res: Response) => {
    const handleError = (error: unknown): void => {
      if (res.headersSent) return;
      if (handleValidationError(res, error)) return;
      const requestId = (req as RequestWithId).requestId;
      logger.error('Unhandled route error', { error, requestId });
      res.status(500).json({ error: 'Internal server error' });
    };

    try {
      void fn(req, res).catch(handleError);
    } catch (error) {
      handleError(error);
    }
  };
}

/**
 * Checks if an error is a ZodError and sends a 400 validation error response.
 * Returns true if the error was handled, false otherwise.
 *
 * Usage:
 *   try {
 *     const data = schema.parse(req.body);
 *     // ... process data
 *   } catch (error) {
 *     if (handleValidationError(res, error)) return;
 *     // Handle other errors
 *   }
 */
export function handleValidationError(res: Response, error: unknown): boolean {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: error.issues });
    return true;
  }
  return false;
}

/**
 * Validates data against a Zod schema.
 * Throws a ZodError if validation fails, which can be caught and handled
 * with handleValidationError().
 *
 * Usage:
 *   try {
 *     const data = validateBody(schema, req.body);
 *     // ... use validated data
 *   } catch (error) {
 *     if (handleValidationError(res, error)) return;
 *     // Handle other errors
 *   }
 */
export function validateBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  return schema.parse(body);
}

/**
 * Validates req.body against a schema. On failure responds 400 with the
 * issues and returns null, so a handler can `if (!body) return;`. Use
 * wherever a handler reads req.body (security review I9).
 */
export function parseBody<T>(schema: z.ZodSchema<T>, body: unknown, res: Response): T | null {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    res.status(400).json({ error: 'Invalid input', details: result.error.issues });
    return null;
  }
  return result.data;
}
