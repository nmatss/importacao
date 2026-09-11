import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '../shared/database/connection.js';
import { alerts, importProcesses } from '../shared/database/schema.js';
import { alertService } from '../modules/alerts/service.js';
import { businessDaysBetween, isBusinessDay, localDateIso } from '../shared/utils/dates.js';
import { logger } from '../shared/utils/logger.js';

/**
 * "Processo sem movimentacao" — condicao calculada na LEITURA, nunca um evento.
 *
 * O que existia media outra coisa: `import_processes.updated_at` antigo. Medido
 * em producao em 11/09, isso e o estado NORMAL da carteira, nao uma anomalia —
 * 22 dos 28 processos ativos tinham `updated_at` no MESMO minuto (25/08 17:30
 * UTC), carimbado em massa pelo job `logistic-sync`. O relogio passou a correr
 * junto para todos e o canal recebeu rajadas sincronizadas: 26 cards em ~30s as
 * 09:00 de 09/09, 32 das 52 mensagens da semana (61%).
 *
 * A regra agora pergunta se o processo esta FORA do esperado para a fase dele:
 * navio em transito nao deve nada a ninguem; processo que atracou e nao foi
 * registrado, sim. Com os dados de 11/09, os 28 viram 4 — exatamente os que ja
 * deveriam ter registro.
 *
 * DEPENDENCIA DECLARADA: a regra le `eta` e `registered_at` do NOSSO banco, que
 * hoje sao um retrato de 25/08 (a Follow Up nao e sincronizada; `registered_at`
 * esta nulo em 117/117 processos). Enquanto o sync da Follow Up (FUP-02/FUP-04)
 * nao rodar em modo `apply`, um processo ja registrado na planilha continua
 * elegivel aqui e um processo que ja atracou pode aparecer como "em transito"
 * por causa de uma ETA errada. Por isso: processo SEM `eta` nunca e silenciado,
 * e ha teto absoluto (30 dias uteis sem atualizacao) que fura o silencio do
 * transito.
 */

/** Um processo so volta ao digest depois de 5 dias uteis. */
export const DIAS_UTEIS_ENTRE_AVISOS = 5;
/** Dias uteis apos a ETA, sem registro, em que o caso deixa de ser lembrete. */
export const DIAS_UTEIS_PARA_CRITICO = 10;
/** Dias uteis apos a ETA a partir dos quais o processo entra no digest. */
export const DIAS_UTEIS_APOS_ETA = 1;
/** Sem ETA nao da para julgar a fase; sobra a inatividade pura. */
export const DIAS_UTEIS_SEM_PREVISAO = 3;
/** Teto que fura o silencio do transito quando a ETA nao e confiavel. */
export const TETO_DIAS_UTEIS_SEM_ATUALIZACAO = 30;
/** Quantos digests anteriores sao lidos para decidir a cadencia por processo. */
export const HISTORICO_DE_DIGESTS = 20;

/**
 * Titulo fixo. E a chave que o proprio job usa para reler os digests anteriores
 * (cadencia por processo) e a chave de deduplicacao por dia civil — por isso nao
 * pode carregar contagem nem data.
 */
export const TITULO_DIGEST = 'Processos sem movimentação';

export type MotivoParado = 'eta_sem_registro' | 'sem_previsao' | 'teto_absoluto';

export type MotivoSilencio =
  | 'encerrado'
  | 'travado'
  | 'registrado'
  | 'em_transito'
  | 'dentro_do_prazo';

export interface ProcessoParaAvaliacao {
  id: number;
  processCode: string;
  status: string;
  updatedAt: Date | string | null;
  /** Coluna `date`: o driver devolve 'YYYY-MM-DD'. */
  eta: Date | string | null;
  registeredAt: Date | string | null;
  customsClearanceAt: Date | string | null;
  lockedAt: Date | string | null;
}

export interface ProcessoParado {
  id: number;
  processCode: string;
  motivo: MotivoParado;
  diasUteis: number;
  severidade: 'warning' | 'critical';
}

export type Avaliacao =
  | { elegivel: true; parado: ProcessoParado }
  | { elegivel: false; silenciadoPor: MotivoSilencio };

export function severidadePorAtraso(diasUteisAposEta: number): 'warning' | 'critical' {
  return diasUteisAposEta >= DIAS_UTEIS_PARA_CRITICO ? 'critical' : 'warning';
}

/**
 * O processo esta fora do esperado para a fase dele AGORA?
 *
 * Funcao pura: recebe a linha e o instante, nao consulta banco nem relogio
 * global. Toda a regra de elegibilidade do digest cabe aqui.
 */
