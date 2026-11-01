export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  paths: Record<string, any>;
  components: {
    schemas: Record<string, any>;
    securitySchemes: Record<string, any>;
  };
  tags?: Array<{
    name: string;
    description?: string;
  }>;
}

export function getOpenAPISpec(): OpenAPISpec {
  return {
    openapi: '3.0.3',
    info: {
      title: 'CycloneDX Assessors Studio API',
      version: '0.2.0',
      description: 'API for managing security assessments, evidence, and compliance attestations',
    },
    servers: [
      {
        url: '/api',
        description: 'API Server',
      },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          operationId: 'getHealth',
          description: 'Unauthenticated callers receive simple status. Authenticated callers receive detailed system metrics.',
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        type: 'object',
                        properties: {
                          status: { type: 'string', example: 'healthy' },
                          timestamp: { type: 'string', format: 'date-time' },
                        },
                        required: ['status', 'timestamp'],
                      },
                      {
                        type: 'object',
                        properties: {
                          status: { type: 'string', example: 'healthy' },
                          uptime: { type: 'string' },
                          version: { type: 'string' },
                          environment: { type: 'string' },
                          memory: {
                            type: 'object',
                            properties: {
                              heapUsed: { type: 'string' },
                              heapUsedPercent: { type: 'string' },
                              rss: { type: 'string' },
                            },
                          },
                          system: {
                            type: 'object',
                            properties: {
                              platform: { type: 'string' },
                              memory: {
                                type: 'object',
                                properties: {
                                  usedPercent: { type: 'string' },
                                  alert: { type: 'string', nullable: true },
                                },
                              },
                              loadavg: {
                                type: 'object',
                                properties: {
                                  '1min': { type: 'string' },
                                  alert: { type: 'string', nullable: true },
                                },
                              },
                            },
                          },
                          disk: {
                            type: 'object',
                            properties: {
                              total: { type: 'string' },
                              used: { type: 'string' },
                              free: { type: 'string' },
                            },
                          },
                        },
                        required: ['status', 'uptime', 'version'],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      '/v1/setup/status': {
        get: {
          tags: ['Setup'],
          summary: 'Check setup status',
          operationId: 'getSetupStatus',
          description: 'Returns whether initial setup has been completed',
          responses: {
            '200': {
              description: 'Setup status retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      setupComplete: { type: 'boolean' },
                    },
                    required: ['setupComplete'],
                  },
                },
              },
            },
          },
        },
      },
      '/v1/setup': {
        post: {
          tags: ['Setup'],
          summary: 'Complete initial setup',
          operationId: 'setupSystem',
          description: 'Creates the initial administrator account. Only works when no users exist in the database.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    username: { type: 'string', minLength: 3, maxLength: 64, pattern: '^[a-zA-Z0-9._-]+$' },
                    email: { type: 'string', format: 'email' },
                    displayName: { type: 'string', minLength: 1, maxLength: 128 },
                    password: { type: 'string', minLength: 8, maxLength: 128 },
                  },
                  required: ['username', 'email', 'displayName', 'password'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Administrator account created successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      user: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          username: { type: 'string' },
                          email: { type: 'string' },
                          displayName: { type: 'string' },
                          role: { type: 'string', enum: ['admin'] },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Validation failed',
            },
            '403': {
              description: 'Setup already completed',
            },
          },
        },
      },
      '/v1/setup/standards-feed': {
        get: {
          tags: ['Setup'],
          summary: 'Get available standards feed',
          operationId: 'getStandardsFeed',
          description: 'Fetches the CycloneDX standards feed. Only available during setup.',
          responses: {
            '200': {
              description: 'Standards feed retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            title: { type: 'string' },
                            url: { type: 'string' },
                            summary: { type: 'string' },
                            datePublished: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '502': {
              description: 'Failed to fetch standards feed',
            },
          },
        },
      },
      '/v1/setup/import-standard': {
        post: {
          tags: ['Setup'],
          summary: 'Import standard from URL',
          operationId: 'importStandardSetup',
          description: 'Downloads a CycloneDX standards document from a URL and imports it. Only available during setup.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    title: { type: 'string' },
                  },
                  required: ['url'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Standard imported successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            identifier: { type: 'string' },
                            name: { type: 'string' },
                            requirementCount: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Invalid URL or validation failed',
            },
            '502': {
              description: 'Failed to download standard',
            },
          },
        },
      },
      '/v1/setup/seed-demo': {
        post: {
          tags: ['Setup'],
          summary: 'Seed demo data',
          operationId: 'seedDemoData',
          description: 'Seeds the database with comprehensive demo data. Only available during/after setup.',
          responses: {
            '201': {
              description: 'Demo data loaded successfully',
            },
            '200': {
              description: 'Demo data already present, skipped',
            },
            '500': {
              description: 'Failed to load demo data',
            },
          },
        },
      },
      '/v1/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'User login',
          operationId: 'login',
          description: 'Authenticates a user and returns user info. Auth token is set as httpOnly cookie.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    username: { type: 'string', minLength: 3 },
                    password: { type: 'string', minLength: 8 },
                  },
                  required: ['username', 'password'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Login successful',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      user: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          username: { type: 'string' },
                          email: { type: 'string' },
                          displayName: { type: 'string' },
                          role: { type: 'string', enum: ['admin', 'assessor', 'assessee', 'standards_manager', 'standards_approver'] },
                          hasCompletedOnboarding: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Invalid credentials',
            },
          },
        },
      },
      '/v1/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'User registration',
          operationId: 'register',
          description:
            'Submits a registration request. The response is intentionally generic to prevent user and email enumeration; the client cannot distinguish between a newly created account and a duplicate. Behavior depends on the server REGISTRATION_MODE setting: disabled (default) rejects all requests, invite_only requires a valid invite token, and open accepts any well formed request.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    username: { type: 'string', minLength: 3 },
                    email: { type: 'string', format: 'email' },
                    displayName: { type: 'string', minLength: 1 },
                    password: { type: 'string', minLength: 8 },
                    inviteToken: {
                      type: 'string',
                      description:
                        'Single use invite token issued by an admin. Required when REGISTRATION_MODE=invite_only.',
                    },
                  },
                  required: ['username', 'email', 'displayName', 'password'],
                },
              },
            },
          },
          responses: {
            '202': {
              description:
                'Registration request accepted. The response does not indicate whether the account was actually created.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Invalid registration request or invalid invite token',
            },
            '403': {
              description:
                'Registration is disabled or requires an invite token on this instance',
            },
          },
        },
      },
      '/v1/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'User logout',
          operationId: 'logout',
          description: 'Logs out the current user and clears the session',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Logged out successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/auth/logout-all': {
        post: {
          tags: ['Auth'],
          summary: 'Logout from all sessions',
          operationId: 'logoutAll',
          description: 'Logs out the current user from all active sessions',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Logged out from all sessions successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Get current user',
          operationId: 'getCurrentUser',
          description: 'Returns the authenticated user profile',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Current user retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      user: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', format: 'uuid' },
                          username: { type: 'string' },
                          email: { type: 'string' },
                          displayName: { type: 'string' },
                          role: { type: 'string', enum: ['admin', 'assessor', 'assessee', 'standards_manager', 'standards_approver'] },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
            },
          },
        },
        patch: {
          tags: ['Auth'],
          summary: 'Update user preferences',
          operationId: 'updateUserPreferences',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    chatIdentities: { type: 'object' },
                    notificationPreferences: { type: 'object' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'User preferences updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/auth/change-password': {
        put: {
          tags: ['Auth'],
          summary: 'Change password',
          operationId: 'changePassword',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    currentPassword: { type: 'string' },
                    newPassword: { type: 'string' },
                  },
                  required: ['currentPassword', 'newPassword'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Password changed',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '400': {
              description: 'Current password is incorrect, or validation failed',
            },
          },
        },
      },
      '/v1/auth/profile': {
        put: {
          tags: ['Auth'],
          summary: 'Update profile',
          operationId: 'updateProfile',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    displayName: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Profile updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/auth/complete-onboarding': {
        post: {
          tags: ['Auth'],
          summary: 'Mark onboarding as complete',
          operationId: 'completeOnboarding',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Onboarding completed',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/projects': {
        get: {
          tags: ['Projects'],
          summary: 'List projects',
          operationId: 'listProjects',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 },
            },
            {
              name: 'state',
              in: 'query',
              schema: { type: 'string', enum: ['active', 'archived', 'all'] },
            },
          ],
          responses: {
            '200': {
              description: 'Projects retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Project' },
                      },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                    required: ['data', 'pagination'],
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Projects'],
          summary: 'Create project',
          operationId: 'createProject',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    standardId: { type: 'string' },
                  },
                  required: ['name', 'standardId'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Project created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Project' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/projects/{id}': {
        get: {
          tags: ['Projects'],
          summary: 'Get project detail',
          operationId: 'getProject',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Project retrieved',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Project' },
                },
              },
            },
            '404': {
              description: 'Project not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Projects'],
          summary: 'Update project',
          operationId: 'updateProject',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Project updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Project' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Project not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Projects'],
          summary: 'Delete project',
          operationId: 'deleteProject',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '204': {
              description: 'Project deleted',
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Project not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/projects/{id}/archive': {
        post: {
          tags: ['Projects'],
          summary: 'Archive project',
          operationId: 'archiveProject',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Project archived',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/projects/{id}/export/summary': {
        get: {
          tags: ['Projects'],
          summary: 'Get project summary',
          description: 'Deprecated: no client uses this route, and it will be removed in a future release. Use GET /v1/projects/{id} and GET /v1/export/project/{projectId}/pdf instead.',
          deprecated: true,
          operationId: 'getProjectSummary',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Project summary',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/projects/{id}/stats': {
        get: {
          tags: ['Projects'],
          summary: 'Get project statistics',
          operationId: 'getProjectStats',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Project statistics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      totalAssessments: { type: 'integer' },
                      completedAssessments: { type: 'integer' },
                      completionPercentage: { type: 'number' },
                      totalEvidence: { type: 'integer' },
                      approvedEvidence: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '404': {
              description: 'Project not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/standards': {
        get: {
          tags: ['Standards'],
          summary: 'List standards',
          operationId: 'listStandards',
          description: 'Returns a paginated list of standards with requirement and level counts',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50, maximum: 100 },
              description: 'Maximum number of standards to return',
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 },
              description: 'Offset for pagination',
            },
            {
              name: 'state',
              in: 'query',
              schema: { type: 'string', enum: ['draft', 'in_review', 'published', 'retired'] },
              description: 'Filter by standard state',
            },
          ],
          responses: {
            '200': {
              description: 'Standards retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Standard' },
                      },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/standards/{id}': {
        get: {
          tags: ['Standards'],
          summary: 'Get standard detail',
          operationId: 'getStandard',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Standard retrieved',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Standard' },
                },
              },
            },
            '404': {
              description: 'Standard not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Standards'],
          summary: 'Update standard',
          operationId: 'updateStandard',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Standard updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Standards'],
          summary: 'Delete standard',
          operationId: 'deleteStandard',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': {
              description: 'Standard deleted',
            },
          },
        },
      },
      '/v1/standards/{id}/submit': {
        post: {
          tags: ['Standards'],
          summary: 'Submit standard for review',
          operationId: 'submitStandardForReview',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Standard submitted',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/standards/{id}/approve': {
        post: {
          tags: ['Standards'],
          summary: 'Approve standard',
          operationId: 'approveStandard',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Standard approved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/standards/{id}/reject': {
        post: {
          tags: ['Standards'],
          summary: 'Reject standard',
          operationId: 'rejectStandard',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Standard rejected',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/standards/{id}/duplicate': {
        post: {
          tags: ['Standards'],
          summary: 'Duplicate standard',
          operationId: 'duplicateStandard',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '201': {
              description: 'Standard duplicated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/standards/{id}/retire': {
        post: {
          tags: ['Standards'],
          summary: 'Retire standard',
          operationId: 'retireStandard',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Standard retired',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/standards/{id}/requirements': {
        post: {
          tags: ['Standards'],
          summary: 'Create standard requirement',
          operationId: 'createStandardRequirement',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Requirement created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/standards/{standardId}/requirements/{reqId}': {
        put: {
          tags: ['Standards'],
          summary: 'Update standard requirement',
          operationId: 'updateStandardRequirement',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'standardId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'reqId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Requirement updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Standards'],
          summary: 'Delete standard requirement',
          operationId: 'deleteStandardRequirement',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'standardId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'reqId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': {
              description: 'Requirement deleted',
            },
          },
        },
      },
      '/v1/standards/{id}/export': {
        get: {
          tags: ['Standards'],
          summary: 'Export standard as CycloneDX',
          operationId: 'exportStandard',
          description: 'Exports a standard as a CycloneDX JSON document',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': {
              description: 'Standard exported successfully',
              content: {
                'application/vnd.cyclonedx+json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'Standard not found',
            },
          },
        },
      },
      '/v1/standards/import': {
        post: {
          tags: ['Standards'],
          summary: 'Import standard',
          operationId: 'importStandard',
          description: 'Imports a standard from JSON payload',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    identifier: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    owner: { type: 'string' },
                    version: { type: 'string' },
                    licenseId: { type: 'string' },
                    requirements: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          identifier: { type: 'string' },
                          name: { type: 'string' },
                          description: { type: 'string' },
                          openCre: { type: ['string', 'array'] },
                          parentIdentifier: { type: 'string' },
                        },
                      },
                    },
                    levels: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          identifier: { type: 'string' },
                          title: { type: 'string' },
                          description: { type: 'string' },
                          requirements: { type: 'array', items: { type: 'string' } },
                        },
                      },
                    },
                    sourceJson: { type: 'string' },
                  },
                  required: ['identifier', 'name'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Standard imported',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      identifier: { type: 'string' },
                      name: { type: 'string' },
                      requirementCount: { type: 'integer' },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
            '409': {
              description: 'Standard already exists',
            },
          },
        },
      },
      '/v1/assessments': {
        get: {
          tags: ['Assessments'],
          summary: 'List assessments',
          operationId: 'listAssessments',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 },
            },
            {
              name: 'state',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['draft', 'in-progress', 'completed', 'all'],
              },
            },
            {
              name: 'projectId',
              in: 'query',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Assessments retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Assessment' },
                      },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                    required: ['data', 'pagination'],
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Assessments'],
          summary: 'Create assessment',
          operationId: 'createAssessment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    projectId: { type: 'string' },
                    entityId: { type: 'string' },
                    standardId: { type: 'string' },
                    dueDate: { type: 'string', format: 'date' },
                    assessorIds: { type: 'array', items: { type: 'string' } },
                    assesseeIds: { type: 'array', items: { type: 'string' } },
                    tags: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['title'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Assessment created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Assessment' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/assessments/{id}': {
        get: {
          tags: ['Assessments'],
          summary: 'Get assessment detail',
          operationId: 'getAssessment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Assessment retrieved with requirements, assessors, and assessees',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      assessment: { $ref: '#/components/schemas/Assessment' },
                      requirements: {
                        type: 'array',
                        items: { type: 'object' },
                      },
                      assessors: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/User' },
                      },
                      assessees: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/User' },
                      },
                    },
                    required: [
                      'assessment',
                      'requirements',
                      'assessors',
                      'assessees',
                    ],
                  },
                },
              },
            },
            '404': {
              description: 'Assessment not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Assessments'],
          summary: 'Update assessment',
          operationId: 'updateAssessment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    dueDate: { type: 'string', format: 'date' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Assessment updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Assessment' },
                },
              },
            },
            '404': {
              description: 'Assessment not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Assessments'],
          summary: 'Delete assessment',
          operationId: 'deleteAssessment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Assessment deleted',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'Assessment not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/assessments/{id}/start': {
        post: {
          tags: ['Assessments'],
          summary: 'Start assessment',
          operationId: 'startAssessment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Assessment started',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Assessment' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Assessment not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/assessments/{id}/complete': {
        post: {
          tags: ['Assessments'],
          summary: 'Complete assessment',
          operationId: 'completeAssessment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Assessment completed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Assessment' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Assessment not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/assessments/{id}/reopen': {
        post: {
          tags: ['Assessments'],
          summary: 'Reopen completed assessment',
          operationId: 'reopenAssessment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Assessment reopened',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Assessment' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Assessment not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/assessments/{id}/requirements/{requirementId}': {
        put: {
          tags: ['Assessments'],
          summary: 'Update requirement result',
          operationId: 'updateRequirementResult',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'requirementId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    result: { type: 'string', enum: ['pass', 'fail', 'pending'] },
                    notes: { type: 'string' },
                    evidenceIds: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                  required: ['result'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Requirement result updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'Assessment or requirement not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/assessments/{id}/requirements/{requirementId}/evidence': {
        get: {
          tags: ['Assessments'],
          summary: 'Get evidence for requirement',
          operationId: 'getRequirementEvidence',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'requirementId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Evidence retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/assessments/{id}/evidence': {
        get: {
          tags: ['Assessments'],
          summary: 'Get all evidence for assessment',
          operationId: 'getAssessmentEvidence',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Evidence retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/assessments/{id}/requirements/{requirementId}/notes': {
        get: {
          tags: ['Assessments'],
          summary: 'Get notes for requirement',
          operationId: 'getRequirementNotes',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'requirementId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Notes retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Assessments'],
          summary: 'Add note to requirement',
          operationId: 'addRequirementNote',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'requirementId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    content: { type: 'string' },
                  },
                  required: ['content'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Note created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/assessments/{id}/notes': {
        get: {
          tags: ['Assessments'],
          summary: 'Get all notes for assessment',
          operationId: 'getAssessmentNotes',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Notes retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/evidence': {
        get: {
          tags: ['Evidence'],
          summary: 'List evidence',
          operationId: 'listEvidence',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 },
            },
          ],
          responses: {
            '200': {
              description: 'Evidence retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Evidence' },
                      },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                    required: ['data', 'pagination'],
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Evidence'],
          summary: 'Create evidence',
          operationId: 'createEvidence',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    type: { type: 'string' },
                    assessmentId: { type: 'string' },
                    tags: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                  required: ['title', 'type'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Evidence created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Evidence' },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/evidence/{id}': {
        get: {
          tags: ['Evidence'],
          summary: 'Get evidence detail',
          operationId: 'getEvidence',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Evidence retrieved with notes, attachments, and tags',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      evidence: { $ref: '#/components/schemas/Evidence' },
                      notes: {
                        type: 'array',
                        items: { type: 'object' },
                      },
                      attachments: {
                        type: 'array',
                        items: { type: 'object' },
                      },
                      tags: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Tag' },
                      },
                    },
                    required: ['evidence', 'notes', 'attachments', 'tags'],
                  },
                },
              },
            },
            '404': {
              description: 'Evidence not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Evidence'],
          summary: 'Update evidence',
          operationId: 'updateEvidence',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    description: { type: 'string' },
                    tags: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Evidence updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Evidence' },
                },
              },
            },
            '404': {
              description: 'Evidence not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/evidence/{id}/notes': {
        post: {
          tags: ['Evidence'],
          summary: 'Add note to evidence',
          operationId: 'addEvidenceNote',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    content: { type: 'string' },
                  },
                  required: ['content'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Note added',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'Evidence not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/evidence/{id}/link': {
        post: {
          tags: ['Evidence'],
          summary: 'Link evidence to assessment',
          operationId: 'linkEvidence',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Evidence linked',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/evidence/{id}/unlink': {
        delete: {
          tags: ['Evidence'],
          summary: 'Unlink evidence from assessment',
          operationId: 'unlinkEvidence',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': {
              description: 'Evidence unlinked',
            },
          },
        },
      },
      '/v1/evidence/{id}/submit-for-review': {
        post: {
          tags: ['Evidence'],
          summary: 'Submit evidence for review',
          operationId: 'submitEvidenceForReview',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Evidence submitted',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/evidence/{id}/approve': {
        post: {
          tags: ['Evidence'],
          summary: 'Approve evidence',
          operationId: 'approveEvidence',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Evidence approved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/evidence/{id}/reject': {
        post: {
          tags: ['Evidence'],
          summary: 'Reject evidence',
          operationId: 'rejectEvidence',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Evidence rejected',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/evidence/{id}/attachments': {
        post: {
          tags: ['Evidence'],
          summary: 'Upload evidence attachment',
          operationId: 'uploadEvidenceAttachment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Attachment uploaded',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/evidence/{id}/attachments/{attachmentId}/download': {
        get: {
          tags: ['Evidence'],
          summary: 'Download evidence attachment',
          operationId: 'downloadEvidenceAttachment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'attachmentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Attachment file',
              content: {
                'application/octet-stream': {},
              },
            },
          },
        },
      },
      '/v1/evidence/{id}/attachments/{attachmentId}': {
        delete: {
          tags: ['Evidence'],
          summary: 'Delete evidence attachment',
          operationId: 'deleteEvidenceAttachment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'attachmentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': {
              description: 'Attachment deleted',
            },
          },
        },
      },
      '/v1/evidence/{id}/claims': {
        get: {
          tags: ['Evidence'],
          summary: 'Get claims linked to evidence',
          operationId: 'getEvidenceClaims',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Claims retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
            '404': {
              description: 'Evidence not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/claims': {
        get: {
          tags: ['Claims'],
          summary: 'List claims',
          operationId: 'listClaims',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 },
            },
          ],
          responses: {
            '200': {
              description: 'Claims retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Claim' },
                      },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                    required: ['data', 'pagination'],
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Claims'],
          summary: 'Create claim',
          operationId: 'createClaim',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    requirementId: { type: 'string' },
                    assessmentId: { type: 'string' },
                    statement: { type: 'string' },
                    evidence: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                  required: ['requirementId', 'statement'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Claim created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Claim' },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/claims/{id}': {
        get: {
          tags: ['Claims'],
          summary: 'Get claim detail',
          operationId: 'getClaim',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Claim retrieved',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Claim' },
                },
              },
            },
            '404': {
              description: 'Claim not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Claims'],
          summary: 'Update claim',
          operationId: 'updateClaim',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    statement: { type: 'string' },
                    evidence: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Claim updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Claim' },
                },
              },
            },
            '404': {
              description: 'Claim not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Claims'],
          summary: 'Delete claim',
          operationId: 'deleteClaim',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '204': {
              description: 'Claim deleted',
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Claim not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/entities': {
        get: {
          tags: ['Entities'],
          summary: 'List entities',
          operationId: 'listEntities',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': {
              description: 'Entities retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'object' } },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ['Entities'],
          summary: 'Create entity',
          operationId: 'createEntity',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    entityType: { type: 'string' },
                    description: { type: 'string' },
                  },
                  required: ['name', 'entityType'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Entity created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/entities/relationship-graph': {
        get: {
          tags: ['Entities'],
          summary: 'Get entity relationship graph',
          operationId: 'getEntityRelationshipGraph',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Entity relationship graph',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      entities: { type: 'array' },
                      edges: { type: 'array' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/entities/{id}': {
        get: {
          tags: ['Entities'],
          summary: 'Get entity detail',
          operationId: 'getEntity',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Entity retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Entities'],
          summary: 'Update entity',
          operationId: 'updateEntity',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Entity updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Entities'],
          summary: 'Delete entity',
          operationId: 'deleteEntity',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': {
              description: 'Entity deleted',
            },
          },
        },
      },
      '/v1/entities/{id}/children': {
        get: {
          tags: ['Entities'],
          summary: 'Get entity children',
          operationId: 'getEntityChildren',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Entity children retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/entities/{id}/assessments': {
        get: {
          tags: ['Entities'],
          summary: 'Get entity assessments',
          operationId: 'getEntityAssessments',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Entity assessments retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/entities/{id}/history': {
        get: {
          tags: ['Entities'],
          summary: 'Get entity history',
          operationId: 'getEntityHistory',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Entity history retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/entities/{id}/relationship-graph': {
        get: {
          tags: ['Entities'],
          summary: 'Get entity relationship graph',
          operationId: 'getEntityRelationshipGraphById',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Entity relationship graph',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/entities/{id}/relationships': {
        post: {
          tags: ['Entities'],
          summary: 'Create entity relationship',
          operationId: 'createEntityRelationship',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Relationship created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/entities/{id}/relationships/{relId}': {
        delete: {
          tags: ['Entities'],
          summary: 'Delete entity relationship',
          operationId: 'deleteEntityRelationship',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'relId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': {
              description: 'Relationship deleted',
            },
          },
        },
      },
      '/v1/entities/{id}/policies': {
        get: {
          tags: ['Entities'],
          summary: 'Get entity policies',
          operationId: 'getEntityPolicies',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Entity policies retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Entities'],
          summary: 'Create entity policy',
          operationId: 'createEntityPolicy',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Policy created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/entities/{id}/policies/{policyId}': {
        put: {
          tags: ['Entities'],
          summary: 'Update entity policy',
          operationId: 'updateEntityPolicy',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'policyId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Policy updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Entities'],
          summary: 'Delete entity policy',
          operationId: 'deleteEntityPolicy',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'policyId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': {
              description: 'Policy deleted',
            },
          },
        },
      },
      '/v1/entities/{id}/progress': {
        get: {
          tags: ['Entities'],
          summary: 'Get entity assessment progress',
          operationId: 'getEntityProgress',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Entity progress retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/attestations': {
        get: {
          tags: ['Attestations'],
          summary: 'List attestations',
          operationId: 'listAttestations',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 },
            },
          ],
          responses: {
            '200': {
              description: 'Attestations retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Attestation' },
                      },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                    required: ['data', 'pagination'],
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Attestations'],
          summary: 'Create attestation',
          operationId: 'createAttestation',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    assessmentId: { type: 'string' },
                    claims: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    bomRef: { type: 'string' },
                  },
                  required: ['assessmentId', 'claims'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Attestation created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Attestation' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/attestations/{id}': {
        get: {
          tags: ['Attestations'],
          summary: 'Get attestation detail',
          operationId: 'getAttestation',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Attestation retrieved',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Attestation' },
                },
              },
            },
            '404': {
              description: 'Attestation not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Attestations'],
          summary: 'Update attestation',
          operationId: 'updateAttestation',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    claims: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Attestation updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Attestation' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Attestation not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/attestations/{id}/requirements': {
        get: {
          tags: ['Attestations'],
          summary: 'Get attestation requirements',
          operationId: 'getAttestationRequirements',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Requirements retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Attestations'],
          summary: 'Add requirement to attestation',
          operationId: 'addAttestationRequirement',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Requirement added',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/attestations/{id}/requirements/{requirementId}': {
        put: {
          tags: ['Attestations'],
          summary: 'Update attestation requirement',
          operationId: 'updateAttestationRequirement',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'requirementId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Requirement updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/users': {
        get: {
          tags: ['Users'],
          summary: 'List users',
          operationId: 'listUsers',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 },
            },
          ],
          responses: {
            '200': {
              description: 'Users retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/User' },
                      },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                    required: ['data', 'pagination'],
                  },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Users'],
          summary: 'Create user',
          operationId: 'createUser',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 },
                    roleId: { type: 'string' },
                  },
                  required: ['name', 'email', 'password'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'User created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/users/assignable': {
        get: {
          tags: ['Users'],
          summary: 'Get assignable users',
          operationId: 'getAssignableUsers',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Assignable users retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/User' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/users/{id}': {
        get: {
          tags: ['Users'],
          summary: 'Get user detail',
          operationId: 'getUser',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'User retrieved',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'User not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Users'],
          summary: 'Update user',
          operationId: 'updateUser',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    roleId: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'User updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'User not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/users/{id}/activate': {
        put: {
          tags: ['Users'],
          summary: 'Activate user',
          operationId: 'activateUser',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'User activated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'User not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/users/{id}/deactivate': {
        put: {
          tags: ['Users'],
          summary: 'Deactivate user',
          operationId: 'deactivateUser',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'User deactivated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'User not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/roles': {
        get: {
          tags: ['Roles'],
          summary: 'List roles',
          operationId: 'listRoles',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Roles retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Role' },
                  },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Roles'],
          summary: 'Create role',
          operationId: 'createRole',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    permissions: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                  required: ['name', 'permissions'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Role created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Role' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/roles/permissions': {
        get: {
          tags: ['Roles'],
          summary: 'List all permissions',
          operationId: 'listPermissions',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Permissions retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        description: { type: 'string' },
                        category: { type: 'string' },
                      },
                      required: ['id', 'name'],
                    },
                  },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/roles/{id}': {
        get: {
          tags: ['Roles'],
          summary: 'Get role detail',
          operationId: 'getRole',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Role retrieved',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Role' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Role not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Roles'],
          summary: 'Update role',
          operationId: 'updateRole',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    permissions: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Role updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Role' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Role not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Roles'],
          summary: 'Delete role',
          operationId: 'deleteRole',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '204': {
              description: 'Role deleted',
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Role not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/tags': {
        get: {
          tags: ['Tags'],
          summary: 'List tags',
          operationId: 'listTags',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Tags retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Tag' },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Tags'],
          summary: 'Create tag',
          description: 'Tag names are normalized to lowercase and trimmed before persistence.',
          operationId: 'createTag',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    color: { type: 'string' },
                  },
                  required: ['name'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Tag created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Tag' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '409': {
              description: 'A tag with this name already exists',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/tags/autocomplete': {
        get: {
          tags: ['Tags'],
          summary: 'Get tags autocomplete',
          operationId: 'getTagsAutocomplete',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Tags autocomplete results',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/tags/{id}': {
        put: {
          tags: ['Tags'],
          summary: 'Update tag',
          description: 'Tag names are normalized to lowercase and trimmed before persistence.',
          operationId: 'updateTag',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    color: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Tag updated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Tag' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Tag not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '409': {
              description: 'A tag with this name already exists',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Tags'],
          summary: 'Delete tag',
          operationId: 'deleteTag',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '204': {
              description: 'Tag deleted',
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'Tag not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/apikeys': {
        get: {
          tags: ['API Keys'],
          summary: 'List API keys',
          operationId: 'listApiKeys',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'API keys retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        prefix: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                        lastUsedAt: {
                          type: 'string',
                          format: 'date-time',
                          nullable: true,
                        },
                      },
                      required: ['id', 'name', 'prefix', 'createdAt'],
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['API Keys'],
          summary: 'Create API key',
          operationId: 'createApiKey',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                  },
                  required: ['name'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'API key created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      key: { type: 'string' },
                      prefix: { type: 'string' },
                      createdAt: { type: 'string', format: 'date-time' },
                    },
                    required: ['id', 'name', 'key', 'prefix', 'createdAt'],
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/apikeys/{id}': {
        delete: {
          tags: ['API Keys'],
          summary: 'Delete API key',
          operationId: 'deleteApiKey',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '204': {
              description: 'API key deleted',
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '404': {
              description: 'API key not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/dashboard/stats': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get dashboard statistics',
          operationId: 'getDashboardStats',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Dashboard stats retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      totalProjects: { type: 'integer' },
                      totalAssessments: { type: 'integer' },
                      totalEvidence: { type: 'integer' },
                      totalAttestations: { type: 'integer' },
                      activeAssessments: { type: 'integer' },
                      completedAssessments: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/dashboard/recent-assessments': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get recent assessments',
          operationId: 'getRecentAssessments',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Recent assessments retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Assessment' },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/dashboard/upcoming-due-dates': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get upcoming due dates',
          operationId: 'getUpcomingDueDates',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Upcoming due dates retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        assessmentId: { type: 'string' },
                        name: { type: 'string' },
                        dueDate: { type: 'string', format: 'date' },
                        daysRemaining: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/dashboard/compliance-coverage': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get compliance coverage',
          operationId: 'getComplianceCoverage',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Compliance coverage retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      totalRequirements: { type: 'integer' },
                      satisfiedRequirements: { type: 'integer' },
                      coveragePercentage: { type: 'number' },
                      byStandard: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            standardId: { type: 'string' },
                            standardName: { type: 'string' },
                            covered: { type: 'integer' },
                            total: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/dashboard/assessment-distribution': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get assessment distribution',
          operationId: 'getAssessmentDistribution',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Assessment distribution retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      draft: { type: 'integer' },
                      inProgress: { type: 'integer' },
                      completed: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/dashboard/evidence-health': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get evidence health',
          operationId: 'getEvidenceHealth',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Evidence health retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      totalEvidence: { type: 'integer' },
                      linkedEvidence: { type: 'integer' },
                      orphanedEvidence: { type: 'integer' },
                      averageEvidencePerAssessment: { type: 'number' },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/dashboard/conformance-breakdown': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get conformance breakdown',
          operationId: 'getConformanceBreakdown',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Conformance breakdown',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/dashboard/risk-insights': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get risk insights',
          operationId: 'getRiskInsights',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Risk insights',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/dashboard/project-health': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get project health',
          operationId: 'getProjectHealth',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Project health',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/dashboard/progress': {
        get: {
          tags: ['Dashboard'],
          summary: 'Get overall progress',
          operationId: 'getProgress',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Overall progress retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      totalAssessments: { type: 'integer' },
                      completedAssessments: { type: 'integer' },
                      inProgressAssessments: { type: 'integer' },
                      completionPercentage: { type: 'number' },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/import/attestation': {
        post: {
          tags: ['Import'],
          summary: 'Import attestation',
          operationId: 'importAttestation',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    bomData: { type: 'object' },
                    projectId: { type: 'string' },
                  },
                  required: ['bomData', 'projectId'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Attestation imported',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Attestation' },
                },
              },
            },
            '400': {
              description: 'Invalid import data',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
            '403': {
              description: 'Insufficient permissions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/audit': {
        get: {
          tags: ['Audit'],
          summary: 'Get audit logs',
          operationId: 'getAuditLogs',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'entityType', in: 'query', schema: { type: 'string' } },
            { name: 'entityId', in: 'query', schema: { type: 'string' } },
            { name: 'userId', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Audit logs retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/audit/entity/{entityType}/{entityId}': {
        get: {
          tags: ['Audit'],
          summary: 'Get entity audit logs',
          operationId: 'getEntityAuditLogs',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'entityType', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'entityId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': {
              description: 'Entity audit logs retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/notifications': {
        get: {
          tags: ['Notifications'],
          summary: 'List notifications',
          operationId: 'listNotifications',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
            { name: 'unreadOnly', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            '200': {
              description: 'Notifications retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/notifications/{id}/read': {
        put: {
          tags: ['Notifications'],
          summary: 'Mark notification as read',
          operationId: 'markNotificationAsRead',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Notification marked as read',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/notifications/read-all': {
        put: {
          tags: ['Notifications'],
          summary: 'Mark all notifications as read',
          operationId: 'markAllNotificationsAsRead',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'All notifications marked as read',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/notifications/count': {
        get: {
          tags: ['Notifications'],
          summary: 'Get unread notification count',
          operationId: 'getUnreadNotificationCount',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Unread count retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/export/assessment/{assessmentId}': {
        get: {
          tags: ['Export'],
          summary: 'Export assessment',
          operationId: 'exportAssessment',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'assessmentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Assessment exported',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/export/assessment/{assessmentId}/pdf': {
        get: {
          tags: ['Export'],
          summary: 'Export assessment as PDF',
          operationId: 'exportAssessmentPdf',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'assessmentId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Assessment PDF',
              content: {
                'application/pdf': {},
              },
            },
          },
        },
      },
      '/v1/export/project/{projectId}/pdf': {
        get: {
          tags: ['Export'],
          summary: 'Export project report as PDF',
          operationId: 'exportProjectPdf',
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Project PDF',
              content: {
                'application/pdf': {},
              },
            },
          },
        },
      },
      '/v1/export/project/{projectId}': {
        get: {
          tags: ['Export'],
          summary: 'Export project',
          operationId: 'exportProject',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Project exported',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/webhooks': {
        get: {
          tags: ['Webhooks'],
          summary: 'List webhooks',
          operationId: 'listWebhooks',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Webhooks retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            url: { type: 'string' },
                            eventTypes: { type: 'array', items: { type: 'string' } },
                            isActive: { type: 'boolean' },
                            consecutiveFailures: { type: 'integer' },
                            createdAt: { type: 'string', format: 'date-time' },
                            updatedAt: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Webhooks'],
          summary: 'Create webhook',
          operationId: 'createWebhook',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    url: { type: 'string' },
                    eventTypes: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['name', 'url', 'eventTypes'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Webhook created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/webhooks/{id}': {
        get: {
          tags: ['Webhooks'],
          summary: 'Get webhook details',
          operationId: 'getWebhook',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Webhook retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'Webhook not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Webhooks'],
          summary: 'Update webhook',
          operationId: 'updateWebhook',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    url: { type: 'string' },
                    eventTypes: { type: 'array', items: { type: 'string' } },
                    isActive: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Webhook updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Webhooks'],
          summary: 'Delete webhook',
          operationId: 'deleteWebhook',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Webhook deleted',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'Webhook not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/webhooks/{id}/test': {
        post: {
          tags: ['Webhooks'],
          summary: 'Test webhook delivery',
          operationId: 'testWebhook',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Webhook tested',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/webhooks/{id}/enable': {
        post: {
          tags: ['Webhooks'],
          summary: 'Re-enable webhook',
          operationId: 'enableWebhook',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Webhook enabled',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/webhooks/{id}/deliveries': {
        get: {
          tags: ['Webhooks'],
          summary: 'Get webhook deliveries',
          operationId: 'getWebhookDeliveries',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', default: 50 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', default: 0 },
            },
          ],
          responses: {
            '200': {
              description: 'Webhook deliveries retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'object' } },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/integrations/chat': {
        get: {
          tags: ['Chat Integrations'],
          summary: 'List chat integrations',
          operationId: 'listChatIntegrations',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Chat integrations retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Chat Integrations'],
          summary: 'Create chat integration',
          operationId: 'createChatIntegration',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['slack', 'msteams', 'discord'] },
                    config: { type: 'object' },
                  },
                  required: ['type', 'config'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Chat integration created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/integrations/chat/{id}': {
        get: {
          tags: ['Chat Integrations'],
          summary: 'Get chat integration',
          operationId: 'getChatIntegration',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Chat integration retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'Chat integration not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Chat Integrations'],
          summary: 'Update chat integration',
          operationId: 'updateChatIntegration',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    config: { type: 'object' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Chat integration updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Chat Integrations'],
          summary: 'Delete chat integration',
          operationId: 'deleteChatIntegration',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Chat integration deleted',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/integrations/chat/{id}/test': {
        post: {
          tags: ['Chat Integrations'],
          summary: 'Test chat integration',
          operationId: 'testChatIntegration',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Chat integration tested',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/integrations/chat/{id}/disconnect': {
        post: {
          tags: ['Chat Integrations'],
          summary: 'Disconnect chat integration',
          operationId: 'disconnectChatIntegration',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Chat integration disconnected',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/admin/notification-rules': {
        get: {
          tags: ['Admin Notification Rules'],
          summary: 'List system notification rules',
          operationId: 'listAdminNotificationRules',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'System notification rules retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Admin Notification Rules'],
          summary: 'Create system notification rule',
          operationId: 'createAdminNotificationRule',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    eventType: { type: 'string' },
                    channels: { type: 'array', items: { type: 'string' } },
                    enabled: { type: 'boolean' },
                  },
                  required: ['eventType', 'channels'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'System notification rule created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/admin/notification-rules/{id}': {
        get: {
          tags: ['Admin Notification Rules'],
          summary: 'Get system notification rule',
          operationId: 'getAdminNotificationRule',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'System notification rule retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'System notification rule not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Admin Notification Rules'],
          summary: 'Update system notification rule',
          operationId: 'updateAdminNotificationRule',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    eventType: { type: 'string' },
                    channels: { type: 'array', items: { type: 'string' } },
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'System notification rule updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Admin Notification Rules'],
          summary: 'Delete system notification rule',
          operationId: 'deleteAdminNotificationRule',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'System notification rule deleted',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/notification-rules': {
        get: {
          tags: ['Notification Rules'],
          summary: 'List user notification rules',
          operationId: 'listNotificationRules',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'User notification rules retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Notification Rules'],
          summary: 'Create user notification rule',
          operationId: 'createNotificationRule',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    eventType: { type: 'string' },
                    channels: { type: 'array', items: { type: 'string' } },
                    enabled: { type: 'boolean' },
                  },
                  required: ['eventType', 'channels'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'User notification rule created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/notification-rules/{id}': {
        get: {
          tags: ['Notification Rules'],
          summary: 'Get user notification rule',
          operationId: 'getNotificationRule',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'User notification rule retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'User notification rule not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Notification Rules'],
          summary: 'Update user notification rule',
          operationId: 'updateNotificationRule',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    eventType: { type: 'string' },
                    channels: { type: 'array', items: { type: 'string' } },
                    enabled: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'User notification rule updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Notification Rules'],
          summary: 'Delete user notification rule',
          operationId: 'deleteNotificationRule',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'User notification rule deleted',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/assessors': {
        get: {
          tags: ['Assessors'],
          summary: 'List assessors',
          operationId: 'listAssessors',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Assessors retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        post: {
          tags: ['Assessors'],
          summary: 'Create assessor',
          operationId: 'createAssessor',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    thirdParty: { type: 'boolean' },
                    entityId: { type: 'string' },
                    userId: { type: 'string' },
                  },
                  required: ['thirdParty'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Assessor created',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/assessors/{id}': {
        get: {
          tags: ['Assessors'],
          summary: 'Get assessor',
          operationId: 'getAssessor',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Assessor retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '404': {
              description: 'Assessor not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
        put: {
          tags: ['Assessors'],
          summary: 'Update assessor',
          operationId: 'updateAssessor',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    thirdParty: { type: 'boolean' },
                    entityId: { type: 'string' },
                    userId: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Assessor updated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
        delete: {
          tags: ['Assessors'],
          summary: 'Delete assessor',
          operationId: 'deleteAssessor',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Assessor deleted',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
      '/v1/admin/encryption/status': {
        get: {
          tags: ['Admin Encryption'],
          summary: 'Get encryption status',
          operationId: 'getEncryptionStatus',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Encryption status retrieved',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '401': {
              description: 'Not authenticated',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                },
              },
            },
          },
        },
      },
      '/v1/admin/encryption/rotate': {
        post: {
          tags: ['Admin Encryption'],
          summary: 'Rotate encryption key',
          operationId: 'rotateEncryptionKey',
          security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
          responses: {
            '200': {
              description: 'Encryption key rotated',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            roleId: { type: 'string', nullable: true },
            role: { $ref: '#/components/schemas/Role' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'email', 'isActive', 'createdAt', 'updatedAt'],
        },
        Role: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            permissions: {
              type: 'array',
              items: { type: 'string' },
            },
            isBuiltIn: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'permissions', 'isBuiltIn', 'createdAt', 'updatedAt'],
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            standardId: { type: 'string' },
            standard: { $ref: '#/components/schemas/Standard' },
            state: { type: 'string', enum: ['active', 'archived'] },
            createdBy: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'standardId', 'state', 'createdAt', 'updatedAt'],
        },
        Standard: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            version: { type: 'string', nullable: true },
            description: { type: 'string', nullable: true },
            requirementCount: { type: 'integer', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'createdAt', 'updatedAt'],
        },
        Assessment: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            projectId: { type: 'string' },
            standardId: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            state: {
              type: 'string',
              enum: ['draft', 'in-progress', 'completed', 'archived'],
            },
            dueDate: { type: 'string', format: 'date', nullable: true },
            startedAt: { type: 'string', format: 'date-time', nullable: true },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
            createdBy: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'projectId', 'standardId', 'name', 'state', 'createdAt', 'updatedAt'],
        },
        Evidence: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            type: { type: 'string' },
            assessmentId: { type: 'string', nullable: true },
            createdBy: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'title', 'type', 'createdAt', 'updatedAt'],
        },
        Claim: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            requirementId: { type: 'string' },
            assessmentId: { type: 'string', nullable: true },
            statement: { type: 'string' },
            evidence: {
              type: 'array',
              items: { type: 'string' },
            },
            createdBy: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'requirementId', 'statement', 'createdAt', 'updatedAt'],
        },
        Attestation: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            assessmentId: { type: 'string' },
            claims: {
              type: 'array',
              items: { type: 'string' },
            },
            bomRef: { type: 'string', nullable: true },
            state: { type: 'string', enum: ['draft', 'published', 'archived'] },
            createdBy: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'assessmentId', 'claims', 'state', 'createdAt', 'updatedAt'],
        },
        Tag: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            color: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name', 'createdAt', 'updatedAt'],
        },
        Pagination: {
          type: 'object',
          properties: {
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            total: { type: 'integer' },
            hasMore: { type: 'boolean' },
          },
          required: ['limit', 'offset', 'total', 'hasMore'],
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string', nullable: true },
            code: { type: 'string', nullable: true },
          },
          required: ['error'],
        },
      },
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'token',
          description: 'JWT session cookie authentication',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Api-Key',
          description: 'API key authentication via X-Api-Key header',
        },
      },
    },
    tags: [
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
      {
        name: 'Setup',
        description: 'System setup and initialization',
      },
      {
        name: 'Auth',
        description: 'Authentication and user session management',
      },
      {
        name: 'Projects',
        description: 'Project management',
      },
      {
        name: 'Standards',
        description: 'Compliance standards management',
      },
      {
        name: 'Assessments',
        description: 'Security assessment management',
      },
      {
        name: 'Evidence',
        description: 'Evidence and documentation',
      },
      {
        name: 'Claims',
        description: 'Compliance claims',
      },
      {
        name: 'Attestations',
        description: 'Attestation and CycloneDX declarations',
      },
      {
        name: 'Users',
        description: 'User management (admin only)',
      },
      {
        name: 'Roles',
        description: 'Role and permission management (admin only)',
      },
      {
        name: 'Tags',
        description: 'Tag management',
      },
      {
        name: 'API Keys',
        description: 'API key management',
      },
      {
        name: 'Dashboard',
        description: 'Dashboard and analytics',
      },
      {
        name: 'Import',
        description: 'Import external data',
      },
      {
        name: 'Webhooks',
        description: 'Webhook management (admin only)',
      },
      {
        name: 'Chat Integrations',
        description: 'Chat platform integrations (admin only)',
      },
      {
        name: 'Notification Rules',
        description: 'User notification rules',
      },
      {
        name: 'Admin Notification Rules',
        description: 'System notification rules (admin only)',
      },
      {
        name: 'Assessors',
        description: 'Assessor management',
      },
      {
        name: 'Admin Encryption',
        description: 'Encryption management (admin only)',
      },
    ],
  };
}
