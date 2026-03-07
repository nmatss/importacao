import {
  pgTable,
  pgEnum,
  serial,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

// ── Enums ──────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['admin', 'analyst']);

export const processStatusEnum = pgEnum('process_status', [
  'draft',
  'documents_received',
  'validating',
  'validated',
  'espelho_generated',
  'sent_to_fenicia',
  'li_pending',
  'completed',
  'cancelled',
]);

export const brandEnum = pgEnum('brand', ['puket', 'imaginarium']);

export const documentTypeEnum = pgEnum('document_type', [
  'invoice',
  'packing_list',
  'ohbl',
  'espelho',
  'li',
  'other',
]);

export const validationStatusEnum = pgEnum('validation_status', [
  'passed',
  'failed',
  'warning',
  'skipped',
]);

export const currencyTypeEnum = pgEnum('currency_type', ['balance', 'deposit']);

export const communicationStatusEnum = pgEnum('communication_status', [
  'draft',
  'sent',
  'failed',
]);

export const alertSeverityEnum = pgEnum('alert_severity', [
  'info',
  'warning',
  'critical',
]);

// ── Tables ─────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: userRoleEnum('role').default('analyst').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const importProcesses = pgTable('import_processes', {
  id: serial('id').primaryKey(),
  processCode: varchar('process_code', { length: 50 }).notNull().unique(),
  brand: brandEnum('brand').notNull(),
  status: processStatusEnum('status').default('draft').notNull(),
  incoterm: varchar('incoterm', { length: 10 }).default('FOB'),
  portOfLoading: varchar('port_of_loading', { length: 100 }),
  portOfDischarge: varchar('port_of_discharge', { length: 100 }),
  etd: date('etd'),
  eta: date('eta'),
  shipmentDate: date('shipment_date'),
  totalFobValue: numeric('total_fob_value', { precision: 12, scale: 2 }),
  freightValue: numeric('freight_value', { precision: 12, scale: 2 }),
  totalBoxes: integer('total_boxes'),
  totalNetWeight: numeric('total_net_weight', { precision: 10, scale: 3 }),
  totalGrossWeight: numeric('total_gross_weight', { precision: 10, scale: 3 }),
  totalCbm: numeric('total_cbm', { precision: 10, scale: 3 }),
  exporterName: varchar('exporter_name', { length: 255 }),
  exporterAddress: text('exporter_address'),
  importerName: varchar('importer_name', { length: 255 }),
  importerAddress: text('importer_address'),
  hasLiItems: boolean('has_li_items').default(false),
  hasCertification: boolean('has_certification').default(false),
  hasFreeOfCharge: boolean('has_free_of_charge').default(false),
  correctionStatus: varchar('correction_status', { length: 30 }),
  paymentTerms: jsonb('payment_terms'),
  containerType: varchar('container_type', { length: 50 }),
  driveFolderId: varchar('drive_folder_id', { length: 255 }),
  sistemaDriveFolderId: varchar('sistema_drive_folder_id', { length: 255 }),
  aiExtractedData: jsonb('ai_extracted_data'),
  notes: text('notes'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('import_processes_status_idx').on(table.status),
  index('import_processes_brand_idx').on(table.brand),
]);

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  processId: integer('process_id')
    .references(() => importProcesses.id)
    .notNull(),
  type: documentTypeEnum('type').notNull(),
  originalFilename: varchar('original_filename', { length: 500 }).notNull(),
  storagePath: varchar('storage_path', { length: 500 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }),
  fileSize: integer('file_size'),
  driveFileId: varchar('drive_file_id', { length: 255 }),
  aiParsedData: jsonb('ai_parsed_data'),
  confidenceScore: numeric('confidence_score', { precision: 5, scale: 4 }),
  isProcessed: boolean('is_processed').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('documents_process_id_idx').on(table.processId),
]);

