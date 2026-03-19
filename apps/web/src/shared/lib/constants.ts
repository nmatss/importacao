export const PROCESS_STATUSES = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'documents_received', label: 'Documentos Recebidos' },
  { value: 'validating', label: 'Validando' },
  { value: 'validated', label: 'Validado' },
  { value: 'espelho_generated', label: 'Espelho Gerado' },
  { value: 'sent_to_fenicia', label: 'Enviado Fenícia' },
  { value: 'li_pending', label: 'LI Pendente' },
  { value: 'completed', label: 'Concluído' },
  { value: 'cancelled', label: 'Cancelado' },
] as const;

export const DOCUMENT_TYPES = [
  { value: 'invoice', label: 'Fatura Comercial (Invoice)' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'ohbl', label: 'Conhecimento de Embarque (BL)' },
  { value: 'espelho', label: 'Espelho' },
  { value: 'li', label: 'Licença de Importação (LI)' },
  { value: 'certificate', label: 'Certificado' },
  { value: 'other', label: 'Outro' },
] as const;

export const BRANDS = [
  { value: 'puket', label: 'Puket' },
  { value: 'imaginarium', label: 'Imaginarium' },
] as const;

export const VALIDATION_CHECK_NAMES = [
  { value: 'exporter-match', description: 'Verificação de Exportador' },
  { value: 'importer-match', description: 'Verificação de Importador' },
  { value: 'process-reference', description: 'Referência do Processo' },
  { value: 'incoterm-check', description: 'Verificação de Incoterm' },
  { value: 'ports-match', description: 'Verificação de Portos' },
  { value: 'dates-match', description: 'Verificação de Datas (ETD/Embarque)' },
  { value: 'currency-check', description: 'Verificação de Moeda' },
  { value: 'fob-calculation', description: 'Cálculo FOB (Itens vs Total)' },
  { value: 'description-odoo-match', description: 'Descrição Odoo (Integração)' },
  { value: 'box-quantity-match', description: 'Quantidade de Volumes' },
  { value: 'net-weight-match', description: 'Peso Líquido' },
  { value: 'gross-weight-match', description: 'Peso Bruto' },
  { value: 'cbm-match', description: 'Cubagem (CBM)' },
  { value: 'freight-value-match', description: 'Valor do Frete' },
  { value: 'unit-type-validation', description: 'Tipo de Unidade' },
  { value: 'manufacturer-completeness', description: 'Completude do Fabricante' },
  { value: 'ncm-bl-description', description: 'NCM vs Descricao BL' },
  { value: 'invoice-value-vs-fup', description: 'Valor Invoice vs Sistema' },
  { value: 'freight-vs-fup', description: 'Frete vs Sistema' },
  { value: 'cbm-vs-fup', description: 'CBM vs Sistema' },
  { value: 'container-type-vs-fup', description: 'Container vs Sistema' },
  { value: 'item-level-match', description: 'Correspondência de Itens (INV vs PL)' },
  { value: 'payment-terms-check', description: 'Condições de Pagamento' },
  { value: 'date-sequence-check', description: 'Sequência de Datas' },
  { value: 'weight-ratio-check', description: 'Proporção Peso Bruto/Líquido' },
  { value: 'supplier-address-match', description: 'Endereço do Fornecedor' },
  { value: 'certificate-completeness', description: 'Completude do Certificado' },
] as const;
