/**
 * Leitura de variavel de ambiente que trata VAZIO como ausente.
 *
 * `process.env.X ?? 'padrao'` parece certo e nao e: `??` so dispara em `null` e
 * `undefined`, entao uma variavel definida como string vazia VENCE o padrao.
 * E isso nao e hipotetico neste projeto — o `docker-compose` escreve
 * `${VAR:-}`, que passa string VAZIA ao container quando a variavel nao existe
 * no `.env`. O resultado medido: `Number(process.env.AI_DAILY_BUDGET_BRL ?? '100')`
 * vira `0`, e `0` **desativa** o teto diario de custo de IA em vez de aplica-lo.
 *
 * Com este leitor, o padrao do CODIGO volta a ser a fonte unica: o compose pode
 * repassar `${VAR:-}` sem duplicar o valor e sem risco de os dois divergirem.
 */

/** Texto da variavel, ou `padrao` quando ela nao existe ou esta em branco. */
export function envTexto(nome: string, padrao: string): string {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto.trim() === '') return padrao;
  return bruto;
}

/** Numero finito e positivo, ou `padrao`. Rejeita NaN, zero e negativo. */
export function envNumeroPositivo(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto.trim() === '') return padrao;
  const valor = Number(bruto);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}
