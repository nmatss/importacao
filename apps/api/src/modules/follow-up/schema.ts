import { z } from 'zod';

const dateOrTimestamp = z.union([z.string(), z.date()]).nullable().optional();

export const updateFollowUpSchema = z.object({
  documentsReceivedAt: dateOrTimestamp,
  preInspectionAt: dateOrTimestamp,
  ncmVerifiedAt: dateOrTimestamp,
  espelhoGeneratedAt: dateOrTimestamp,
  sentToFeniciaAt: dateOrTimestamp,
  liSubmittedAt: dateOrTimestamp,
  liApprovedAt: dateOrTimestamp,
  liDeadline: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
