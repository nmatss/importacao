// ── Shared domain types ────────────────────────────────────────────────
// Consolidated from duplicated definitions across the frontend.

/** AI-extracted metadata attached to a process. */
export interface AiExtractedData {
  blNumber?: string;
  vessel?: string;
  shipowner?: string;
  freightAgent?: string;
  originCountry?: string;
  originCity?: string;
  destinationPort?: string;
  invoiceNumber?: string;
  packingListNumber?: string;
  consolidation?: string;
  company?: string;
  [key: string]: unknown;
}

/** Follow-up tracking data for a process. */
export interface FollowUpTracking {
  id: number;
  processId: number;
  documentsReceivedAt: string | null;
  preInspectionAt: string | null;
  ncmVerifiedAt: string | null;
  espelhoGeneratedAt: string | null;
  sentToFeniciaAt: string | null;
  liSubmittedAt: string | null;
  liApprovedAt: string | null;
  liDeadline: string | null;
  overallProgress: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full import process (detail view). */
export interface ImportProcess {
  id: number;
  processCode: string;
  brand: string;
  status: string;
  incoterm: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  etd: string | null;
  eta: string | null;
  shipmentDate: string | null;
  exporterName: string | null;
  exporterAddress: string | null;
  importerName: string | null;
  importerAddress: string | null;
  totalFobValue: string | null;
  freightValue: string | null;
  totalBoxes: number | null;
  totalNetWeight: string | null;
  totalGrossWeight: string | null;
  totalCbm: string | null;
  containerType: string | null;
  hasLiItems: boolean;
  hasCertification: boolean;
  hasFreeOfCharge: boolean;
  correctionStatus: string | null;
  paymentTerms: Record<string, unknown> | null;
  aiExtractedData: AiExtractedData | null;
  notes: string | null;
  driveFolderId: string | null;
  sistemaDriveFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  documents: Array<{
    id: number;
    type: string;
    originalFilename: string;
    isProcessed: boolean;
  }>;
  followUp: FollowUpTracking | null;
}

/** Lightweight process reference used in list/select contexts. */
export interface ProcessSummary {
  id: number;
  processCode: string;
  brand: string;
}

/** Document attached to a process. */
export interface Document {
  id: number;
  fileName: string;
  documentType: string;
  uploadedAt: string;
  aiProcessingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  aiParsedData?: Record<string, unknown>;
  aiConfidence?: number;
  driveFileId?: string | null;
}

/** Single espelho line item. */
export interface EspelhoItem {
  id: number;
  itemCode: string;
  description: string;
  color: string;
  size: string;
  ncm: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  boxes: number;
  netWeight: number;
  grossWeight: number;
  isFoc: boolean;
  requiresLi: boolean;
  requiresCert: boolean;
}

/** Espelho (mirror) for a process. */
export interface Espelho {
  id: number;
  status: string;
  items: EspelhoItem[];
  totalFobValue: number;
  totalQuantity: number;
  totalNetWeight: number;
  totalGrossWeight: number;
  totalBoxes: number;
  driveFileId?: string | null;
  driveSentAt?: string | null;
  sentToFenicia?: boolean;
  sentToFeniciaAt?: string | null;
}

/** Currency exchange record tied to a process. */
export interface CurrencyExchange {
  id: number;
  type: 'balance' | 'deposit';
  amountUsd: string;
  exchangeRate: string | null;
  amountBrl: string | null;
  paymentDeadline: string | null;
  expirationDate: string | null;
  notes: string | null;
  createdAt: string;
}

/** Currency totals for a process. */
export interface CurrencyTotals {
  totalBalanceUsd: string;
  totalBalanceBrl: string;
  totalDepositUsd: string;
  totalDepositBrl: string;
}

/** Communication / email draft sent from the system. */
export interface Communication {
  id: number;
  recipient: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: 'draft' | 'sent' | 'failed';
  sentAt: string | null;
  errorMessage: string | null;
  attachments: Array<{ filename: string }> | null;
  createdAt: string;
}

/** Email ingestion log. */
export interface EmailLog {
  id: number;
  messageId: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'ignored' | 'reprocessed';
  attachmentsCount: number;
  processedAttachments: Array<{ filename: string; documentId?: number }> | null;
  processCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/** System alert / notification. */
export interface Alert {
  id: number;
  processId: number | null;
  processCode: string | null;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  sentToChat: boolean;
  sentAt: string | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

/** Application user. */
export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  active?: boolean;
}

/** Validation check result (individual check). */
export interface ValidationResult {
  id: number;
  checkName: string;
  status: 'pass' | 'fail' | 'warning' | 'skipped';
  message: string;
  details?: Record<string, unknown>;
}
