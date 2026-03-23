/**
 * Mapeamento dos checks de validacao para tipos de erro do departamento.
 * Os 29 tipos de erro correspondem as categorias usadas na planilha de Follow-Up
 * (coluna "TIPO" - col 92).
 */

export const CORRECTION_ERROR_TYPES = [
  'descricao',
  'ncm',
  'composicao_ncm',
  'cbm',
  'peso',
  'frete',
  'manufacturer',
  'certificado',
  'bl',
  'espelho',
  'foc',
  'invoice_valor',
  'invoice_qtd',
  'pl_peso',
  'pl_volumes',
  'pl_cbm',
  'incoterm',
  'porto',
  'moeda',
  'importador',
  'exportador',
  'endereco',
  'unidade',
  'data',
  'referencia',
  'assinatura',
  'carimbo',
  'seguro',
  'outros',
] as const;

export type CorrectionErrorType = (typeof CORRECTION_ERROR_TYPES)[number];

/**
 * Mapeia cada check de validacao para os tipo(s) de erro que ele detecta.
 * Um check pode mapear para multiplos tipos (ex: item-level-match detecta qtd + peso + valor).
 */
export const CHECK_TO_ERROR_TYPES: Record<string, CorrectionErrorType[]> = {
  'exporter-match': ['exportador'],
  'importer-match': ['importador'],
  'process-reference': ['referencia'],
  'incoterm-check': ['incoterm'],
  'ports-match': ['porto'],
  'dates-match': ['data'],
  'currency-check': ['moeda'],
  'fob-calculation': ['invoice_valor'],
  'description-odoo-match': ['descricao'],
  'box-quantity-match': ['pl_volumes'],
  'net-weight-match': ['peso'],
  'gross-weight-match': ['peso'],
  'cbm-match': ['cbm'],
  'freight-value-match': ['frete'],
  'unit-type-validation': ['unidade'],
  'manufacturer-completeness': ['manufacturer'],
  'ncm-bl-description': ['ncm', 'bl'],
  'invoice-value-vs-fup': ['invoice_valor'],
  'freight-vs-fup': ['frete'],
  'cbm-vs-fup': ['cbm'],
  'container-type-vs-fup': ['outros'],
  'item-level-match': ['invoice_qtd', 'invoice_valor', 'peso'],
  'payment-terms-check': ['outros'],
  'date-sequence-check': ['data'],
  'weight-ratio-check': ['peso'],
  'supplier-address-match': ['endereco', 'exportador'],
  'certificate-completeness': ['certificado'],
};

/**
 * Dado uma lista de checks com falha, retorna os tipos de erro unicos.
 */
export function getErrorTypesFromChecks(failedCheckNames: string[]): CorrectionErrorType[] {
  const types = new Set<CorrectionErrorType>();
  for (const checkName of failedCheckNames) {
    const mapped = CHECK_TO_ERROR_TYPES[checkName];
    if (mapped) {
      for (const t of mapped) types.add(t);
    } else {
      types.add('outros');
    }
  }
  return Array.from(types);
}
