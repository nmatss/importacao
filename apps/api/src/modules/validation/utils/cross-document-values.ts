import {
  describeNumericFailure,
  parseDocumentNumber,
  type ParsedNumericFail,
} from './number-normalize.js';
import { describeUnitDivergence } from './measure-normalize.js';
import type { DocumentSource, SourcedValue } from './source-precedence.js';

export interface RawSourceValue {
  source: DocumentSource;
  value: unknown;
}

export interface CollectedValues {
  /** Fontes cujo valor pode ser comparado numericamente. */
  values: Array<SourcedValue<number>>;
  /**
   * Fontes cujo valor EXISTE no documento mas nao entrou na comparacao
   * (ilegivel, ambiguo ou em outra unidade). Nunca pode ser confundido com
   * campo ausente na hora de escrever a mensagem.
   */
  caveats: string[];
}

interface CollectOptions {
  normalizeUnit?: (token: string | null | undefined) => string | null;
  assumedUnit?: string;
}

/**
 * Le o mesmo campo em varios documentos com o parser unico, separando
 * "ausente" de "presente mas nao comparavel" e descartando da comparacao as
 * fontes que declaram outra unidade.
 */
export function collectDocumentNumbers(
  entries: RawSourceValue[],
  options: CollectOptions = {},
): CollectedValues {
  const values: Array<SourcedValue<number>> = [];
  const caveats: string[] = [];

  for (const entry of entries) {
    const parsed = parseDocumentNumber(entry.value);

    if (!parsed.ok) {
      if (parsed.reason !== 'absent') {
        caveats.push(describeNumericFailure(entry.source, parsed as ParsedNumericFail));
      }
      continue;
    }

    if (options.normalizeUnit && options.assumedUnit) {
      const unitIssue = describeUnitDivergence(
        [{ label: entry.source, unit: parsed.unit }],
        options.normalizeUnit,
        options.assumedUnit,
      );
      if (unitIssue) {
        caveats.push(unitIssue);
        continue;
      }
    }

    values.push({ source: entry.source, value: parsed.value });
  }

  return { values, caveats };
}

/** Sufixo padronizado para anexar as mensagens quando ha fontes descartadas. */
export function caveatSuffix(caveats: string[]): string {
  return caveats.length > 0 ? ` Fontes nao comparadas: ${caveats.join('; ')}.` : '';
}
