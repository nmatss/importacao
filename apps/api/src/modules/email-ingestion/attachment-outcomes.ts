export function hasUnsupportedAttachmentSkip(
  attachments: Array<{ status?: string; skipReason?: string }>,
): boolean {
  return attachments.some(
    (attachment) =>
      attachment.status === 'skipped' &&
      typeof attachment.skipReason === 'string' &&
      !attachment.skipReason.startsWith('duplicate'),
  );
}
