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

export interface RelatorioDeArquivo {
  entradas: number;
  bytesComprimidos: number;
  bytesDescomprimidos: number;
  /** Quanto o conteudo cresce ao descomprimir. `Infinity` se comprimido for 0. */
  razao: number;
  /** Algum campo saturou em 0xFFFFFFFF (ZIP64): tamanho real desconhecido aqui. */
  zip64: boolean;
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
  };
}

/** 64 MB. Acima disso o RSS do parser passa do limite de 512M do container. */
export const MAX_DESCOMPRIMIDO_PADRAO = 64 * 1024 * 1024;
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
}
