import { isDeepStrictEqual } from 'node:util';
import { hasOperationalConfidence } from './constants.js';
import { computeRowStatus, type ComparisonKind, type RowStatus } from './comparison-core.js';

export interface RegistroDocument {
  id: number;
  processId: number;
  type: string;
  originalFilename: string;
  isProcessed: boolean | null;
  aiParsedData: unknown;
  driveFileId?: string | null;
  driveVersion?: number | null;
  confidenceScore?: string | number | null;
  contentSha256?: string | null;
  createdAt?: Date | null;
}

type Source = 'duimp' | 'invoice' | 'espelho';
const sources: Source[] = ['duimp', 'invoice', 'espelho'];
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function unwrap(value: unknown): unknown {
  return Object.hasOwn(record(value), 'value') ? record(value).value : value;
}
function read(data: unknown, aliases: string[]) {
  for (const field of aliases) {
    const value = unwrap(record(data)[field]);
    if (value !== null && value !== undefined && value !== '') return { value, field };
  }
  return { value: null, field: aliases[0] };
}

function normalizeUnit(unit: unknown): string | null {
  if (typeof unit !== 'string' || !unit.trim()) return null;
  const raw = unit.trim().toUpperCase();
  if (['UN', 'UNIDADE', 'UNIDADES', 'UNIT', 'UNITS', 'PCS', 'PC', 'PIECE', 'PIECES'].includes(raw))
    return 'UN';
  if (['PAR', 'PARES', 'PAIR', 'PAIRS'].includes(raw)) return 'PAR';
  if (['SET', 'SETS', 'CONJUNTO', 'CONJUNTOS'].includes(raw)) return 'SET';
  if (['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS'].includes(raw)) return 'KG';
  if (['DZ', 'DOZEN', 'DUZIA', 'DÚZIA'].includes(raw)) return 'DZ';
  return null;
}

function hasAliasConflict(
  data: unknown,
  aliases: readonly string[],
  normalize: (value: unknown) => unknown = (value) =>
    typeof value === 'string' ? value.trim() : value,
): boolean {
  const values = aliases
    .map((field) => read(data, [field]).value)
    .filter((value) => value !== null);
  return (
    values.length > 1 &&
    values.some((value) => !isDeepStrictEqual(normalize(value), normalize(values[0])))
  );
}

