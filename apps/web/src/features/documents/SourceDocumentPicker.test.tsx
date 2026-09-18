import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useSourceDocumentPicker } from './SourceDocumentPicker';

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: () => ({
    data: [
      { id: 168, fileName: 'Packing.pdf', documentType: 'packing_list' },
      { id: 348, fileName: 'Packing.xlsx', documentType: 'packing_list' },
      { id: 349, fileName: 'Invoice.xlsx', documentType: 'invoice' },
    ],
    isError: false,
    refetch: vi.fn(),
  }),
}));

function Harness({ processId }: { processId: string }) {
  const selection = useSourceDocumentPicker(processId, ['packingListId']);
  return (
    <>
      {selection.picker}
      <output aria-label="Consulta">{selection.query}</output>
    </>
  );
}

describe('SourceDocumentPicker', () => {
  it('limits choices by type and keeps inspection scoped to the current process', () => {
    const { rerender } = render(<Harness processId="288" />);
    expect(screen.queryByRole('option', { name: /Invoice/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Packing list'), { target: { value: '168' } });
    expect(screen.getByLabelText('Consulta')).toHaveTextContent('packingListId=168');
    rerender(<Harness processId="287" />);
    expect(screen.getByLabelText('Consulta')).toBeEmptyDOMElement();
    expect(screen.getByLabelText('Packing list')).toHaveValue('');
  });

  it('restores automatic selection without a write', () => {
    render(<Harness processId="288" />);
    fireEvent.change(screen.getByLabelText('Packing list'), { target: { value: '168' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar às fontes automáticas' }));
    expect(screen.getByLabelText('Consulta')).toBeEmptyDOMElement();
  });
});
