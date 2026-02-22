import { z } from 'zod';

export const createAlertSchema = z.object({
  processId: z.number().optional(),
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string().min(1, 'Título obrigatório'),
  message: z.string().min(1, 'Mensagem obrigatória'),
});
