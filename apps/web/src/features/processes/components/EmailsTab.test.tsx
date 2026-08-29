import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EmailsTab } from './EmailsTab';
import type { EmailLog } from '@/shared/types';

const LONG_SUBJECT =
  'Documentos do processo IMP-2026-007 — invoice, packing list e draft BL para conferencia';

function makeLog(overrides: Partial<EmailLog> = {}): EmailLog {
  return {
    id: 1,
    messageId: 'msg-1',
    fromAddress: 'Fornecedor <fornecedor@exemplo.com>',
    subject: LONG_SUBJECT,
    receivedAt: '2026-03-15T12:00:00.000Z',
    bodyText: null,
    status: 'completed',
    attachmentsCount: 0,
    processedAttachments: 0,
    processCode: 'IMP-2026-007',
    errorMessage: null,
    createdAt: '2026-03-15T12:00:00.000Z',
    ...overrides,
  };
}

function renderTab(logs: EmailLog[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EmailsTab
        processId="7"
        processCode="IMP-2026-007"
        initialResponse={{ data: logs, pagination: {} }}
      />
    </QueryClientProvider>,
  );
}

describe('EmailsTab', () => {
  it('renderiza o assunto uma unica vez, mesmo quando e longo', () => {
    renderTab([makeLog()]);
    // Havia um segundo bloco com `subject.slice(0, 100)` logo abaixo do
    // line-clamp: todo assunto com mais de ~60 caracteres saia duplicado.
    expect(screen.getAllByText(LONG_SUBJECT)).toHaveLength(1);
  });

  it('rotula o status reprocessed com nome proprio, nao como "Pendente"', () => {
    renderTab([makeLog({ status: 'reprocessed' })]);
    expect(screen.getByText('Reprocessado')).toBeInTheDocument();
    expect(screen.queryByText('Pendente')).not.toBeInTheDocument();
  });

  it('mantem o fallback "Pendente" para status realmente desconhecido', () => {
    renderTab([makeLog({ status: 'whatever' as EmailLog['status'] })]);
    expect(screen.getByText('Pendente')).toBeInTheDocument();
  });

  it('cobre os demais status conhecidos', () => {
    renderTab([
      makeLog({ id: 1, status: 'completed' }),
      makeLog({ id: 2, status: 'failed' }),
      makeLog({ id: 3, status: 'ignored' }),
      makeLog({ id: 4, status: 'processing' }),
    ]);
    expect(screen.getByText('Concluído')).toBeInTheDocument();
    expect(screen.getByText('Falhou')).toBeInTheDocument();
    expect(screen.getByText('Ignorado')).toBeInTheDocument();
    expect(screen.getByText('Processando')).toBeInTheDocument();
  });
});
