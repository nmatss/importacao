import { z } from 'zod';

const id = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine(Number.isSafeInteger)
  .optional();
export const sourceSelectionSchema = z
  .object({
    invoiceId: id,
    packingListId: id,
    blId: id,
    espelhoId: id,
    duimpId: id,
  })
  .strict();
export type SourceSelection = z.infer<typeof sourceSelectionSchema>;
const types: Record<keyof SourceSelection, string[]> = {
  invoiceId: ['invoice'],
  packingListId: ['packing_list'],
  blId: ['ohbl', 'draft_bl'],
  espelhoId: ['espelho'],
  duimpId: ['draft_duimp', 'duimp'],
};

/** Explicit read-only inspection of an attached source, never a cross-process fallback. */
export function selectAttachedSources<T extends { id: number; type: string }>(
  documents: T[],
  selection: SourceSelection,
): T[] {
  let selected = documents;
  for (const key of Object.keys(types) as Array<keyof SourceSelection>) {
    const selectedId = selection[key];
    if (selectedId == null) continue;
    if (!documents.some((doc) => doc.id === selectedId && types[key].includes(doc.type))) {
      throw Object.assign(
        new Error('Documento selecionado não pertence a este processo ou tipo.'),
        { statusCode: 400 },
      );
    }
    selected = selected.filter((doc) => !types[key].includes(doc.type) || doc.id === selectedId);
  }
  return selected;
}
