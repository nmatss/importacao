import { z } from 'zod';

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

export const createCommunicationSchema = z.object({
  processId: z.number().optional(),
  recipient: z.string().min(1, 'Destinatário obrigatório').max(500),
  recipientEmail: z.string().email('E-mail inválido').max(500),
  subject: z.string().min(1, 'Assunto obrigatório').max(500),
  body: z.string().min(1, 'Corpo do e-mail obrigatório').max(100000),
  attachments: z.array(communicationAttachmentSchema).max(20).optional(),
});

export type CreateCommunicationInput = z.infer<typeof createCommunicationSchema>;

export const updateDraftSchema = z.object({
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(100000).optional(),
  recipientEmail: z.string().email().max(500).optional(),
});
