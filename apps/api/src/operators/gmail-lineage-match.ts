export type ExactHashTarget = {
  documentId: number;
  processId: number;
  processCode: string;
};

export type ExactHashDecision =
  | { kind: 'missing_hash' }
  | { kind: 'ambiguous_hash' }
  | { kind: 'process_conflict' }
  | { kind: 'exact'; target: ExactHashTarget; processCodeAligned: boolean };

export function normalizeProcessCode(value: string): string {
  return value.toUpperCase().replace(/[-_\s]/g, '');
}

export function decideExactHashTarget(
  targets: ExactHashTarget[],
  knownProcessCodes: string[],
): ExactHashDecision {
  if (targets.length === 0) return { kind: 'missing_hash' };
  if (targets.length !== 1) return { kind: 'ambiguous_hash' };

  const target = targets[0];
  const normalizedCodes = new Set(knownProcessCodes.map(normalizeProcessCode));
  const processCodeAligned = normalizedCodes.has(normalizeProcessCode(target.processCode));
  if (normalizedCodes.size > 0 && !processCodeAligned) return { kind: 'process_conflict' };
  return { kind: 'exact', target, processCodeAligned };
}
