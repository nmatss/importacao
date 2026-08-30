import zlib from 'node:zlib';
import { AppError } from '../errors/index.js';

/**
 * Recusa arquivo compactado que estoura a memoria do processo ANTES de
 * descomprimi-lo.
 *
 * Medido em 2026-08-29: um `.xlsx` valido de **4,7 MB** com 3 colunas x 400 mil
 * linhas descomprime para 127 MB de XML e leva o RSS a **770 MB** so no
 * `XLSX.read`. O container da API tem `memory: 512M`, e os workers do pg-boss
 * rodam DENTRO do processo da API — nao ha container de worker separado. Ou
 * seja: um arquivo de 4,7 MB nao mata um job, mata a API inteira. O teto de
 * ingestao do Drive e 25 MB, cinco vezes mais do que basta.
 *
 * O teto de `maxChars` que ja existia protege o tamanho do PROMPT, nao a
 * memoria do parser: ele so age depois que o parser terminou.
 *
 * xlsx e docx sao ZIP. O indice do ZIP (central directory) declara o tamanho
 * descomprimido de cada entrada, e fica no FIM do arquivo — da para decidir sem
 * descomprimir um byte. E o que esta funcao faz.
 */

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_ENTRADA_CD = 0x02014b50;
const TAMANHO_MINIMO_EOCD = 22;
/** Campo de 4 bytes saturado: o valor real esta no extra field do ZIP64. */
const MARCADOR_ZIP64 = 0xffffffff;
/** O comentario final do ZIP tem no maximo 65535 bytes. */
const MAX_COMENTARIO = 0xffff;

interface EntradaDoIndice {
  /** Offset do local file header desta entrada dentro do buffer. */
  offsetLocal: number;
  descomprimido: number;
}

export interface RelatorioDeArquivo {
  entradas: number;
  bytesComprimidos: number;
  bytesDescomprimidos: number;
  /** Quanto o conteudo cresce ao descomprimir. `Infinity` se comprimido for 0. */
  razao: number;
  /** Algum campo saturou em 0xFFFFFFFF (ZIP64): tamanho real desconhecido aqui. */
  zip64: boolean;
  /** Offsets dos cabecalhos locais, para a verificacao que nao acredita no indice. */
  locais: EntradaDoIndice[];
}

/** Onde comeca o End of Central Directory, ou -1. */
function acharEocd(buffer: Buffer): number {
  const minimo = Math.max(0, buffer.length - TAMANHO_MINIMO_EOCD - MAX_COMENTARIO);
  for (let i = buffer.length - TAMANHO_MINIMO_EOCD; i >= minimo; i -= 1) {
    if (buffer.readUInt32LE(i) === ASSINATURA_EOCD) return i;
  }
  return -1;
}

/**
 * Le o indice do ZIP. Devolve `null` quando o buffer nao e um ZIP legivel — o
 * chamador decide o que fazer, porque "nao e zip" nao e a mesma coisa que
 * "e zip e e perigoso".
 */
export function inspecionarArquivoCompactado(buffer: Buffer): RelatorioDeArquivo | null {
  if (buffer.length < TAMANHO_MINIMO_EOCD) return null;

  const eocd = acharEocd(buffer);
  if (eocd < 0) return null;

  const entradas = buffer.readUInt16LE(eocd + 10);
  const inicioCd = buffer.readUInt32LE(eocd + 16);
  if (inicioCd >= buffer.length) return null;

  let cursor = inicioCd;
  let bytesComprimidos = 0;
  let bytesDescomprimidos = 0;
  let zip64 = false;
  let lidas = 0;
  const locais: EntradaDoIndice[] = [];

  while (lidas < entradas && cursor + 46 <= buffer.length) {
    if (buffer.readUInt32LE(cursor) !== ASSINATURA_ENTRADA_CD) break;

    const comprimido = buffer.readUInt32LE(cursor + 20);
    const descomprimido = buffer.readUInt32LE(cursor + 24);
    if (comprimido === MARCADOR_ZIP64 || descomprimido === MARCADOR_ZIP64) zip64 = true;

    bytesComprimidos += comprimido;
    bytesDescomprimidos += descomprimido;

    const nome = buffer.readUInt16LE(cursor + 28);
    const extra = buffer.readUInt16LE(cursor + 30);
    const comentario = buffer.readUInt16LE(cursor + 32);
    locais.push({ offsetLocal: buffer.readUInt32LE(cursor + 42), descomprimido });
    cursor += 46 + nome + extra + comentario;
    lidas += 1;
  }

  if (lidas === 0) return null;

  return {
    entradas: lidas,
    bytesComprimidos,
    bytesDescomprimidos,
    razao: bytesComprimidos > 0 ? bytesDescomprimidos / bytesComprimidos : Infinity,
    zip64,
    locais,
  };
}

