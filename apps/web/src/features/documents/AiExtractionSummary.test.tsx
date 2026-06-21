import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AiExtractionSummary } from './AiExtractionSummary';

describe('AiExtractionSummary coverage header', () => {
  it('shows the backend readPercent and lists missing and low-confidence fields when expanded', () => {
    render(
      <AiExtractionSummary
        documentType="invoice"
        confidence={0.9}
        data={{
          invoiceNumber: { value: 'INV-1', confidence: 0.95 },
          exporterName: { value: 'ACME', confidence: 0.4 },
          totalFobValue: { value: 1000, confidence: 0.9 },
        }}
        coverage={{
          readPercent: 78,
          totalFields: 9,
          filledFields: 7,
          missingFields: ['portOfLoading', 'incoterm'],
          lowConfidenceFields: ['exporterName'],
        }}
      />,
    );

    // The headline answers Eduarda's "leu so 78%" complaint directly.
    const headline = screen.getByText(/Leu 78% dos campos/i);
    expect(headline).toBeInTheDocument();
    // Scope chip assertions to the coverage banner so they don't collide with
    // the same labels rendered in the field grid below.
    const banner = headline.closest('div')?.parentElement as HTMLElement;

    // Fields are hidden until the user expands the list.
    expect(within(banner).queryByText('Porto Embarque')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ver campos/i }));

    // Missing fields rendered with friendly PT-BR labels.
    expect(within(banner).getByText(/Não lidos \(2\)/i)).toBeInTheDocument();
    expect(within(banner).getByText('Porto de Embarque')).toBeInTheDocument();
    expect(within(banner).getByText('Incoterm')).toBeInTheDocument();

    // Low-confidence field surfaced separately.
    expect(within(banner).getByText(/Baixa confiança \(1\)/i)).toBeInTheDocument();
    expect(within(banner).getByText('Exportador')).toBeInTheDocument();
  });

  it('falls back to deriving coverage from field data when the backend summary is absent', () => {
    render(
      <AiExtractionSummary
        documentType="invoice"
        confidence={0.8}
        data={{
          invoiceNumber: { value: 'INV-2', confidence: 0.95 },
          // empty -> counts as missing
          exporterName: { value: '', confidence: null },
          // low per-field confidence -> flagged
          incoterm: { value: 'FOB', confidence: 0.3 },
        }}
      />,
    );

    const banner = screen.getByText(/dos campos/i).closest('div')?.parentElement as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: /Ver campos/i }));
    expect(within(banner).getByText(/Não lidos/i)).toBeInTheDocument();
    expect(within(banner).getByText('Exportador')).toBeInTheDocument();
    expect(within(banner).getByText(/Baixa confiança/i)).toBeInTheDocument();
    const low = within(banner).getByText(/Baixa confiança/i).parentElement as HTMLElement;
    expect(within(low).getByText('Incoterm')).toBeInTheDocument();
  });

  it('renders secondary fields with PT-BR labels instead of raw keys', () => {
    render(
      <AiExtractionSummary
        documentType="invoice"
        confidence={0.9}
        data={{
          invoiceNumber: { value: 'INV-1', confidence: 0.95 },
          exporterTaxId: { value: '12.345.678/0001-90', confidence: 0.9 },
          importerCnpj: { value: '98.765.432/0001-10', confidence: 0.9 },
          portOfDischarge: { value: 'Santos', confidence: 0.9 },
          shipmentDate: { value: '2026-06-01', confidence: 0.9 },
          shippedOnBoardDate: { value: '2026-06-02', confidence: 0.9 },
        }}
        coverage={{
          readPercent: 100,
          totalFields: 6,
          filledFields: 6,
          missingFields: [],
          lowConfidenceFields: [],
        }}
      />,
    );

    // Secondary fields surface friendly PT-BR labels, never the raw key.
    expect(screen.getByText('CNPJ/Tax ID Exportador')).toBeInTheDocument();
    expect(screen.getByText('CNPJ Importador')).toBeInTheDocument();
    expect(screen.getByText('Porto de Descarga')).toBeInTheDocument();
    expect(screen.getByText('Data de Embarque')).toBeInTheDocument();
    expect(screen.getByText('Shipped On Board')).toBeInTheDocument();
    expect(screen.queryByText('exporterTaxId')).not.toBeInTheDocument();
    expect(screen.queryByText('importerCnpj')).not.toBeInTheDocument();
  });

  it('renders per-item EAN, color, size, weight and NCM chips when present', () => {
    render(
      <AiExtractionSummary
        documentType="invoice"
        confidence={0.9}
        data={{
          invoiceNumber: { value: 'INV-1', confidence: 0.95 },
          items: [
            {
              itemCode: 'SKU-1',
              description: 'Produto A',
              quantity: 10,
              unitType: 'PC',
              ean: '7891234567890',
              color: 'Azul',
              size: 'M',
              netWeight: 12.5,
              grossWeight: 15,
              ncmCode: '6109.10.00',
            },
          ],
        }}
        coverage={{
          readPercent: 100,
          totalFields: 1,
          filledFields: 1,
          missingFields: [],
          lowConfidenceFields: [],
        }}
      />,
    );

    const itemRow = screen.getByText('Produto A').closest('div')?.parentElement as HTMLElement;
    expect(within(itemRow).getByText('7891234567890')).toBeInTheDocument();
    expect(within(itemRow).getByText('Azul')).toBeInTheDocument();
    expect(within(itemRow).getByText('M')).toBeInTheDocument();
    expect(within(itemRow).getByText('6109.10.00')).toBeInTheDocument();
    expect(within(itemRow).getByText(/12,5 kg/)).toBeInTheDocument();
    expect(within(itemRow).getByText(/15 kg/)).toBeInTheDocument();
  });

  it('hides the coverage header when everything was read with no fields to review', () => {
    render(
      <AiExtractionSummary
        documentType="invoice"
        confidence={0.95}
        data={{ invoiceNumber: { value: 'INV-3', confidence: 0.95 } }}
        coverage={{
          readPercent: 100,
          totalFields: 1,
          filledFields: 1,
          missingFields: [],
          lowConfidenceFields: [],
        }}
      />,
    );

    expect(screen.queryByText(/dos campos/i)).not.toBeInTheDocument();
  });
});
