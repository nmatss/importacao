/**
 * Recuperacao do JSON devolvido pelo modelo.
 *
 * Ate 17/08/2026 o parse era um `JSON.parse` cru sobre a resposta inteira.
 * Qualquer coisa em volta do JSON — cerca markdown, uma frase de preambulo,
 * um rodape — derrubava a extracao inteira com "invalid JSON", e o documento
 * ficava em falha terminal com TODOS os campos vazios. Em producao isso era a
 * maior causa isolada de falha (6 dos 17 documentos falhos em 17/08), sempre em
 * invoice/proforma reais e legiveis.
 *
 * Aqui nao ha "conserto criativo" do conteudo: so se descarta o que envolve o
 * payload e se localiza o objeto/array balanceado. Se nada balanceado existir,
 * a falha continua sendo falha — mas com a causa dita por extenso.
 */

/**
 * O modelo respondeu, mas fora do contrato acordado (nao entregou JSON
 * utilizavel). E diferente de erro de provider, de timeout e de orcamento: o
 * mesmo documento tem chance real de sair certo num modelo melhor, entao vale
 * escalonar em vez de dar o documento por perdido.
 */
export class AIResponseContractError extends Error {
  readonly reason: 'truncated' | 'no_json';

  constructor(message: string, reason: 'truncated' | 'no_json') {
    super(message);
    this.name = 'AIResponseContractError';
    this.reason = reason;
  }
}

const FENCE_RE = /^\s*```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```\s*$/;

/** Remove uma cerca markdown que envolva TODA a resposta. */
export function stripCodeFences(raw: string): string {
  const match = FENCE_RE.exec(raw);
  return match ? match[1] : raw;
}

/**
 * Recorta o primeiro objeto/array JSON balanceado da string.
 *
 * A contagem respeita string literal e escape: uma chave dentro de
 * `"descricao": "caixa {grande}"` nao pode contar como profundidade, senao o
 * recorte fecha no lugar errado e produz um JSON valido porem TRUNCADO — que
 * seria pior que falhar, porque entraria como dado bom.
 */
export function extractJsonPayload(raw: string): string | null {
  const text = stripCodeFences(raw);

  for (let start = 0; start < text.length; start++) {
    const opener = text[start];
    if (opener !== '{' && opener !== '[') continue;
    const closer = opener === '{' ? '}' : ']';

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        if (inString) escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === opener) depth++;
      else if (ch === closer) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    // Abriu e nunca fechou: resposta cortada no meio. Nao adianta procurar
    // outro inicio depois deste.
    return null;
  }

  return null;
}

/**
 * A resposta abre uma estrutura JSON e nunca a fecha — assinatura de resposta
 * cortada no teto de tokens de saida. Vale como diagnostico no erro: a acao do
 * operador e diferente (subir o teto), nao "reenviar o documento".
 */
export function looksTruncatedJson(raw: string): boolean {
  const text = stripCodeFences(raw).trim();
  if (!text) return false;
  const firstOpen = text.search(/[[{]/);
  if (firstOpen === -1) return false;
  return extractJsonPayload(text) === null;
}

export interface JsonParseOutcome {
  ok: boolean;
  value?: unknown;
  /** 'clean' = parseou direto; 'salvaged' = precisou recortar o payload. */
  how?: 'clean' | 'salvaged';
  reason?: 'truncated' | 'no_json';
}

/**
 * Tenta obter o JSON da resposta sem inventar conteudo.
 */
export function parseModelJson(raw: string): JsonParseOutcome {
  try {
    return { ok: true, value: JSON.parse(raw), how: 'clean' };
  } catch {
    // segue para o recorte
  }

  const payload = extractJsonPayload(raw);
  if (payload) {
    try {
      return { ok: true, value: JSON.parse(payload), how: 'salvaged' };
    } catch {
      // recorte balanceado mas ainda invalido — cai abaixo
    }
  }

  return { ok: false, reason: looksTruncatedJson(raw) ? 'truncated' : 'no_json' };
}