/** 64 MB. Acima disso o RSS do SheetJS passa do limite de 512M do container. */
export const MAX_DESCOMPRIMIDO_PADRAO = 64 * 1024 * 1024;

/**
 * 12 MB para docx. **Nao e o mesmo teto do xlsx, e o motivo e medicao.**
 *
 * Medido em 2026-08-29, `mammoth.extractRawText` contra docx sinteticos:
 *
 * | descomprimido | RSS   | razao |
 * | ------------- | ----- | ----- |
 * |     7,9 MB    | 266 MB| 33,7x |
 * |    31,6 MB    | 563 MB| 17,8x |
 * |    94,9 MB    |1400 MB| 14,8x |
 *
 * Contra ~3,3x do SheetJS. Ou seja: um docx de **580 KB** que expande para
 * 31,6 MB ja custa mais RSS do que o container inteiro tem — e passava folgado
 * no teto de 64 MB, herdado da calibragem do xlsx. Herdar o numero era o
 * defeito.
 *
 * 12 MB a ~20x deixa o pior caso em ~250 MB, com folga sobre a linha de base
 * medida da API em producao (84,6 MiB de 512 MiB). Nao aperta nada real: o
 * maior docx do repositorio expande para 3,7 MB, e a tabela `documents` de
 * producao nao tem NENHUM docx.
 */
export const MAX_DESCOMPRIMIDO_DOCX_PADRAO = 12 * 1024 * 1024;
/** Planilha real de dados raramente passa de ~20:1. Bomba classica passa de 1000:1. */
export const MAX_RAZAO_PADRAO = 200;

export class ArquivoCompactadoPerigosoError extends AppError {
  constructor(motivo: string) {
    super(`Arquivo recusado: ${motivo}`, 413, 'ARCHIVE_TOO_LARGE');
  }
}

/**
 * Lanca quando o arquivo, ao ser descomprimido, passaria dos limites.
 *
 * Buffer que nao e ZIP passa sem reclamar: quem chama ja validou o tipo, e
 * recusar aqui transformaria um erro de formato em um erro de tamanho.
 */
function numeroPositivoDoAmbiente(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto.trim() === '') return padrao;
  const valor = Number(bruto);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}

const ASSINATURA_LOCAL = 0x04034b50;
const METODO_ARMAZENADO = 0;
const METODO_DEFLATE = 8;

/**
 * Confere o tamanho descomprimido REAL, sem acreditar no que o indice declara.
 *
 * Medido em 2026-08-29, e este e o motivo de a funcao existir: adulterando os
 * campos de tamanho descomprimido do central directory E dos cabecalhos locais
 * de um xlsx legitimo para `1000`, a checagem por indice **passou com teto de
 * 64 KB e razao de 2x**, e `XLSX.read` inflou 77,8 MB assim mesmo. O tamanho
 * declarado e um dado do atacante.
 *
 * A causa e visivel no SheetJS: com zlib nativo disponivel (o caso no Node),
 * `_inflateRawSync` ignora o tamanho declarado e infla o stream inteiro; a
 * comparacao `_usz != usz` que dispara "Bad uncompressed size" so acontece
 * DEPOIS, quando a memoria ja foi alocada.
 *
 * Aqui a inflacao roda com `maxOutputLength`, entao zlib aborta no instante em
 * que o orcamento estoura — o pior caso alocado e o proprio orcamento, nunca o
 * tamanho do ataque. `Z_SYNC_FLUSH` porque cada entrada e seguida das demais no
 * mesmo buffer, e o padrao `Z_FINISH` trataria isso como stream truncado.
 *
 * Para entrada ARMAZENADA (metodo 0) nao ha o que inflar: o conteudo esta no
 * arquivo, entao o tamanho e limitado pelo proprio arquivo e conta direto.
 */
