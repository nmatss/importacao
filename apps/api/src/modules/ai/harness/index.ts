/**
 * AI Confidence Harness — orchestrator.
 *
 * `verifyExtraction(config, data, sourceText)` runs the per-skill verification
 * recipe against a parsed extraction and returns a HarnessReport: deterministic
 * findings (grounding / format / numeric / knowledge), an adjusted confidence,
 * and a trust verdict. Callers fold the report into the extraction pipeline:
 * error findings push their fields into the human-review path; warnings only
 * lower confidence.
 */

import { isValidNcm, isValidContainerIso6346, isIsoDate, isValidCnpj, isUsd } from './format.js';
import { appearsInSource } from './grounding.js';
import { isKnownNcm, isKnownPort, isKnownSupplier } from './knowledge.js';
import type { HarnessFinding, HarnessReport, VerificationConfig } from './types.js';

interface ResolvedField {
  label: string;
  value: unknown;
}

function resolveField(data: Record<string, any>, path: string): ResolvedField[] {
  const marker = 'items[].';
  if (path.startsWith(marker)) {
    const key = path.slice(marker.length);
    const items = Array.isArray(data.items) ? data.items : [];
    return items.map((it: any, i: number) => ({
      label: `items[${i}].${key}`,
      value: it?.[key]?.value ?? null,
    }));
  }
  return [{ label: path, value: data?.[path]?.value ?? null }];
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

export function verifyExtraction(
  config: VerificationConfig,
  data: Record<string, any>,
  sourceText: string,
  nowIso: string,
): HarnessReport {
  const findings: HarnessFinding[] = [];
  const push = (f: HarnessFinding) => findings.push(f);

  // 1. Grounding — value must appear in the source document (anti-hallucination).
  for (const path of config.groundedFields ?? []) {
    for (const { label, value } of resolveField(data, path)) {
      const s = asString(value);
      if (s && !appearsInSource(s, sourceText)) {
        push({
          field: label,
          kind: 'grounding',
          severity: 'error',
          message: `valor "${s}" não foi encontrado no documento — possível alucinação`,
        });
      }
    }
  }

  // 2. NCM — format + catalog membership. Handles both scalar NCM fields and
  //    array fields like the BL's ncmList (confidenceField wrapping string[]).
  for (const path of config.ncmFields ?? []) {
    for (const { label, value } of resolveField(data, path)) {
      const codes = Array.isArray(value) ? value : [value];
      codes.forEach((raw, idx) => {
        const s = asString(raw);
        if (!s) return;
        const lbl = Array.isArray(value) ? `${label}[${idx}]` : label;
        if (!isValidNcm(s)) {
          push({
            field: lbl,
            kind: 'format',
            severity: 'error',
            message: `NCM "${s}" fora do formato XXXX.XX.XX`,
          });
        } else if (!isKnownNcm(s)) {
          push({
            field: lbl,
            kind: 'knowledge',
            severity: 'warning',
            message: `NCM "${s}" não consta no catálogo conhecido`,
          });
        }
      });
    }
  }

  // 3. Dates — strict ISO-8601.
  for (const path of config.dateFields ?? []) {
    for (const { label, value } of resolveField(data, path)) {
      const s = asString(value);
      if (s && !isIsoDate(s)) {
        push({
          field: label,
          kind: 'format',
          severity: 'warning',
          message: `data "${s}" não está em ISO-8601 (YYYY-MM-DD)`,
        });
      }
    }
  }

  // 4. CNPJ — check-digit validation.
  for (const path of config.cnpjFields ?? []) {
    for (const { label, value } of resolveField(data, path)) {
      const s = asString(value);
      if (s && !isValidCnpj(s)) {
        push({
          field: label,
          kind: 'format',
          severity: 'error',
          message: `CNPJ "${s}" inválido (dígitos verificadores)`,
        });
      }
    }
  }

  // 5. Container — ISO 6346.
  for (const path of config.containerFields ?? []) {
    for (const { label, value } of resolveField(data, path)) {
      const s = asString(value);
      if (!s) continue;
      // A container field may carry several comma-separated numbers.
      for (const part of s
        .split(/[,;/]+/)
        .map((x) => x.trim())
        .filter(Boolean)) {
        if (!isValidContainerIso6346(part)) {
          push({
            field: label,
            kind: 'format',
            severity: 'warning',
            message: `container "${part}" não passa no check-digit ISO 6346`,
          });
        }
      }
    }
  }

  // 6. Currency — must be USD for international commercial invoices.
  for (const path of config.usdCurrencyFields ?? []) {
    for (const { label, value } of resolveField(data, path)) {
      const s = asString(value);
      if (s && !isUsd(s)) {
        push({
          field: label,
          kind: 'format',
          severity: 'warning',
          message: `moeda "${s}" não é USD`,
        });
      }
    }
  }

  // 7. Ports — knowledge base.
  for (const { field, kind } of config.portFields ?? []) {
    for (const { label, value } of resolveField(data, field)) {
      const s = asString(value);
      if (s && !isKnownPort(s, kind)) {
        push({
          field: label,
          kind: 'knowledge',
          severity: 'warning',
          message: `porto "${s}" não consta na base de portos (${kind})`,
        });
      }
    }
  }

  // 8. Suppliers — knowledge base.
  for (const path of config.supplierFields ?? []) {
    for (const { label, value } of resolveField(data, path)) {
      const s = asString(value);
      if (s && !isKnownSupplier(s)) {
        push({
          field: label,
          kind: 'knowledge',
          severity: 'warning',
          message: `fornecedor "${s}" não consta na base de parceiros`,
        });
      }
    }
  }

  // 9. Numeric consistency (cross-field).
  for (const check of config.numericChecks ?? []) {
    const f = check(data);
    if (f) push(f);
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const reviewFields = [...new Set(errors.map((f) => f.field))];
  const adjustedConfidence = Math.max(
    0,
    Math.min(1, 1 - errors.length * 0.25 - (findings.length - errors.length) * 0.1),
  );

  return {
    trust: errors.length > 0 ? 'review' : 'trusted',
    reviewFields,
    findings,
    adjustedConfidence,
    checkedAt: nowIso,
  };
}