export function avaliarProcesso(
  processo: ProcessoParaAvaliacao,
  now: Date = new Date(),
): Avaliacao {
  if (processo.status === 'completed' || processo.status === 'cancelled') {
    return { elegivel: false, silenciadoPor: 'encerrado' };
  }
  // Processo travado nao aceita alteracao pela API: cobrar movimentacao dele e
  // cobrar o impossivel.
  if (processo.lockedAt) return { elegivel: false, silenciadoPor: 'travado' };
  if (processo.registeredAt || processo.customsClearanceAt) {
    return { elegivel: false, silenciadoPor: 'registrado' };
  }

  const hoje = localDateIso(now);
  // `updated_at` nulo nao pode ser lido como "parado ha infinito": a coluna tem
  // default e a ausencia e ruido de dado, nao sinal.
  const diasSemAtualizacao = processo.updatedAt ? businessDaysBetween(processo.updatedAt, hoje) : 0;
  const eta = processo.eta ? localDateIso(processo.eta) : null;

  if (eta && eta >= hoje) {
    // Em transito: nada e esperado do time enquanto o navio nao atraca. O teto
    // existe porque a ETA pode estar errada para frente (datas da Follow Up).
    if (diasSemAtualizacao >= TETO_DIAS_UTEIS_SEM_ATUALIZACAO) {
      return {
        elegivel: true,
        parado: {
          id: processo.id,
          processCode: processo.processCode,
          motivo: 'teto_absoluto',
          diasUteis: diasSemAtualizacao,
          severidade: 'warning',
        },
      };
    }
    return { elegivel: false, silenciadoPor: 'em_transito' };
  }

  if (eta) {
    const diasAposEta = businessDaysBetween(eta, hoje);
    if (diasAposEta >= DIAS_UTEIS_APOS_ETA) {
      return {
        elegivel: true,
        parado: {
          id: processo.id,
          processCode: processo.processCode,
          motivo: 'eta_sem_registro',
          diasUteis: diasAposEta,
          severidade: severidadePorAtraso(diasAposEta),
        },
      };
    }
    return { elegivel: false, silenciadoPor: 'dentro_do_prazo' };
  }

  if (diasSemAtualizacao >= DIAS_UTEIS_SEM_PREVISAO) {
    return {
      elegivel: true,
      parado: {
        id: processo.id,
        processCode: processo.processCode,
        motivo: 'sem_previsao',
        diasUteis: diasSemAtualizacao,
        severidade: 'warning',
      },
    };
  }

  return { elegivel: false, silenciadoPor: 'dentro_do_prazo' };
}

export interface DigestAnterior {
  createdAt: Date | string;
  message: string;
}

const LINHA_DE_CODIGOS = /^Processos:[ \t]*(.+)$/m;

/**
 * Codigos citados por um digest anterior.
 *
 * O estado da cadencia mora na propria mensagem ja gravada em `alerts` — e por
 * isso que a regra dispensa migration. A linha e escrita por
 * `montarMensagemDigest` e lida aqui; as duas andam juntas e o teste as amarra.
 */
export function codigosDoDigest(message: string): string[] {
  const linha = LINHA_DE_CODIGOS.exec(message ?? '');
  if (!linha) return [];
  return linha[1]
    .split(',')
    .map((codigo) => codigo.trim())
    .filter(Boolean);
}

/**
 * Aplica a cadencia: um processo aparece no maximo uma vez a cada 5 dias uteis.
 *
 * A excecao e a ESCALADA — quando o caso vira critico depois do ultimo aviso, a
 * espera nao se aplica; seria justamente o momento em que calar custa caro.
 */
export function filtrarPorCadencia(
  parados: ProcessoParado[],
  anteriores: DigestAnterior[],
  now: Date = new Date(),
): ProcessoParado[] {
  const ordenados = [...anteriores].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return parados.filter((parado) => {
    const ultimoAviso = ordenados.find((digest) =>
      codigosDoDigest(digest.message).includes(parado.processCode),
    );
    if (!ultimoAviso) return true;

    const diasDesdeOAviso = businessDaysBetween(ultimoAviso.createdAt, now);
    if (diasDesdeOAviso >= DIAS_UTEIS_ENTRE_AVISOS) return true;

    if (parado.severidade !== 'critical') return false;
    // Contagem de dias uteis e aditiva no mesmo referencial, entao da para saber
    // em que ponto o processo estava quando foi avisado — sem guardar nada.
    const diasUteisNaEpoca = Math.max(parado.diasUteis - diasDesdeOAviso, 0);
    return severidadePorAtraso(diasUteisNaEpoca) !== 'critical';
  });
}

function plural(quantidade: number, singular: string, plural_: string): string {
  return quantidade === 1 ? singular : plural_;
}

