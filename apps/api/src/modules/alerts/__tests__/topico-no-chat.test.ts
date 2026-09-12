import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../shared/metrics/index.js', () => ({
  alertDeliveryTotal: { inc: vi.fn() },
}));

const log = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }));
vi.mock('../../../shared/utils/logger.js', () => ({ logger: log }));

const { sendToGoogleChat, threadKeyParaAlerta, urlComTopico } =
  await import('../google-chat.service.js');

const WEBHOOK = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';

/**
 * Toda mensagem abria um topico novo no espaco: em 11/09, 13 cards de eventos de
 * 3 processos sairam em ~1h30, cada um em seu proprio topico ("cuidar para nao
 * ficar poluido", reuniao de 11/09).
 */
describe('threadKeyParaAlerta()', () => {
  it('agrupa por processo pelo id, que todo caminho de entrega tem', () => {
    // O job de reentrega nao carrega o codigo do processo; se a chave saisse do
    // codigo, o mesmo processo teria dois topicos.
    expect(
      threadKeyParaAlerta({ processId: 288, severity: 'warning', title: 'x', message: 'y' }),
    ).toBe('processo-288');
    expect(
      threadKeyParaAlerta({
        processId: 288,
        processCode: 'PK2202608SZ',
        severity: 'warning',
        title: 'x',
        message: 'y',
      }),
    ).toBe('processo-288');
  });

  it('sem id, usa o codigo do processo', () => {
    expect(
      threadKeyParaAlerta({
        processCode: 'PK2202608SZ',
        severity: 'warning',
        title: 'x',
        message: 'y',
      }),
    ).toBe('processo-pk2202608sz');
  });

  it('mensagem sem processo agrupa por titulo e semana', () => {
    const naSexta = threadKeyParaAlerta(
      { severity: 'warning', title: 'Processos sem movimentação', message: 'y' },
      new Date('2026-09-11T12:00:00Z'),
    );
    const naSegunda = threadKeyParaAlerta(
      { severity: 'warning', title: 'Processos sem movimentação', message: 'y' },
      new Date('2026-09-07T12:00:00Z'),
    );
    const naSemanaSeguinte = threadKeyParaAlerta(
      { severity: 'warning', title: 'Processos sem movimentação', message: 'y' },
      new Date('2026-09-14T12:00:00Z'),
    );

    // Sem acento e sem espaco na chave, e estavel dentro da semana.
    expect(naSexta).toBe('sistema-processos-sem-movimentacao-2026-S37');
    expect(naSegunda).toBe(naSexta);
    expect(naSemanaSeguinte).not.toBe(naSexta);
  });
});

describe('urlComTopico()', () => {
  it('preserva os parametros originais do webhook', () => {
    const url = new URL(urlComTopico(WEBHOOK, 'processo-288'));
    expect(url.searchParams.get('key')).toBe('k');
    expect(url.searchParams.get('token')).toBe('t');
    expect(url.searchParams.get('threadKey')).toBe('processo-288');
    expect(url.searchParams.get('messageReplyOption')).toBe('REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
  });

  it('URL invalido nao derruba o envio', () => {
    expect(urlComTopico('nao-e-url', 'processo-1')).toBe('nao-e-url');
  });
});

describe('sendToGoogleChat()', () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' }) as any;
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('posta no topico do processo', async () => {
    const enviado = await sendToGoogleChat(WEBHOOK, {
      id: 7,
      processId: 288,
      severity: 'warning',
      title: 'Falhas na Validacao',
      message: 'texto',
      processCode: 'PK2202608SZ',
    });

    expect(enviado).toBe(true);
    const destino = String((global.fetch as any).mock.calls[0][0]);
    expect(destino).toContain('threadKey=processo-288');
    expect(destino).toContain('messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
  });

  it('nunca loga o URL, que carrega key e token', async () => {
    await sendToGoogleChat(WEBHOOK, {
      id: 7,
      processId: 288,
      severity: 'warning',
      title: 'Falhas na Validacao',
      message: 'texto',
    });

    const tudoQueFoiLogado = JSON.stringify([
      ...log.info.mock.calls,
      ...log.error.mock.calls,
      ...log.warn.mock.calls,
    ]);
    expect(tudoQueFoiLogado).not.toContain('token=t');
    expect(tudoQueFoiLogado).not.toContain('chat.googleapis.com');
  });
});
