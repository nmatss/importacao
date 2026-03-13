import { z } from 'zod';

export const updateSettingSchema = z.object({
  value: z.any(),
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
