import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  RegistroComparisonTable,
  type RegistroComparisonResult,
} from './RegistroDocumentComparison';
const base: RegistroComparisonResult = {
  status: 'pending',
  sources: {},
  issues: ['espelho: documento não anexado.'],
  rows: [],
};
describe('Registro documentary comparison', () => {
  it('shows missing evidence as pending rather than success', () => {
    render(<RegistroComparisonTable result={base} />);
    expect(screen.getByRole('status')).toHaveTextContent('Conferência pendente');
    expect(screen.getByText('espelho: documento não anexado.')).toBeInTheDocument();
  });
  it('mostra a unidade junto à quantidade sem inventar unidade ausente', () => {
    render(
      <RegistroComparisonTable
        result={{
          ...base,
          rows: [
            {
              key: 'sku-050404509',
              label: 'SKU 050404509',
              status: 'skipped',
              values: {
                duimp: {
                  value: 42,
                  unitType: 'PCS',
                  fileName: 'duimp.pdf',
                  driveVersion: 2,
                  field: 'items[0].quantity',
                },
                invoice: {
                  value: 42,
                  unitType: null,
                  fileName: 'invoice.pdf',
                  driveVersion: 1,
                  field: 'items[0].quantity',
                },
                espelho: { value: null, fileName: null, driveVersion: null, field: 'quantity' },
              },
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('42 PCS')).toBeInTheDocument();
    expect(screen.getByText('42', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Não lido / ausente')).toBeInTheDocument();
  });

  it('announces success only for a complete comparison', () => {
    render(<RegistroComparisonTable result={{ ...base, status: 'match', issues: [] }} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Todos os itens e campos conferidos correspondem',
    );
  });
});
