import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CertStatusBadge } from './CertStatusBadge';

describe('CertStatusBadge (reduced enums)', () => {
  it.each([
    ['ATIVO', 'Ativo'],
    ['ENCERRADO', 'Encerrado'],
    ['CONFORME', 'Conforme'],
    ['NAO_CONFORME', 'Não Conforme'],
    ['VALIDO', 'Válido'],
    ['VENCIDO', 'Vencido'],
    ['NAO_APLICAVEL', 'N/A'],
  ])('renders the PT-BR label for %s', (status, label) => {
    render(<CertStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('degrades gracefully for an unknown/legacy value (no throw, raw label)', () => {
    // PENDENTE / SKU_EXCLUIDO / EM_ANDAMENTO are no longer emitted by the backend,
    // but a stale value must still render a neutral badge instead of crashing.
    expect(() => render(<CertStatusBadge status="PENDENTE" />)).not.toThrow();
    expect(screen.getByText('PENDENTE')).toBeInTheDocument();
  });
});