function descrever(parado: ProcessoParado): string {
  const dias = `${parado.diasUteis} ${plural(parado.diasUteis, 'dia útil', 'dias úteis')}`;
  switch (parado.motivo) {
    case 'eta_sem_registro':
      return `${parado.processCode}: atracou há ${dias} e continua sem registro de DI/DUIMP.`;
    case 'teto_absoluto':
      return `${parado.processCode}: em trânsito, mas sem nenhuma atualização há ${dias}.`;
    case 'sem_previsao':
      return `${parado.processCode}: sem data de chegada prevista e sem atualização há ${dias}.`;
  }
}

/**
 * UMA mensagem por dia util, com os processos que estao sendo avisados agora.
 *
 * A linha "Processos:" e lida pelo proprio job na execucao seguinte para decidir
 * a cadencia — manter o formato faz parte do contrato.
 */
export function montarMensagemDigest(avisar: ProcessoParado[], totalParados: number): string {
  const cabecalho =
    `${avisar.length} ${plural(avisar.length, 'processo está', 'processos estão')} sem a ` +
    `movimentação esperada para a fase atual.`;
  const codigos = `Processos: ${avisar.map((parado) => parado.processCode).join(', ')}`;
  const detalhes = avisar.map((parado) => `• ${descrever(parado)}`).join('\n');

  const jaAvisados = totalParados - avisar.length;
  const rodape =
    jaAvisados > 0
      ? `Outros ${jaAvisados} seguem parados e já foram avisados nos últimos ` +
        `${DIAS_UTEIS_ENTRE_AVISOS} dias úteis.`
      : `Cada processo volta a aparecer no máximo a cada ${DIAS_UTEIS_ENTRE_AVISOS} dias úteis.`;

  return [cabecalho, codigos, detalhes, rodape].join('\n');
}

export interface ResultadoDoJob {
  avaliados: number;
  parados: number;
  avisados: number;
  digest: boolean;
  pulado?: 'fim_de_semana';
}

export async function checkStalledProcesses(now: Date = new Date()): Promise<ResultadoDoJob> {
  // O cron ja e seg-sex, mas a guarda mora aqui tambem: o job tambem e chamado
  // fora do cron (execucao manual, teste de fumaca) e "nada em fim de semana" e
  // regra de negocio, nao detalhe de agendamento.
  if (!isBusinessDay(now)) {
    logger.info('Stalled process check skipped: fim de semana no fuso do operador');
    return { avaliados: 0, parados: 0, avisados: 0, digest: false, pulado: 'fim_de_semana' };
  }

  logger.info('Running stalled process check job');

  const processos = await db
    .select({
      id: importProcesses.id,
      processCode: importProcesses.processCode,
      status: importProcesses.status,
      updatedAt: importProcesses.updatedAt,
      eta: importProcesses.eta,
      registeredAt: importProcesses.registeredAt,
      customsClearanceAt: importProcesses.customsClearanceAt,
      lockedAt: importProcesses.lockedAt,
    })
    .from(importProcesses)
    .where(and(ne(importProcesses.status, 'completed'), ne(importProcesses.status, 'cancelled')));

  const parados = processos.flatMap((processo) => {
    const avaliacao = avaliarProcesso(processo, now);
    return avaliacao.elegivel ? [avaliacao.parado] : [];
  });

  const historico = await db
    .select({ createdAt: alerts.createdAt, message: alerts.message })
    .from(alerts)
    .where(eq(alerts.title, TITULO_DIGEST))
    .orderBy(desc(alerts.createdAt))
    .limit(HISTORICO_DE_DIGESTS);

  const anteriores = historico.flatMap((linha) =>
    linha.createdAt ? [{ createdAt: linha.createdAt, message: linha.message }] : [],
  );

  const avisar = filtrarPorCadencia(parados, anteriores, now);

  if (avisar.length === 0) {
    logger.info(
      { parados: parados.length, avaliados: processos.length },
      'Stalled process check: conjunto sem novidade, nenhuma mensagem enviada',
    );
    return { avaliados: processos.length, parados: parados.length, avisados: 0, digest: false };
  }

  await alertService.create({
    severity: avisar.some((parado) => parado.severidade === 'critical') ? 'critical' : 'warning',
    title: TITULO_DIGEST,
    message: montarMensagemDigest(avisar, parados.length),
    // Dia civil BRT, e nao janela deslizante de 24h: o cron diario comparado com
    // uma janela de exatamente 24h e uma corrida de milissegundos.
    dedupeBy: 'local-day',
  });

  logger.info(
    { avaliados: processos.length, parados: parados.length, avisados: avisar.length },
    'Stalled process check completed',
  );

  return {
    avaliados: processos.length,
    parados: parados.length,
    avisados: avisar.length,
    digest: true,
  };
}
