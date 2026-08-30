import { randomBytes } from 'node:crypto';

/**
 * Neutralizacao de texto de terceiro antes de entrar num prompt.
 *
 * O sistema usa cercas para separar DADO de INSTRUCAO — `<<<FONTE N INICIO>>>`
 * no assistente e `=== INICIO DO DOCUMENTO ===` na extracao. A defesa so vale
 * se o autor do texto NAO conseguir escrever a cerca de fechamento: conseguindo,
 * ele "sai" do bloco e o que vier depois parece contexto do sistema.
 *
 * As duas versoes anteriores colapsavam runs do caractere da cerca (`<{2,}` no
 * assistente, `={2,}` na extracao). Duas familias de disfarce sobreviviam, e
 * ambas estavam registradas como pendencia em aberto:
 *
 * 1. **Homoglifo de largura total.** `＜＜＜` e `＝＝＝`
 *    nao sao os caracteres ASCII, entao nenhum dos dois padroes os via.
 *    Resolvido pela normalizacao NFKC, que os converte para ASCII ANTES da
 *    checagem.
 * 2. **Cerca espacada.** `< < <` e `= = =` nao formam run. Resolvido por
 *    padroes que aceitam espaco e tabulacao entre as repeticoes.
 *
 * Alem disso remove formatacao INVISIVEL — zero-width e sobrescritas de direcao,
 * a familia do Trojan Source — que nao estava em nenhuma das duas versoes: a
 * faixa de controle usada ia so ate U+001F e U+007F.
 *
 * Nada disto prova que o modelo obedece ou nao a uma instrucao dentro do bloco.
 * Prova outra coisa, e mais forte: que a cerca de fechamento nao pode ser
 * FORJADA. Ver `nonceDeCerca`, que fecha o caso ate para um disfarce que
 * ninguem previu.
 */

/** Zero-width, joiners e sobrescritas de direcao (Trojan Source). */
const INVISIVEIS = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Controle C0/C1 menos tab, LF e CR, que sao conteudo legitimo. */
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** NFKC, depois remocao de invisiveis e de caracteres de controle. */
export function normalizarTextoNaoConfiavel(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFKC')
    .replace(INVISIVEIS, '')
    .replace(CONTROLE, ' ');
}

function escaparParaRegex(caractere: string): string {
  return caractere.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Colapsa repeticoes do caractere de cerca, inclusive separadas por espaco.
 *
 * Deliberadamente UM caractere por vez, e nao "qualquer angulo": um padrao que
 * aceitasse `<` e `>` na mesma repeticao estragaria texto legitimo como
 * `a > b > c`. Do jeito que esta, `a > b > c` nao casa — entre os sinais ha
 * letra, e o padrao so admite espaco e tabulacao.
 */
export function neutralizarCercas(texto: string, caracteres: readonly string[]): string {
  return caracteres.reduce(
    (acc, caractere) =>
      acc.replace(new RegExp(`(?:${escaparParaRegex(caractere)}[ \\t]*){2,}`, 'g'), ' '),
    texto,
  );
}

/**
 * Segredo por requisicao que entra na cerca.
 *
 * O saneamento cobre os disfarces CONHECIDOS; o nonce cobre os que ninguem
 * previu. Quem escreve o e-mail ou o documento nao tem como adivinhar 12
 * digitos hexadecimais sorteados no instante em que o prompt e montado, entao a
 * cerca de fechamento deixa de ser forjavel por construcao — qualquer que seja
 * a codificacao usada na tentativa.
 */
export function nonceDeCerca(): string {
  return randomBytes(6).toString('hex');
}

/**
 * Remove do texto qualquer ocorrencia do nonce desta requisicao.
 *
 * O autor do texto nao pode conhece-lo, entao isto e cinto e suspensorio: cobre
 * o caso em que uma resposta anterior contendo o marcador volte a ser indexada
 * como fonte.
 */
export function removerNonce(texto: string, nonce: string): string {
  if (!nonce) return texto;
  return texto.replaceAll(nonce, '');
}