/** Only documents attached to this process participate; conflicting files require review. */
export function buildRegistroComparison(
  processId: number,
  documents: RegistroDocument[],
  processCode?: string,
) {
  const scoped = documents.filter((doc) => doc.processId === processId);
  const selected: Partial<Record<Source, RegistroDocument>> = {};
  const issues: string[] = [];
  const blocked = new Set<Source>();
  for (const source of sources) {
    const type = source === 'duimp' ? 'draft_duimp' : source;
    let candidates = scoped.filter((doc) => doc.type === type);
    // The draft is the object under review. Final DUIMP is a fallback only when no draft exists.
    if (source === 'duimp' && candidates.length === 0)
      candidates = scoped.filter((doc) => doc.type === 'duimp');
    // A filename is not a version identity: two uploads may have the same name.
    const identities = new Set(
      candidates.map((doc) => (doc.driveFileId ? `drive:${doc.driveFileId}` : `upload:${doc.id}`)),
    );
    if (identities.size > 1) {
      issues.push(`${source}: múltiplos arquivos; confirme o documento aplicável.`);
      continue;
    }
    if (
      candidates.length > 1 &&
      candidates.some(
        (doc) => !Number.isSafeInteger(doc.driveVersion) || Number(doc.driveVersion) < 1,
      )
    ) {
      issues.push(`${source}: versão desconhecida; confirme qual arquivo está vigente.`);
      continue;
    }
    const versionHashes = new Map<number, Set<string>>();
    for (const doc of candidates) {
      if (doc.driveVersion != null && doc.contentSha256) {
        const hashes = versionHashes.get(doc.driveVersion) ?? new Set<string>();
        hashes.add(doc.contentSha256);
        versionHashes.set(doc.driveVersion, hashes);
      }
    }
    if ([...versionHashes.values()].some((hashes) => hashes.size > 1)) {
      issues.push(`${source}: conteúdo conflitante para a mesma versão do Drive.`);
      continue;
    }
    if (
      candidates.some((doc, index) =>
        candidates
          .slice(index + 1)
          .some(
            (other) =>
              doc.driveVersion === other.driveVersion &&
              (!doc.contentSha256 || !other.contentSha256) &&
              !isDeepStrictEqual(doc.aiParsedData, other.aiParsedData),
          ),
      )
    ) {
      issues.push(
        `${source}: extrações diferentes na mesma versão sem hash de conteúdo; confirme a fonte vigente.`,
      );
      continue;
    }
    candidates.sort(
      (a, b) =>
        (b.driveVersion ?? 0) - (a.driveVersion ?? 0) ||
        (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0) ||
        b.id - a.id,
    );
    selected[source] = candidates[0];
    if (!selected[source]) issues.push(`${source}: documento não anexado.`);
    else if (!selected[source]?.isProcessed) issues.push(`${source}: extração pendente ou falhou.`);
    const doc = selected[source];
    if (
      doc &&
      (doc.confidenceScore == null || !hasOperationalConfidence(doc.type, doc.confidenceScore))
    ) {
      blocked.add(source);
      issues.push(`${source}: confiança de leitura insuficiente ou não medida.`);
    }
    const parsed = record(doc?.aiParsedData);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const references = [
      ...[parsed, record(parsed.summary), ...items.map(record)].flatMap((node) =>
        ['processReference', 'processCode', 'processo'].map((field) => read(node, [field]).value),
      ),
    ].filter((value) => value != null);
    if (
      processCode &&
      references.some(
        (value) => String(value).trim().toUpperCase() !== processCode.trim().toUpperCase(),
      )
    ) {
      blocked.add(source);
      issues.push(
        `${source}: referência extraída difere do processo ${processCode}; revise a associação do arquivo.`,
      );
    }
    const itemAliasConflict = items.some(
      (item) =>
        hasAliasConflict(item, ['itemCode', 'codigo']) ||
        hasAliasConflict(item, ['quantity', 'qty']) ||
        hasAliasConflict(item, ['ncmCode', 'ncm'], (value) =>
          String(value).replace(/[.\s-]/g, ''),
        ) ||
        hasAliasConflict(
          item,
          ['unitType', 'unit', 'quantityUnit'],
          (value) => normalizeUnit(value) ?? String(value).trim(),
        ),
    );
    const amountAliasConflict = [parsed, record(parsed.summary)].some((node) =>
      hasAliasConflict(node, ['totalFobValue', 'totalAmountUsd']),
    );
    if (itemAliasConflict || amountAliasConflict) {
      blocked.add(source);
      issues.push(
        `${source}: aliases de código, quantidade, unidade ou valor conflitantes; revise a extração antes de comparar.`,
      );
    }
    const trust = record(parsed._trust);
    if (trust.trust === 'review' || trust.contractFailure === true) {
      blocked.add(source);
      issues.push(
        `${source}: extração exige revisão de confiança ou contrato antes da conferência.`,
      );
    }
    const relevantNodes = [parsed, record(parsed.summary), ...items.map(record)];
    const relevantFields = [
      'importerCnpj',
      'currency',
      'totalFobValue',
      'totalAmountUsd',
      'totalNetWeight',
      'totalGrossWeight',
      'itemCode',
      'codigo',
      'quantity',
      'qty',
      'ncm',
      'ncmCode',
      'unitType',
      'unit',
      'quantityUnit',
    ];
    if (
      relevantNodes.some((node) =>
        relevantFields.some((field) => {
          const wrapped = record(node[field]);
          return (
            wrapped.value != null &&
            Object.hasOwn(wrapped, 'confidence') &&
            (typeof wrapped.confidence !== 'number' ||
              !Number.isFinite(wrapped.confidence) ||
              wrapped.confidence < 0.4 ||
              wrapped.confidence > 1)
          );
        }),
      )
    ) {
      blocked.add(source);
      issues.push(`${source}: campo com confiança insuficiente; revise a extração.`);
    }
    const weightUnits = [parsed, record(parsed.summary)]
      .flatMap((node) =>
        ['weightUnit', 'weightUnitType', 'totalNetWeightUnit', 'totalGrossWeightUnit'].map(
          (field) => read(node, [field]).value,
        ),
      )
      .filter((value) => value != null);
    if (
      weightUnits.some(
        (unit) =>
          !['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS'].includes(String(unit).trim().toUpperCase()),
      )
    ) {
      blocked.add(source);
      issues.push(`${source}: unidade de peso não confirmada em kg; conversão requer revisão.`);
    }
  }
  for (let i = 0; i < sources.length; i++) {
    for (const other of sources.slice(i + 1)) {
      const source = sources[i];
      const left = selected[source];
      const right = selected[other];
      if (
        left &&
        right &&
        ((left.contentSha256 && left.contentSha256 === right.contentSha256) ||
          (left.driveFileId && left.driveFileId === right.driveFileId))
      ) {
        blocked.add(source);
        blocked.add(other);
        issues.push(
          `${source} e ${other}: mesmo arquivo/conteúdo; fontes independentes não confirmadas.`,
        );
      }
    }
  }
  const data = (source: Source) => {
    const parsed = record(selected[source]?.aiParsedData);
    return !blocked.has(source) &&
      selected[source]?.isProcessed &&
      !parsed.extractionFailed &&
      !parsed.skipped &&
      !parsed.error
      ? parsed
      : null;
  };
  const provenance = (source: Source, field: string) => ({
    documentId: selected[source]?.id ?? null,
    fileName: selected[source]?.originalFilename ?? null,
    driveVersion: selected[source]?.driveVersion ?? null,
    field,
    contentSha256: selected[source]?.contentSha256 ?? null,
  });
  const rows: Array<{
    key: string;
    label: string;
    status: RowStatus;
    values: Record<
      Source,
      {
        value: unknown;
        documentId: number | null;
        fileName: string | null;
        driveVersion: number | null;
        contentSha256: string | null;
        field: string;
        unitType?: string | null;
      }
    >;
  }> = [];
  function addRow(
    key: string,
    label: string,
    kind: ComparisonKind,
    cells: Record<Source, { value: unknown; field: string; unitType?: string | null }>,
    comparable = true,
  ) {
    const values = Object.fromEntries(
      sources.map((source) => [
        source,
        { ...cells[source], ...provenance(source, cells[source].field) },
      ]),
    ) as (typeof rows)[number]['values'];
    const present = sources
      .map((source) => cells[source].value)
      .filter((value) => value !== null && value !== undefined && value !== '');
    const invalidNumeric =
      kind === 'numeric' &&
      present.some(
        (value) =>
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < 0 ||
          (key.endsWith(':quantity') && value === 0),
      );
    let compared = invalidNumeric ? 'skipped' : computeRowStatus(present, kind);
    if (!invalidNumeric && present.length > 1 && key.endsWith(':quantity')) {
      compared = present.every((value) => value === present[0]) ? 'match' : 'divergent';
    }
    if (!invalidNumeric && present.length > 1 && key === 'totalFobValue') {
      const cents = present.map((value) => Math.round(Number(value) * 100));
      if (cents.every((value) => value === cents[0])) compared = 'match';
      else if (compared === 'match') compared = 'warning';
    }
    if (
      (key === 'totalNetWeight' || key === 'totalGrossWeight') &&
      compared === 'match' &&
      !present.every((value) => value === present[0])
    ) {
      compared = 'warning';
    }
    if (kind === 'taxId') {
      const normalized = present.map((value) => String(value).replace(/[./\s-]/g, ''));
      const valid =
        key === 'importerCnpj'
          ? normalized.every((value) => /^[A-Za-z0-9]{12}\d{2}$/.test(value))
          : normalized.every((value) => /^\d{8}$/.test(value));
      if (!valid) compared = 'skipped';
    }
    // Agreement between two sources cannot validate the missing third source.
    const status =
      !comparable || (present.length < 3 && compared !== 'divergent') ? 'skipped' : compared;
    rows.push({ key, label, values, status });
  }
  const aggregates: Array<[string, string, ComparisonKind, string[]]> = [
    ['importerCnpj', 'CNPJ do importador', 'taxId', ['importerCnpj']],
    ['totalFobValue', 'FOB (USD)', 'numeric', ['totalFobValue', 'totalAmountUsd']],
    ['totalNetWeight', 'Peso líquido (kg)', 'numeric', ['totalNetWeight']],
    ['totalGrossWeight', 'Peso bruto (kg)', 'numeric', ['totalGrossWeight']],
  ];
  for (const [key, label, kind, aliases] of aggregates) {
    const cells = Object.fromEntries(
      sources.map((source) => {
        const parsed = data(source);
        if (source === 'espelho' && record(parsed).summary) {
          const cell = read(record(parsed).summary, aliases);
          return [source, { ...cell, field: `summary.${cell.field}` }];
        }
        return [source, read(parsed, aliases)];
      }),
    ) as Record<Source, { value: unknown; field: string }>;
    if (key === 'totalFobValue') {
      // A printed foreign currency amount is not necessarily USD.
      for (const source of sources) {
        if (
          (source !== 'espelho' &&
            String(read(data(source), ['currency']).value)
              .trim()
              .toUpperCase() !== 'USD') ||
          (source === 'espelho' &&
            [
              read(data(source), ['currency']).value,
              read(record(data(source)).summary, ['currency']).value,
            ].some((value) => value != null && String(value).trim().toUpperCase() !== 'USD'))
        )
          cells[source].value = null;
      }
    }
    addRow(key, label, kind, cells);
  }
  const itemMaps = Object.fromEntries(
    sources.map((source) => {
      const raw = unwrap(record(data(source)).items);
      const items = Array.isArray(raw) ? raw : [];
      const map = new Map<string, Array<{ item: unknown; index: number }>>();
      items.forEach((item, index) => {
        const code = read(item, ['itemCode', 'codigo']).value;
        // Exact textual identifiers: never strip leading zeroes or legitimate prefixes.
        if (typeof code !== 'string' || !code.trim()) {
          issues.push(`${source}: item ${index + 1} sem SKU textual identificável.`);
          return;
        }
        const key = code.trim();
        map.set(key, [...(map.get(key) ?? []), { item, index }]);
      });
      if (!items.length) issues.push(`${source}: itens não lidos; correspondência pendente.`);
      return [source, map];
    }),
  ) as Record<Source, Map<string, Array<{ item: unknown; index: number }>>>;
  const codes = new Set(sources.flatMap((source) => [...itemMaps[source].keys()]));
  for (const code of codes) {
    const units = sources.map(
      (source) =>
        read(itemMaps[source].get(code)?.[0]?.item, ['unitType', 'unit', 'quantityUnit']).value,
    );
    const normalizedUnits = units.map(normalizeUnit);
    const unsupportedUnit = normalizedUnits.some(
      (unit) => unit === null || unit !== normalizedUnits[0],
    );
    if (unsupportedUnit)
      issues.push(
        `SKU ${code}: unidade ausente ou diferente; confirme a unidade nas três fontes antes de comparar quantidades.`,
      );
    const ambiguous = sources.some((source) => (itemMaps[source].get(code)?.length ?? 0) > 1);
    if (ambiguous) issues.push(`SKU ${code}: linhas repetidas; vínculo por item requer revisão.`);
    for (const [field, label, aliases, kind] of [
      ['quantity', 'Quantidade', ['quantity', 'qty'], 'numeric'],
      ['ncm', 'NCM', ['ncmCode', 'ncm'], 'taxId'],
    ] as const) {
      const cells = Object.fromEntries(
        sources.map((source) => {
          const found = itemMaps[source].get(code)?.[0];
          const cell = read(ambiguous ? null : found?.item, [...aliases]);
          return [
            source,
            {
              value: cell.value,
              field: `items[${found?.index ?? '?'}].${cell.field}`,
              ...(field === 'quantity'
                ? {
                    unitType:
                      typeof units[sources.indexOf(source)] === 'string'
                        ? String(units[sources.indexOf(source)])
                        : null,
                  }
                : {}),
            },
          ];
        }),
      ) as Record<Source, { value: unknown; field: string }>;
      addRow(
        `item:${code}:${field}`,
        `${code} · ${label}`,
        kind,
        cells,
        field !== 'quantity' || !unsupportedUnit,
      );
    }
  }
  return {
    processId,
    sources: Object.fromEntries(
      sources.map((source) => [
        source,
        selected[source] ? { ...provenance(source, ''), type: selected[source]?.type } : null,
      ]),
    ),
    rows,
    issues,
    status: rows.some((row) => row.status === 'divergent')
      ? 'divergent'
      : issues.length === 0 && rows.every((row) => row.status === 'match')
        ? 'match'
        : 'pending',
  };
}
