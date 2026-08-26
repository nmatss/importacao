import { z } from 'zod';

export const emailListSchema = z
  .string()
  .min(1, 'E-mail obrigatório')
  .max(255, 'Use no máximo 255 caracteres')
  .refine(
    (value) => {
      const emails = value
        .split(/[;,\r\n]/)
        .map((email) => email.trim())
        .filter(Boolean);

      return (
        emails.length > 0 &&
        emails.every((email) => z.string().email('E-mail inválido').safeParse(email).success)
      );
    },
    { message: 'Informe e-mails válidos separados por vírgula ou ponto-e-vírgula' },
  );

export const communicationAttachmentSchema = z
  .object({
    filename: z.string().min(1).max(255).optional(),
    documentId: z.coerce.number().int().positive().optional(),
    espelhoId: z.coerce.number().int().positive().optional(),
  })
  .strict()
  .refine((value) => Number(Boolean(value.documentId)) + Number(Boolean(value.espelhoId)) === 1, {
    message: 'Informe documentId ou espelhoId para anexos',
  });

export const createCommunicationSchema = z
  .object({
    processId: z.number().int().positive().optional(),
    // communications.recipient é varchar(255); manter o zod alinhado à coluna.
    recipient: z.string().trim().min(1, 'Destinatário obrigatório').max(255),
    recipientEmail: emailListSchema,
    subject: z.string().trim().min(1, 'Assunto obrigatório').max(500),
    body: z.string().min(1, 'Corpo do e-mail obrigatório').max(100000),
    attachments: z.array(communicationAttachmentSchema).max(20).optional(),
  })
  .strict();

export type CreateCommunicationInput = z.infer<typeof createCommunicationSchema>;

/**
 * Importacao de anexo vindo do Google Drive.
 *
 * `documentType` usa o mesmo enum de `documents/schema.ts` — o arquivo vira um
 * documento do processo, nao um anexo com storage proprio. O default `other`
 * cobre o caso comum do atendimento (anexo avulso ainda nao classificado).
 */
export const driveImportSchema = z.object({
  processId: z.coerce.number().int().positive(),
  driveFileId: z.string().trim().min(1).max(255),
  documentType: z
    .enum([
      'invoice',
      'proforma_invoice',
      'packing_list',
      'ohbl',
      'draft_bl',
      'draft_duimp',
      'duimp',
      'espelho',
      'li',
      'certificate',
      'other',
    ])
    .default('other'),
});

export type DriveImportInput = z.infer<typeof driveImportSchema>;

export const updateDraftSchema = z
  .object({
    subject: z.string().trim().min(1).max(500).optional(),
    body: z.string().min(1).max(100000).optional(),
    recipient: z.string().trim().min(1).max(255).optional(),
    recipientEmail: emailListSchema.optional(),
    attachments: z.array(communicationAttachmentSchema).max(20).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  });

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato inválido (YYYY-MM-DD)')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Data inválida');

export const communicationListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    processId: z.coerce.number().int().positive().optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
    message: 'A data inicial não pode ser posterior à data final',
    path: ['endDate'],
  });

export const communicationProcessListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const communicationIdParamSchema = z.object({
  id: z.coerce.number().int().positive('ID da comunicação deve ser positivo'),
});

export const communicationProcessIdParamSchema = z.object({
  processId: z.coerce.number().int().positive('ID do processo deve ser positivo'),
});

export const driveFilesQuerySchema = z.object({
  processId: z.coerce.number().int().positive('ID do processo deve ser positivo'),
});

export const sendCommunicationSchema = z
  .object({
    signatureId: z.coerce.number().int().positive().nullable().optional(),
  })
  .strict();
