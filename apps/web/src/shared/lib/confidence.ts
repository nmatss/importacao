/**
 * Fonte única dos limiares de confiança da extração no frontend (auditoria
 * 2026-07-17): antes cada componente hardcodava seus cortes (0.8/0.5 num,
 * 0.8/0.6 noutro, piso 0.4 replicado em 3 arquivos) e a MESMA porcentagem
 * mudava de cor conforme a tela.
 *
 * Espelha `apps/api/src/modules/documents/constants.ts` — mudanças no piso
 * operacional precisam ser feitas nos dois lados.
 */

export const MIN_OPERATIONAL_CONFIDENCE = 0.4;
export const CONFIDENCE_HIGH = 0.8;
export const CONFIDENCE_MEDIUM = 0.5;

/**
 * ATENÇÃO à semântica de null: aqui null/undefined = SEM confiança (false),
 * espelhando o backend. Telas de lista (DocumentList) usam wrapper próprio em
 * que null = "ainda não pontuado" = utilizável — NÃO troque o wrapper local
 * por esta função sem tratar o null antes, ou todo documento não-processado
 * vira "não utilizável".
 */
export function hasOperationalConfidence(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_OPERATIONAL_CONFIDENCE;
}

/**
 * Explica em linguagem de operador POR QUE a confiança está baixa, a partir
 * dos marcadores `_trust` que o backend persiste na extração. A fórmula nova
 * (cobertura ponderada + caps) derruba números de propósito — sem o porquê,
 * o operador só vê "45%" vermelho e não sabe o que fazer.
 */
export function explainLowConfidence(aiParsedData: Record<string, unknown> | undefined | null): {
  reasons: string[];
  action: string | null;
} {
  const reasons: string[] = [];
  let action: string | null = null;
  const trust =
    aiParsedData && typeof aiParsedData === 'object'
      ? (aiParsedData as { _trust?: Record<string, unknown> })._trust
      : undefined;
  if (!trust || typeof trust !== 'object') return { reasons, action };

  if (trust.groundingSkipped === true) {
    reasons.push(
      'Documento escaneado/imagem sem texto legível — a verificação anti-alucinação não pôde rodar (confiança limitada a 75%).',
    );
    action = 'Se possível, obtenha uma versão do documento com texto (PDF nativo).';
  }
  if (trust.contractFailure === true) {
    reasons.push('A resposta da IA não seguiu o formato esperado (falha de contrato).');
    action = 'Reprocesse o documento; se persistir, revise os campos manualmente.';
  }
  if (trust.trust === 'review') {
    const findings = Array.isArray(trust.findings) ? (trust.findings as unknown[]) : [];
    const errorMsgs = findings
      .filter((f): f is { severity?: string; message?: string } => !!f && typeof f === 'object')
      .filter((f) => f.severity === 'error')
      .map((f) => f.message)
      .filter((m): m is string => typeof m === 'string')
      .slice(0, 3);
    reasons.push(
      errorMsgs.length > 0
        ? `Verificações reprovaram: ${errorMsgs.join('; ')}.`
        : 'Verificações automáticas reprovaram a extração — revisão humana necessária.',
    );
    action = 'Revise e corrija os campos apontados; depois reprocesse.';
  }
  return { reasons, action };
}
