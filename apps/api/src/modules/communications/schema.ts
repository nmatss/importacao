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

export const createCommunicationSchema = z.object({
  processId: z.number().optional(),
  // communications.recipient é varchar(255); manter o zod alinhado à coluna.
  recipient: z.string().min(1, 'Destinatário obrigatório').max(255),
  recipientEmail: emailListSchema,
  subject: z.string().min(1, 'Assunto obrigatório').max(500),
  body: z.string().min(1, 'Corpo do e-mail obrigatório').max(100000),
  attachments: z.array(communicationAttachmentSchema).max(20).optional(),
});

export type CreateCommunicationInput = z.infer<typeof createCommunicationSchema>;

export const updateDraftSchema = z.object({
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(100000).optional(),
  recipient: z.string().min(1).max(255).optional(),
  recipientEmail: emailListSchema.optional(),
  attachments: z.array(communicationAttachmentSchema).max(20).optional(),
});
