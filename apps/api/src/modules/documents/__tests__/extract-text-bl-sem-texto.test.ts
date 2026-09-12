/**
 * EXT-01 (reunião 11/09/2026) — "todos os BLs que eu subi são clicáveis, super
 * legíveis, selecionáveis... e ainda assim a leitura está bem ruim".
 *
 * Causa raiz provada fora do repositório com os PDFs reais (docs 155/156/165/
 * 166/169, copiados de produção para o scratchpad e apagados depois): a camada
 * de texto existe e é selecionável, mas usa fonte composta Type0/CIDFontType0
 * (ordering Adobe-GB1, encoding GBK-EUC-H) SEM /ToUnicode — o `pdf-parse`
 * devolve ZERO caractere. Como o código antigo retornava só o texto do OCR
 * assim que o OCR produzia qualquer coisa, o PDF original NUNCA chegava ao
 * Vertex (que lê PDF nativamente) e o modelo recebia um formulário em branco.
 *
 * O teste `descreve` abaixo cobre o contrato novo com o provider mockado. A
 * verificação contra os arquivos reais fica em `real-pdf.test.ts` (opt-in por
 * variável de ambiente) porque documento de cliente não entra no repositório.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '../../../__tests__/helpers/mock-db.js';

const { mockDb } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({ db: mockDb }));
vi.mock('../../audit/service.js', () => ({ auditService: { log: vi.fn() } }));
vi.mock('../../alerts/service.js', () => ({ alertService: { create: vi.fn() } }));

const aiServiceMock = {
  acceptsPdfInput: true,
  providerName: 'vertex',
};
vi.mock('../../ai/service.js', async () => {
  const { AIBudgetExceededError } = await import('../../ai/cost-pricing.js');
  return {
    AIBudgetExceededError,
    flattenAiData: (d: Record<string, any>) => d,
    aiService: aiServiceMock,
  };
});

vi.mock('../../integrations/google-drive.service.js', () => ({
  googleDriveService: {
    isConfigured: vi.fn().mockResolvedValue(false),
    isRootConfigured: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const ocrScannedPdf = vi.fn();
const rasterizePdfPages = vi.fn();
vi.mock('../ocr.js', () => ({ ocrScannedPdf, rasterizePdfPages }));

const extractPopplerText = vi.fn();
vi.mock('../pdf-text.js', () => ({ extractPopplerText }));

const pdfParse = vi.fn();
vi.mock('pdf-parse', () => ({ default: pdfParse }));

const readFile = vi.fn();
vi.mock('fs/promises', () => ({
  default: { readFile, unlink: vi.fn().mockResolvedValue(undefined) },
  readFile,
  unlink: vi.fn().mockResolvedValue(undefined),
}));

const { documentService } = await import('../service.js');

/** Texto do gabarito em branco que o OCR devolve para esses PDFs. */
const BLANK_FORM_OCR = `BILL OF LADING
B/L No
Skipper
Carsignee Nalify prearly
Local Vessel Place of receipt
Conlainer No. Sesl No. Containers
Gross weight Mensurement
AS CARRIER`;

describe('extractText — PDF de BL sem camada de texto legível (EXT-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractPopplerText.mockResolvedValue(null);
    aiServiceMock.acceptsPdfInput = true;
    aiServiceMock.providerName = 'vertex';
    readFile.mockResolvedValue(Buffer.from('%PDF-1.4 conteudo binario'));
    pdfParse.mockResolvedValue({ text: '', numpages: 1 });
  });

  it('uses the recovered CID digital text before OCR or provider fallback', async () => {
    const text = 'BILL OF LADING: recovered digital fields with preserved columns';
    extractPopplerText.mockResolvedValueOnce({ text, pageTexts: [text] });
    const result = await documentService.extractText('/tmp/bl.pdf', 'application/pdf');
    expect(result).toEqual({ text, pageTexts: [text], sourceTextReliable: true, ocrUsed: false });
    expect(pdfParse).not.toHaveBeenCalled();
    expect(ocrScannedPdf).not.toHaveBeenCalled();
    expect(rasterizePdfPages).not.toHaveBeenCalled();
  });

  it('anexa o PDF original ao provider multimodal mesmo quando o OCR devolve texto', async () => {
    ocrScannedPdf.mockResolvedValue({
      text: BLANK_FORM_OCR,
      pageTexts: [BLANK_FORM_OCR],
      pageCount: 1,
    });

    const result = await documentService.extractText('/tmp/bl.pdf', 'application/pdf');

    expect(result.imageBase64).toBe(Buffer.from('%PDF-1.4 conteudo binario').toString('base64'));
    expect(result.imageMimeType).toBe('application/pdf');
    // O OCR continua indo junto, mas como APOIO: não é o documento.
    expect(result.text).toBe(BLANK_FORM_OCR);
    expect(result.ocrUsed).toBe(true);
    expect(result.sourceTextReliable).toBe(false);
    expect(rasterizePdfPages).not.toHaveBeenCalled();
  });

  it('anexa o PDF original também quando não há OCR disponível', async () => {
    ocrScannedPdf.mockResolvedValue(null);

    const result = await documentService.extractText('/tmp/bl.pdf', 'application/pdf');

    expect(result.imageMimeType).toBe('application/pdf');
    expect(result.ocrUsed).toBe(false);
    expect(result.sourceTextReliable).toBe(false);
  });

  it('mantém a rasterização + OCR para provider que não lê PDF', async () => {
    aiServiceMock.acceptsPdfInput = false;
    aiServiceMock.providerName = 'ialocal';
    ocrScannedPdf.mockResolvedValue({
      text: BLANK_FORM_OCR,
      pageTexts: [BLANK_FORM_OCR],
      pageCount: 1,
    });

    const result = await documentService.extractText('/tmp/bl.pdf', 'application/pdf');

    // O modelo vê SOMENTE este texto, então ele é a fonte de verdade
    // disponível e o grounding continua valendo.
    expect(result.text).toBe(BLANK_FORM_OCR);
    expect(result.imageBase64).toBeUndefined();
    expect(result.sourceTextReliable).toBeUndefined();
  });

  it('não anexa PDF acima do teto de 15 MB (protege o limite de request)', async () => {
    readFile.mockResolvedValue(Buffer.alloc(16 * 1024 * 1024, 1));
    ocrScannedPdf.mockResolvedValue(null);

    const result = await documentService.extractText('/tmp/grande.pdf', 'application/pdf');

    expect(result.imageBase64).toBeUndefined();
    expect(result.sourceTextReliable).toBeUndefined();
  });

  it('não toca no caminho normal de PDF com camada de texto boa', async () => {
    const good = `INVOICE ${'A'.repeat(400)}`;
    pdfParse.mockResolvedValue({ text: good, numpages: 1 });

    const result = await documentService.extractText('/tmp/inv.pdf', 'application/pdf');

    expect(result.text).toBe(good);
    expect(result.imageBase64).toBeUndefined();
    expect(result.sourceTextReliable).toBeUndefined();
    expect(ocrScannedPdf).not.toHaveBeenCalled();
  });
});
