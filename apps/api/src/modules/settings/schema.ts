import { z } from 'zod';

const emailListSchema = z
  .string()
  .max(255, 'Use no máximo 255 caracteres')
  .refine(
    (value) => {
      const emails = value
        .split(/[;,\r\n]/)
        .map((email) => email.trim())
        .filter(Boolean);

      return emails.every((email) => z.string().email().safeParse(email).success);
    },
    { message: 'Informe e-mails válidos separados por vírgula ou ponto-e-vírgula' },
  );

export const updateSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.record(z.unknown())]),
  description: z.string().optional(),
});

export const smtpSettingsSchema = z.object({
  smtp_host: z.string().optional(),
  smtp_port: z.string().optional(),
  smtp_user: z.string().optional(),
  smtp_from: z.string().optional(),
});

export const integrationSettingsSchema = z.object({
  drive_client_email: z.string().optional(),
  drive_root_folder_id: z.string().optional(),
  odoo_url: z.string().optional(),
  odoo_db: z.string().optional(),
  odoo_user: z.string().optional(),
});

export const recipientSettingsSchema = z.object({
  kiom_email: emailListSchema.optional(),
  fenicia_email: emailListSchema.optional(),
  isa_email: emailListSchema.optional(),
  default_cc_email: emailListSchema.optional(),
});

export const createEmailSignatureSchema = z.object({
  name: z.string().min(1, 'Nome obrigatorio').max(100),
  signatureHtml: z.string().min(1, 'Assinatura obrigatoria').max(50000),
  isDefault: z.boolean().optional(),
});

export const updateEmailSignatureSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  signatureHtml: z.string().min(1).max(50000).optional(),
  isDefault: z.boolean().optional(),
});

export const createCommunicationTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatorio').max(120),
  recipient: z.string().trim().max(255).optional().nullable(),
  recipientEmail: emailListSchema.optional().nullable(),
  subject: z.string().trim().min(1, 'Assunto obrigatorio').max(500),
  body: z.string().trim().min(1, 'Mensagem obrigatoria').max(50000),
  isActive: z.boolean().optional(),
});

export const updateCommunicationTemplateSchema = createCommunicationTemplateSchema.partial();