function verificarTamanhoRealDescomprimido(
  buffer: Buffer,
  locais: EntradaDoIndice[],
  orcamento: number,
): void {
  let restante = orcamento;

  for (const { offsetLocal } of locais) {
    if (offsetLocal + 30 > buffer.length) continue;
    if (buffer.readUInt32LE(offsetLocal) !== ASSINATURA_LOCAL) continue;

    const metodo = buffer.readUInt16LE(offsetLocal + 8);
    const nome = buffer.readUInt16LE(offsetLocal + 26);
    const extra = buffer.readUInt16LE(offsetLocal + 28);
    const inicioDados = offsetLocal + 30 + nome + extra;
    if (inicioDados >= buffer.length) continue;

    if (metodo === METODO_ARMAZENADO) {
      // Sem compressao, o que o SheetJS le e o span de `_csz` bytes do
      // cabecalho LOCAL — nao o tamanho descomprimido do indice. Foi
      // exatamente essa distincao que deixou o primeiro bypass passar: o
      // `XLSX.write` do proprio SheetJS grava ARMAZENADO, entao adulterar so os
      // campos de tamanho descomprimido bastava. Limitado pelo buffer, porque
      // um `_csz` mentiroso nao cria bytes que nao existem no arquivo.
      const comprimidoLocal = buffer.readUInt32LE(offsetLocal + 18);
      restante -= Math.min(comprimidoLocal, buffer.length - inicioDados);
    } else if (metodo === METODO_DEFLATE) {
      try {
        const saida = zlib.inflateRawSync(buffer.subarray(inicioDados), {
          maxOutputLength: Math.max(restante, 1),
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
        });
        restante -= saida.length;
      } catch (err) {
        // Estourou o orcamento: e exatamente o caso que esta funcao procura.
        if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
          throw new ArquivoCompactadoPerigosoError(
            `descomprimido de verdade passa do limite de ${(orcamento / 1024 / 1024).toFixed(1)} MB, ` +
              'independentemente do que o indice do arquivo declara',
          );
        }
        // Stream corrompido nao e problema de TAMANHO: o parser vai recusar por
        // formato, que e a mensagem certa para o operador. Mas seguir para a
        // proxima entrada, e nao abandonar o arquivo — com `return` bastava por
        // uma entrada quebrada ANTES da bomba para desligar a checagem do resto.
        continue;
      }
    } else {
      // Metodo que o SheetJS nao abre; ele mesmo recusa por formato.
      continue;
    }

    if (restante < 0) {
      throw new ArquivoCompactadoPerigosoError(
        `descomprimido de verdade passa do limite de ${(orcamento / 1024 / 1024).toFixed(1)} MB, ` +
          'independentemente do que o indice do arquivo declara',
      );
    }
  }
}

/** Teto de bytes descomprimidos para docx, que custa muito mais que xlsx. */
export function tetoDescomprimidoDocx(): number {
  return numeroPositivoDoAmbiente(
    'DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_DOCX_BYTES',
    MAX_DESCOMPRIMIDO_DOCX_PADRAO,
  );
}

export function assertArquivoSeguroParaAbrir(
  buffer: Buffer,
  opts: { maxDescomprimido?: number; maxRazao?: number } = {},
): void {
  // `Number(undefined)` e NaN, e NaN NAO ativa o `??`. Escrito com `??` direto,
  // o limite viraria NaN quando a variavel nao existe, toda comparacao daria
  // falso e a guarda inteira ficaria desligada em silencio — exatamente a
  // classe de defeito que este arquivo existe para evitar.
  const maxDescomprimido =
    opts.maxDescomprimido ??
    numeroPositivoDoAmbiente('DOCUMENT_ARCHIVE_MAX_UNCOMPRESSED_BYTES', MAX_DESCOMPRIMIDO_PADRAO);
  const maxRazao =
    opts.maxRazao ?? numeroPositivoDoAmbiente('DOCUMENT_ARCHIVE_MAX_RATIO', MAX_RAZAO_PADRAO);

  const relatorio = inspecionarArquivoCompactado(buffer);
  if (!relatorio) return;

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

  // ZIP64 esconde o tamanho real fora do campo de 4 bytes. Um documento
  // operacional nao precisa de ZIP64; recusar e a leitura conservadora.
  if (relatorio.zip64) {
    throw new ArquivoCompactadoPerigosoError(
      'usa ZIP64, formato reservado a arquivos muito grandes e nao esperado em documento operacional',
    );
  }

  if (relatorio.bytesDescomprimidos > maxDescomprimido) {
    throw new ArquivoCompactadoPerigosoError(
      `descomprimido teria ${mb(relatorio.bytesDescomprimidos)}, acima do limite de ${mb(maxDescomprimido)}`,
    );
  }

  if (relatorio.razao > maxRazao) {
    throw new ArquivoCompactadoPerigosoError(
      `expande ${relatorio.razao.toFixed(0)}x ao descomprimir, acima do limite de ${maxRazao}x`,
    );
  }

  // As checagens acima leem o que o arquivo DECLARA, e declaracao e dado do
  // atacante. Esta ultima mede. Fica por ultimo de proposito: o arquivo grande
  // honesto ja foi recusado sem alocar nada, e so o que passou por todas as
  // declaracoes paga o custo de inflar — que, para as planilhas reais deste
  // sistema (a maior tem 218 KB), e desprezivel.
  verificarTamanhoRealDescomprimido(buffer, relatorio.locais, maxDescomprimido);
}
