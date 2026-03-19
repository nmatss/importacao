/**
 * OpenAPI 3.0 specification for the Importacao API.
 *
 * This is a hand-maintained spec derived from the route files.
 * Server URL is configurable via the API_BASE_URL env var.
 */

const serverUrl = process.env.API_BASE_URL || 'http://localhost:3001';

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Importacao API',
    version: '1.0.0',
    description:
      'Backend API for the Import Management System. Handles processes, documents, validation, AI extraction, email ingestion, follow-up, alerts, communications, dashboards, and more.',
  },
  servers: [{ url: serverUrl, description: 'API server' }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http' as const,
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      SuccessResponse: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'object' as const },
        },
      },
      ErrorResponse: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const, example: false },
          error: { type: 'string' as const },
        },
      },
      PaginatedResponse: {
        type: 'object' as const,
        properties: {
          success: { type: 'boolean' as const },
          data: { type: 'array' as const, items: { type: 'object' as const } },
          pagination: {
            type: 'object' as const,
            properties: {
              page: { type: 'integer' as const },
              limit: { type: 'integer' as const },
              total: { type: 'integer' as const },
            },
          },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Authentication and user management' },
    { name: 'Processes', description: 'Import processes CRUD' },
    { name: 'Documents', description: 'Document upload and management' },
    { name: 'Validation', description: 'Document validation checks' },
    { name: 'AI', description: 'AI extraction and analysis' },
    { name: 'Alerts', description: 'System alerts' },
    { name: 'Communications', description: 'Email communications' },
    { name: 'Email Ingestion', description: 'Inbound email processing' },
    { name: 'Follow-Up', description: 'Process follow-up tracking' },
    { name: 'LI Tracking', description: 'Import license tracking' },
    { name: 'Dashboard', description: 'Dashboard and analytics' },
    { name: 'Espelhos', description: 'Mirror documents (espelhos)' },
    { name: 'Currency Exchange', description: 'Currency exchange records' },
    { name: 'Settings', description: 'System settings (admin)' },
    { name: 'Audit', description: 'Audit logs (admin)' },
  ],
  paths: {
    // ─── Health ──────────────────────────────────────────────
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'API health check',
        security: [],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'App-level health check (includes DB)',
        security: [],
        responses: { '200': { description: 'OK' }, '503': { description: 'DB degraded' } },
      },
    },

    // ─── Auth ────────────────────────────────────────────────
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                properties: {
                  email: { type: 'string' as const },
                  password: { type: 'string' as const },
                },
                required: ['email', 'password'],
              },
            },
          },
        },
        responses: { '200': { description: 'JWT token returned' } },
      },
    },
    '/api/auth/google': {
      post: {
        tags: ['Auth'],
        summary: 'Login with Google OAuth',
        security: [],
        responses: { '200': { description: 'JWT token returned' } },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user profile',
        responses: { '200': { description: 'User profile' } },
      },
    },
    '/api/auth/users': {
      get: {
        tags: ['Auth'],
        summary: 'List all users (admin)',
        responses: { '200': { description: 'List of users' } },
      },
      post: {
        tags: ['Auth'],
        summary: 'Create a user (admin)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' as const } } },
        },
        responses: { '201': { description: 'User created' } },
      },
    },
    '/api/auth/users/{id}': {
      put: {
        tags: ['Auth'],
        summary: 'Update a user (admin)',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'User updated' } },
      },
      delete: {
        tags: ['Auth'],
        summary: 'Delete a user (admin)',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'User deleted' } },
      },
    },

    // ─── Processes ───────────────────────────────────────────
    '/api/processes': {
      get: {
        tags: ['Processes'],
        summary: 'List all import processes',
        responses: { '200': { description: 'Paginated list' } },
      },
      post: {
        tags: ['Processes'],
        summary: 'Create a new import process',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' as const } } },
        },
        responses: { '201': { description: 'Process created' } },
      },
    },
    '/api/processes/stats': {
      get: {
        tags: ['Processes'],
        summary: 'Get process statistics',
        responses: { '200': { description: 'Stats object' } },
      },
    },
    '/api/processes/{id}': {
      get: {
        tags: ['Processes'],
        summary: 'Get process by ID',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Process detail' } },
      },
      put: {
        tags: ['Processes'],
        summary: 'Update a process',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Process updated' } },
      },
      delete: {
        tags: ['Processes'],
        summary: 'Delete a process',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Process deleted' } },
      },
    },
    '/api/processes/{id}/status': {
      patch: {
        tags: ['Processes'],
        summary: 'Update process status',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Status updated' } },
      },
    },

    // ─── Documents ───────────────────────────────────────────
    '/api/documents/upload': {
      post: {
        tags: ['Documents'],
        summary: 'Upload a document',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object' as const,
                properties: { file: { type: 'string' as const, format: 'binary' } },
              },
            },
          },
        },
        responses: { '201': { description: 'Document uploaded' } },
      },
    },
    '/api/documents/process/{processId}': {
      get: {
        tags: ['Documents'],
        summary: 'Get documents for a process',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'List of documents' } },
      },
    },
    '/api/documents/process/{processId}/comparison': {
      get: {
        tags: ['Documents'],
        summary: 'Compare documents for a process',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Comparison data' } },
      },
    },
    '/api/documents/{id}': {
      get: {
        tags: ['Documents'],
        summary: 'Get document by ID',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Document detail' } },
      },
      delete: {
        tags: ['Documents'],
        summary: 'Delete a document',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Document deleted' } },
      },
    },
    '/api/documents/{id}/source': {
      get: {
        tags: ['Documents'],
        summary: 'Get document source file',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Source file' } },
      },
    },
    '/api/documents/{id}/reprocess': {
      post: {
        tags: ['Documents'],
        summary: 'Reprocess a document through AI extraction',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Document reprocessed' } },
      },
    },

    // ─── Validation ──────────────────────────────────────────
    '/api/validation/{processId}/run': {
      post: {
        tags: ['Validation'],
        summary: 'Run all validation checks for a process',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Validation results' } },
      },
    },
    '/api/validation/{processId}': {
      get: {
        tags: ['Validation'],
        summary: 'Get validation results',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Validation results' } },
      },
    },
    '/api/validation/{processId}/report': {
      get: {
        tags: ['Validation'],
        summary: 'Get validation report',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Report data' } },
      },
    },
    '/api/validation/results/{id}/resolve': {
      patch: {
        tags: ['Validation'],
        summary: 'Manually resolve a validation result',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Result resolved' } },
      },
    },
    '/api/validation/{processId}/anomalies': {
      post: {
        tags: ['Validation'],
        summary: 'Run AI anomaly detection',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Anomaly results' } },
      },
    },
    '/api/validation/{processId}/correction-draft': {
      post: {
        tags: ['Validation'],
        summary: 'Generate correction email draft',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Draft generated' } },
      },
    },

    // ─── AI ──────────────────────────────────────────────────
    '/api/ai/extract': {
      post: {
        tags: ['AI'],
        summary: 'Extract data from a document via AI',
        responses: { '200': { description: 'Extracted data' } },
      },
    },
    '/api/ai/anomalies': {
      post: {
        tags: ['AI'],
        summary: 'Detect anomalies via AI',
        responses: { '200': { description: 'Anomaly results' } },
      },
    },
    '/api/ai/email-draft': {
      post: {
        tags: ['AI'],
        summary: 'Generate email draft via AI',
        responses: { '200': { description: 'Email draft' } },
      },
    },
    '/api/ai/validate-ncm': {
      post: {
        tags: ['AI'],
        summary: 'Validate NCM codes via AI',
        responses: { '200': { description: 'Validation result' } },
      },
    },

    // ─── Alerts ──────────────────────────────────────────────
    '/api/alerts': {
      get: {
        tags: ['Alerts'],
        summary: 'List alerts',
        responses: { '200': { description: 'Paginated alerts' } },
      },
      post: {
        tags: ['Alerts'],
        summary: 'Create an alert',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' as const } } },
        },
        responses: { '201': { description: 'Alert created' } },
      },
    },
    '/api/alerts/{id}/acknowledge': {
      patch: {
        tags: ['Alerts'],
        summary: 'Acknowledge an alert',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Alert acknowledged' } },
      },
    },

    // ─── Communications ──────────────────────────────────────
    '/api/communications': {
      get: {
        tags: ['Communications'],
        summary: 'List communications',
        responses: { '200': { description: 'List' } },
      },
      post: {
        tags: ['Communications'],
        summary: 'Create a communication',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' as const } } },
        },
        responses: { '201': { description: 'Communication created' } },
      },
    },
    '/api/communications/process/{processId}': {
      get: {
        tags: ['Communications'],
        summary: 'List communications by process',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'List' } },
      },
    },
    '/api/communications/{id}/send': {
      post: {
        tags: ['Communications'],
        summary: 'Send a communication email',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Email sent' } },
      },
    },
    '/api/communications/{id}/draft': {
      patch: {
        tags: ['Communications'],
        summary: 'Update a communication draft',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Draft updated' } },
      },
    },

    // ─── Email Ingestion ─────────────────────────────────────
    '/api/email-ingestion/status': {
      get: {
        tags: ['Email Ingestion'],
        summary: 'Get email ingestion status',
        responses: { '200': { description: 'Status' } },
      },
    },
    '/api/email-ingestion/logs': {
      get: {
        tags: ['Email Ingestion'],
        summary: 'Get email ingestion logs',
        responses: { '200': { description: 'Logs' } },
      },
    },
    '/api/email-ingestion/trigger': {
      post: {
        tags: ['Email Ingestion'],
        summary: 'Trigger email check manually',
        responses: { '200': { description: 'Triggered' } },
      },
    },
    '/api/email-ingestion/reprocess/{logId}': {
      post: {
        tags: ['Email Ingestion'],
        summary: 'Reprocess an ingested email',
        parameters: [
          {
            name: 'logId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Reprocessed' } },
      },
    },

    // ─── Follow-Up ───────────────────────────────────────────
    '/api/follow-up': {
      get: {
        tags: ['Follow-Up'],
        summary: 'Get all follow-ups',
        responses: { '200': { description: 'List' } },
      },
    },
    '/api/follow-up/deadlines/li': {
      get: {
        tags: ['Follow-Up'],
        summary: 'Get LI deadline follow-ups',
        responses: { '200': { description: 'List' } },
      },
    },
    '/api/follow-up/sheet-compare/{processCode}': {
      get: {
        tags: ['Follow-Up'],
        summary: 'Compare follow-up with Google Sheet',
        parameters: [
          {
            name: 'processCode',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Comparison data' } },
      },
    },
    '/api/follow-up/sync-from-sheet/{processCode}': {
      post: {
        tags: ['Follow-Up'],
        summary: 'Sync follow-up from Google Sheet',
        parameters: [
          {
            name: 'processCode',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Synced' } },
      },
    },
    '/api/follow-up/{processId}': {
      get: {
        tags: ['Follow-Up'],
        summary: 'Get follow-up for a process',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Follow-up data' } },
      },
      put: {
        tags: ['Follow-Up'],
        summary: 'Update follow-up for a process',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Updated' } },
      },
    },

    // ─── LI Tracking ─────────────────────────────────────────
    '/api/li-tracking': {
      get: {
        tags: ['LI Tracking'],
        summary: 'List all LI tracking records',
        responses: { '200': { description: 'List' } },
      },
      post: {
        tags: ['LI Tracking'],
        summary: 'Create LI tracking record',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' as const } } },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/li-tracking/stats': {
      get: {
        tags: ['LI Tracking'],
        summary: 'Get LI tracking statistics',
        responses: { '200': { description: 'Stats' } },
      },
    },
    '/api/li-tracking/process/{processCode}': {
      get: {
        tags: ['LI Tracking'],
        summary: 'Get LI tracking by process code',
        parameters: [
          {
            name: 'processCode',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'LI data' } },
      },
    },
    '/api/li-tracking/{id}': {
      put: {
        tags: ['LI Tracking'],
        summary: 'Update LI tracking record',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['LI Tracking'],
        summary: 'Delete LI tracking record',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },

    // ─── Dashboard ───────────────────────────────────────────
    '/api/dashboard/overview': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get dashboard overview',
        responses: { '200': { description: 'Overview data' } },
      },
    },
    '/api/dashboard/by-status': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get processes grouped by status',
        responses: { '200': { description: 'Data' } },
      },
    },
    '/api/dashboard/by-month': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get processes grouped by month',
        responses: { '200': { description: 'Data' } },
      },
    },
    '/api/dashboard/fob-by-brand': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get FOB values by brand',
        responses: { '200': { description: 'Data' } },
      },
    },
    '/api/dashboard/sla': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get SLA dashboard',
        responses: { '200': { description: 'SLA data' } },
      },
    },
    '/api/dashboard/executive': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get executive KPIs',
        responses: { '200': { description: 'KPI data' } },
      },
    },
    '/api/dashboard/executive/timeline': {
      get: {
        tags: ['Dashboard'],
        summary: 'Get processing timeline',
        responses: { '200': { description: 'Timeline data' } },
      },
    },

    // ─── Espelhos ────────────────────────────────────────────
    '/api/espelhos/items/{id}': {
      put: {
        tags: ['Espelhos'],
        summary: 'Update an espelho item',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Item updated' } },
      },
      delete: {
        tags: ['Espelhos'],
        summary: 'Delete an espelho item',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Item deleted' } },
      },
    },
    '/api/espelhos/{id}/download': {
      get: {
        tags: ['Espelhos'],
        summary: 'Download espelho file',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'File download' } },
      },
    },
    '/api/espelhos/{id}/sent': {
      patch: {
        tags: ['Espelhos'],
        summary: 'Mark espelho as sent to Fenicia',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Marked' } },
      },
    },
    '/api/espelhos/{processId}': {
      get: {
        tags: ['Espelhos'],
        summary: 'Get espelho for a process',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Espelho data' } },
      },
    },
    '/api/espelhos/{processId}/generate': {
      post: {
        tags: ['Espelhos'],
        summary: 'Generate espelho for a process',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Espelho generated' } },
      },
    },
    '/api/espelhos/{processId}/items': {
      get: {
        tags: ['Espelhos'],
        summary: 'Get espelho items',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Items list' } },
      },
      post: {
        tags: ['Espelhos'],
        summary: 'Add espelho item',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '201': { description: 'Item added' } },
      },
    },
    '/api/espelhos/{processId}/generate-partial': {
      post: {
        tags: ['Espelhos'],
        summary: 'Generate partial espelho',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Partial espelho generated' } },
      },
    },
    '/api/espelhos/{processId}/send-drive': {
      post: {
        tags: ['Espelhos'],
        summary: 'Send espelho to Google Drive',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Sent to Drive' } },
      },
    },
    '/api/espelhos/{processId}/send-fenicia': {
      post: {
        tags: ['Espelhos'],
        summary: 'Send espelho to Fenicia',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Sent to Fenicia' } },
      },
    },

    // ─── Currency Exchange ───────────────────────────────────
    '/api/currency-exchange/process/{processId}': {
      get: {
        tags: ['Currency Exchange'],
        summary: 'List currency exchanges for a process',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'List' } },
      },
    },
    '/api/currency-exchange/process/{processId}/totals': {
      get: {
        tags: ['Currency Exchange'],
        summary: 'Get currency exchange totals for a process',
        parameters: [
          {
            name: 'processId',
            in: 'path' as const,
            required: true,
            schema: { type: 'string' as const },
          },
        ],
        responses: { '200': { description: 'Totals' } },
      },
    },
    '/api/currency-exchange': {
      post: {
        tags: ['Currency Exchange'],
        summary: 'Create currency exchange record',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' as const } } },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/currency-exchange/{id}': {
      put: {
        tags: ['Currency Exchange'],
        summary: 'Update currency exchange record',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Currency Exchange'],
        summary: 'Delete currency exchange record',
        parameters: [
          { name: 'id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },

    // ─── Settings (admin) ────────────────────────────────────
    '/api/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get all settings (admin)',
        responses: { '200': { description: 'Settings list' } },
      },
    },
    '/api/settings/smtp': {
      get: {
        tags: ['Settings'],
        summary: 'Get SMTP settings',
        responses: { '200': { description: 'SMTP config' } },
      },
      put: {
        tags: ['Settings'],
        summary: 'Save SMTP settings',
        responses: { '200': { description: 'Saved' } },
      },
    },
    '/api/settings/integrations': {
      get: {
        tags: ['Settings'],
        summary: 'Get integration settings',
        responses: { '200': { description: 'Integration config' } },
      },
      put: {
        tags: ['Settings'],
        summary: 'Save integration settings',
        responses: { '200': { description: 'Saved' } },
      },
    },
    '/api/settings/integrations/test-drive': {
      post: {
        tags: ['Settings'],
        summary: 'Test Google Drive connection',
        responses: { '200': { description: 'Test result' } },
      },
    },
    '/api/settings/integrations/test-odoo': {
      post: {
        tags: ['Settings'],
        summary: 'Test Odoo connection',
        responses: { '200': { description: 'Test result' } },
      },
    },
    '/api/settings/{key}': {
      get: {
        tags: ['Settings'],
        summary: 'Get a setting by key',
        parameters: [
          { name: 'key', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Setting value' } },
      },
      put: {
        tags: ['Settings'],
        summary: 'Set a setting by key',
        parameters: [
          { name: 'key', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: { '200': { description: 'Saved' } },
      },
    },

    // ─── Audit (admin) ──────────────────────────────────────
    '/api/audit/logs': {
      get: {
        tags: ['Audit'],
        summary: 'Get audit logs (admin)',
        responses: { '200': { description: 'Logs list' } },
      },
    },
  },
};
