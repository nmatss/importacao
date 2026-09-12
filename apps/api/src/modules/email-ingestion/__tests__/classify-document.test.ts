import { describe, it, expect } from 'vitest';
import { classifyDocument, classifyDocumentText } from '../classify-document.js';

describe('classifyDocument — convencao KIOM PI (incidente 2026-06-22)', () => {
  it('"KIOM PI - ..." classifica como proforma_invoice', () => {
    expect(classifyDocument('KIOM PI - IM2402608AXI.xlsx')).toBe('proforma_invoice');
    expect(classifyDocument('KIOM PI - PK1892606BXI.pdf')).toBe('proforma_invoice');
  });
  it('"KIOM CI - ..." continua invoice (CI = commercial invoice)', () => {
    expect(classifyDocument('KIOM CI - IM0732604NB.pdf')).toBe('invoice');
  });
  it('proforma explicito continua proforma', () => {
    expect(classifyDocument('Proforma Invoice 123.pdf')).toBe('proforma_invoice');
  });
  it('codigo de processo "PI4257Y" embutido NAO vira proforma', () => {
    // token "pi4257y" != "pi"; deve cair em invoice pelo INV/CI ou outro, nao proforma
    expect(classifyDocument('Commercial Invoice PI4257Y.pdf')).toBe('invoice');
  });
});

describe('classifyDocumentText — triagem auditavel de conteudo', () => {
  it('identifica um tipo unico a partir do cabecalho', () => {
    expect(classifyDocumentText('COMMERCIAL INVOICE\nInvoice No. 123')).toEqual(['invoice']);
    expect(classifyDocumentText('PACKING LIST\nGross Weight')).toEqual(['packing_list']);
  });

  it('preserva ambiguidade para revisao em vez de escolher silenciosamente', () => {
    expect(classifyDocumentText('COMMERCIAL INVOICE attached to BILL OF LADING')).toEqual([
      'invoice',
      'ohbl',
    ]);
  });
});

describe('classifyDocument — BL vence tokens de referencia (auditoria 2026-07-17)', () => {
  it('BL nomeado com o numero da CI e BL, nao invoice (misclass OHBL conhecido)', () => {
    expect(classifyDocument('OHBL SSZ123456 - CI IM0712602NB.pdf')).toBe('ohbl');
    expect(classifyDocument('BL - INV 4521.pdf')).toBe('ohbl');
    expect(classifyDocument('Bill of Lading CI 1234.pdf')).toBe('ohbl');
  });
  it('BL com token PL de referencia continua BL', () => {
    expect(classifyDocument('HBL 998877 ref PL 12.pdf')).toBe('ohbl');
  });
  it('palavra forte de invoice/packing continua vencendo o sinal de BL', () => {
    expect(classifyDocument('Commercial Invoice BL9987.pdf')).toBe('invoice');
    expect(classifyDocument('PACKING LIST BL 12345.pdf')).toBe('packing_list');
  });
  it('tokens fracos sem sinal de BL seguem classificando', () => {
    expect(classifyDocument('CI 12345.pdf')).toBe('invoice');
    expect(classifyDocument('PL 12345.pdf')).toBe('packing_list');
  });
  it('draft com sinal de BL continua draft_bl', () => {
    expect(classifyDocument('DRAFT BL CI IM071.pdf')).toBe('draft_bl');
  });
});

/**
 * DRV-03: o rascunho da DUIMP salvo na pasta do Drive tem de entrar como
 * `draft_duimp`. O classificador ja fazia isso; estes casos CONGELAM o
 * comportamento com os nomes reais das pastas de 11/09, agora que a varredura
 * do Drive passa a ler esses arquivos de verdade.
 */
describe('classifyDocument — nomes reais das pastas do Drive (11/09/2026)', () => {
  it.each([
    ['RASCUNHO DUIMP - PK2202608SZ.pdf', 'draft_duimp'],
    ['RASCUNHO DUIMP PUKET 437 - PK2202608SZ.pdf', 'draft_duimp'],
    ['RASCUNHO DUIMP CORRIGIDO - PK2192607SZ (1).pdf', 'draft_duimp'],
    ['RASCUNHO DA DUIMP - PUK034-26- PK2202608SZ.pdf', 'draft_duimp'],
    // DUIMP REGISTRADA (extrato) nao pode virar rascunho.
    ['Extrato-DUIMP-26BR00016608802-Versao-0001 - PUK032-26 - PK2192607SZ.pdf', 'duimp'],
    ['2026.08.07 KIOM INV - PK2192607SZ.pdf', 'invoice'],
    ['KIOM CI - PK2192607SZ.xlsx', 'invoice'],
    ['KIOM PL - PK2192607SZ.pdf', 'packing_list'],
    ['PK2192607SZ OHBL COPY.pdf', 'ohbl'],
    ['Puket - 439 - OHBL COLORIDO.pdf', 'ohbl'],
    ['Puket - 437 - HBL DRAFT 01.PDF', 'draft_bl'],
  ])('%s -> %s', (nome, esperado) => {
    expect(classifyDocument(nome)).toBe(esperado);
  });
});