export const processItems = pgTable('process_items', {
  id: serial('id').primaryKey(),
  processId: integer('process_id')
    .references(() => importProcesses.id)
    .notNull(),
  itemCode: varchar('item_code', { length: 100 }),
  description: text('description'),
  color: varchar('color', { length: 100 }),
  size: varchar('size', { length: 50 }),
  ncmCode: varchar('ncm_code', { length: 20 }),
  unitPrice: numeric('unit_price', { precision: 10, scale: 4 }),
  quantity: integer('quantity'),
  totalPrice: numeric('total_price', { precision: 12, scale: 2 }),
  boxQuantity: integer('box_quantity'),
  netWeight: numeric('net_weight', { precision: 10, scale: 3 }),
  grossWeight: numeric('gross_weight', { precision: 10, scale: 3 }),
  manufacturer: varchar('manufacturer', { length: 255 }),
  unitType: varchar('unit_type', { length: 20 }),
  isFreeOfCharge: boolean('is_free_of_charge').default(false),
  requiresLi: boolean('requires_li').default(false),
  requiresCertification: boolean('requires_certification').default(false),
  odooProductId: integer('odoo_product_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('process_items_process_id_idx').on(table.processId),
]);

export const validationResults = pgTable('validation_results', {
  id: serial('id').primaryKey(),
  processId: integer('process_id')
    .references(() => importProcesses.id)
    .notNull(),
  checkName: varchar('check_name', { length: 100 }).notNull(),
  status: validationStatusEnum('status').notNull(),
  expectedValue: text('expected_value'),
  actualValue: text('actual_value'),
  documentsCompared: varchar('documents_compared', { length: 255 }),
  message: text('message'),
  dataSource: varchar('data_source', { length: 50 }).default('cross_document'),
  resolvedManually: boolean('resolved_manually').default(false),
  resolvedBy: integer('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('validation_results_process_id_idx').on(table.processId),
]);

export const currencyExchanges = pgTable('currency_exchanges', {
  id: serial('id').primaryKey(),
  processId: integer('process_id')
    .references(() => importProcesses.id)
    .notNull(),
  type: currencyTypeEnum('type').notNull(),
  amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull(),
  exchangeRate: numeric('exchange_rate', { precision: 10, scale: 6 }),
  amountBrl: numeric('amount_brl', { precision: 12, scale: 2 }),
  paymentDeadline: date('payment_deadline'),
  expirationDate: date('expiration_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('currency_exchanges_process_id_idx').on(table.processId),
]);

export const followUpTracking = pgTable('follow_up_tracking', {
  id: serial('id').primaryKey(),
  processId: integer('process_id')
    .references(() => importProcesses.id)
    .notNull()
    .unique(),
  documentsReceivedAt: timestamp('documents_received_at'),
  preInspectionAt: timestamp('pre_inspection_at'),
  ncmVerifiedAt: timestamp('ncm_verified_at'),
  espelhoGeneratedAt: timestamp('espelho_generated_at'),
  sentToFeniciaAt: timestamp('sent_to_fenicia_at'),
  liSubmittedAt: timestamp('li_submitted_at'),
  liApprovedAt: timestamp('li_approved_at'),
  liDeadline: date('li_deadline'),
  overallProgress: integer('overall_progress').default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const espelhos = pgTable('espelhos', {
  id: serial('id').primaryKey(),
  processId: integer('process_id')
    .references(() => importProcesses.id)
    .notNull(),
  brand: brandEnum('brand').notNull(),
  version: integer('version').default(1),
  isPartial: boolean('is_partial').default(false),
  generatedData: jsonb('generated_data'),
  driveFileId: varchar('drive_file_id', { length: 255 }),
  sentToFenicia: boolean('sent_to_fenicia').default(false),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('espelhos_process_id_idx').on(table.processId),
]);

export const communications = pgTable('communications', {
  id: serial('id').primaryKey(),
  processId: integer('process_id').references(() => importProcesses.id),
  recipient: varchar('recipient', { length: 255 }).notNull(),
  recipientEmail: varchar('recipient_email', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 500 }).notNull(),
  body: text('body').notNull(),
  attachments: jsonb('attachments'),
  status: communicationStatusEnum('status').default('draft').notNull(),
  sentAt: timestamp('sent_at'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('communications_process_id_idx').on(table.processId),
]);

export const alerts = pgTable('alerts', {
  id: serial('id').primaryKey(),
  processId: integer('process_id').references(() => importProcesses.id),
  severity: alertSeverityEnum('severity').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  sentToChat: boolean('sent_to_chat').default(false),
  sentAt: timestamp('sent_at'),
  acknowledged: boolean('acknowledged').default(false),
  acknowledgedBy: integer('acknowledged_by').references(() => users.id),
  acknowledgedAt: timestamp('acknowledged_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('alerts_process_id_idx').on(table.processId),
]);

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 100 }),
  entityId: integer('entity_id'),
  details: jsonb('details'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('audit_logs_user_id_idx').on(table.userId),
]);

export const systemSettings = pgTable('system_settings', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const emailIngestionStatusEnum = pgEnum('email_ingestion_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'ignored',
]);

export const emailIngestionLogs = pgTable('email_ingestion_logs', {
  id: serial('id').primaryKey(),
  messageId: varchar('message_id', { length: 500 }).notNull().unique(),
  fromAddress: varchar('from_address', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 500 }).notNull(),
  receivedAt: timestamp('received_at').notNull(),
  processId: integer('process_id').references(() => importProcesses.id),
  status: emailIngestionStatusEnum('status').default('pending').notNull(),
  attachmentsCount: integer('attachments_count').default(0),
  processedAttachments: jsonb('processed_attachments'),
  errorMessage: text('error_message'),
  processCode: varchar('process_code', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('email_ingestion_logs_process_id_idx').on(table.processId),
  index('email_ingestion_logs_status_idx').on(table.status),
]);

// ── TypeScript Types ───────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type ImportProcess = typeof importProcesses.$inferSelect;
export type NewImportProcess = typeof importProcesses.$inferInsert;

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

export type ProcessItem = typeof processItems.$inferSelect;
export type NewProcessItem = typeof processItems.$inferInsert;

export type ValidationResult = typeof validationResults.$inferSelect;
export type NewValidationResult = typeof validationResults.$inferInsert;

export type CurrencyExchange = typeof currencyExchanges.$inferSelect;
export type NewCurrencyExchange = typeof currencyExchanges.$inferInsert;

export type FollowUpTracking = typeof followUpTracking.$inferSelect;
export type NewFollowUpTracking = typeof followUpTracking.$inferInsert;

export type Espelho = typeof espelhos.$inferSelect;
export type NewEspelho = typeof espelhos.$inferInsert;

export type Communication = typeof communications.$inferSelect;
export type NewCommunication = typeof communications.$inferInsert;

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;

export type EmailIngestionLog = typeof emailIngestionLogs.$inferSelect;
export type NewEmailIngestionLog = typeof emailIngestionLogs.$inferInsert;
