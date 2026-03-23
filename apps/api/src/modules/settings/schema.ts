import { z } from 'zod';

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
