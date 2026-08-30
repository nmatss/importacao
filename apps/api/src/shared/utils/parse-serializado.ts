import { envNumeroPositivo } from './env.js';

/**
 * Serializa os parses de documento que alocam muita memoria.
 *
 * A guarda de arquivo compactado tem orcamento POR ARQUIVO. Isso basta enquanto
 * so um parse existe por vez — e para xlsx basta mesmo, porque `XLSX.read` e
 * `zlib.inflateRawSync` sao SINCRONOS: enquanto rodam, o event loop esta preso e
 * nenhum outro parse comeca. O orcamento por arquivo ja e, na pratica, o pico.
 *
 * `mammoth.extractRawText` **nao** e sincrono. Dois docx podem intercalar, e ai
 * o pico e a soma: com o teto de 12 MB descomprimidos a ~20x, sao ~250 MB cada
 * — dois ao mesmo tempo estouram o container de 512M, que tem 84,6 MiB de linha
 * de base. E ha dois disparadores independentes: o worker `ai-extraction`
 * (batchSize 1) e a rota HTTP sincrona de extracao, que roda fora da fila.
 *
 * A saida aqui e SERIALIZAR, nao recusar: recusar transformaria concorrencia
 * normal em erro para o operador, enquanto enfileirar so adia — e o parse real
 * de um docx de verdade leva ~150 ms.
 *
 * **Limite honesto:** o teto abaixo limita quanto tempo a fila espera, e o
 * `finally` garante que o proximo entre. Ele NAO cancela o parse em andamento
 * (nem `mammoth` nem `SheetJS` aceitam sinal), entao um parse travado continua
 * segurando a memoria dele depois de a fila seguir. Cancelar de verdade exigiria
 * isolar o parse em outro processo — registrado como divida, nao resolvido aqui.
 */

/** 60s. Um docx real leva ~150 ms; o maior xlsx da empresa levou 7 s. */
const TETO_PADRAO_MS = 60_000;

let fila: Promise<unknown> = Promise.resolve();

function comTeto<T>(promessa: Promise<T>, ms: number, rotulo: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const estouro = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Parse de documento excedeu ${ms}ms [${rotulo}]`);
      (err as NodeJS.ErrnoException).code = 'ETIMEDOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promessa, estouro]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Roda `fn` sozinha: espera o parse anterior terminar antes de comecar.
 *
 * A fila nunca guarda rejeicao — sem isso, um parse que falha deixaria todos os
 * seguintes pendurados na promessa rejeitada.
 */
export async function parseSerializado<T>(
  fn: () => Promise<T>,
  rotulo: string,
  tetoMs = envNumeroPositivo('DOCUMENT_PARSE_TIMEOUT_MS', TETO_PADRAO_MS),
): Promise<T> {
  const anterior = fila;
  let liberar!: () => void;
  fila = new Promise<void>((resolve) => {
    liberar = resolve;
  });

  try {
    await anterior.catch(() => undefined);
    return await comTeto(fn(), tetoMs, rotulo);
  } finally {
    liberar();
  }
}

/** Só para teste: devolve a fila ao estado inicial. */
export function resetarFilaSerial(): void {
  fila = Promise.resolve();
}
