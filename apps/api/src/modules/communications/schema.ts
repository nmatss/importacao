import { z } from 'zod';

export const createCommunicationSchema = z.object({
  processId: z.number().optional(),
  recipient: z.string().min(1, 'Destinatário obrigatório'),
  recipientEmail: z.string().email('E-mail inválido'),
  subject: z.string().min(1, 'Assunto obrigatório'),
  body: z.string().min(1, 'Corpo do e-mail obrigatório'),
  attachments: z.array(z.any()).optional(),
});

export type CreateCommunicationInput = z.infer<typeof createCommunicationSchema>;

export const updateDraftSchema = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  recipientEmail: z.string().email().optional(),
});
