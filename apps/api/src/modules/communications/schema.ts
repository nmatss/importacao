import { z } from 'zod';

export const createCommunicationSchema = z.object({
  processId: z.number().optional(),
  recipient: z.string().min(1, 'Destinatário obrigatório').max(500),
  recipientEmail: z.string().email('E-mail inválido').max(500),
  subject: z.string().min(1, 'Assunto obrigatório').max(500),
  body: z.string().min(1, 'Corpo do e-mail obrigatório').max(100000),
  attachments: z.array(z.object({ name: z.string(), path: z.string() }).passthrough()).optional(),
});

export type CreateCommunicationInput = z.infer<typeof createCommunicationSchema>;

export const updateDraftSchema = z.object({
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(100000).optional(),
  recipientEmail: z.string().email().max(500).optional(),
});
