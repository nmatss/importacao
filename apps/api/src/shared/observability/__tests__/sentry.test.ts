import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/node';

import { scrubSentryEvent } from '../sentry.js';

function eventWith(partial: Partial<ErrorEvent>): ErrorEvent {
  return { type: undefined, ...partial } as ErrorEvent;
}

describe('scrubSentryEvent', () => {
  it('remove corpo, query e cookies da requisicao', () => {
    const event = scrubSentryEvent(
      eventWith({
        request: {
          url: 'https://app.example/api/processes',
          data: { password: 'x', email: 'alguem@grupounico.com' },
          query_string: 'q=fornecedor',
          cookies: { session: 'abc' },
        },
      }),
    );

    expect(event?.request?.data).toBeUndefined();
    expect(event?.request?.query_string).toBeUndefined();
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.request?.url).toBe('https://app.example/api/processes');
  });

  it('redige headers de autenticacao preservando os demais', () => {
    const event = scrubSentryEvent(
      eventWith({
        request: {
          headers: {
            Authorization: 'Bearer segredo',
            Cookie: 'session=abc',
            'x-request-id': 'req-1',
          },
        },
      }),
    );

    expect(event?.request?.headers?.Authorization).toBe('[REDACTED]');
    expect(event?.request?.headers?.Cookie).toBe('[REDACTED]');
    expect(event?.request?.headers?.['x-request-id']).toBe('req-1');
  });

  it('remove e-mail e IP do usuario, mantendo o id', () => {
    const event = scrubSentryEvent(
      eventWith({
        user: { id: '42', email: 'odett@grupounico.com', ip_address: '10.0.0.5' },
      }),
    );

    expect(event?.user?.id).toBe('42');
    expect(event?.user?.email).toBeUndefined();
    expect(event?.user?.ip_address).toBeUndefined();
  });

  it('redige campos de e-mail e segredo em extra, inclusive aninhados', () => {
    const event = scrubSentryEvent(
      eventWith({
        extra: {
          processoId: 12,
          userEmail: 'odett@grupounico.com',
          payload: {
            recipientEmail: 'kiom@example.com',
            token: 'abc',
            fornecedor: 'KIOM',
            lista: [{ email: 'a@b.c' }],
          },
        },
      }),
    );

    const extra = event?.extra as Record<string, any>;
    expect(extra.processoId).toBe(12);
    expect(extra.userEmail).toBe('[REDACTED]');
    expect(extra.payload.recipientEmail).toBe('[REDACTED]');
    expect(extra.payload.token).toBe('[REDACTED]');
    expect(extra.payload.fornecedor).toBe('KIOM');
    expect(extra.payload.lista[0].email).toBe('[REDACTED]');
  });

  it('nao lanca em evento vazio', () => {
    expect(() => scrubSentryEvent(eventWith({}))).not.toThrow();
    expect(scrubSentryEvent(eventWith({}))).not.toBeNull();
  });
});
