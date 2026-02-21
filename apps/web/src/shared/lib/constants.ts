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
  { value: 'other', label: 'Outro' },
] as const;

export const BRANDS = [
  { value: 'puket', label: 'Puket' },
  { value: 'imaginarium', label: 'Imaginarium' },
] as const;

export const VALIDATION_CHECK_NAMES = [
  { value: 'peso_check', description: 'Verificação de peso bruto/líquido' },
  { value: 'valor_unitario_check', description: 'Verificação de valor unitário' },
  { value: 'valor_total_check', description: 'Verificação de valor total' },
  { value: 'ncm_check', description: 'Verificação de NCM' },
  { value: 'quantidade_check', description: 'Verificação de quantidade' },
  { value: 'moeda_check', description: 'Verificação de moeda' },
  { value: 'incoterm_check', description: 'Verificação de Incoterm' },
  { value: 'frete_check', description: 'Verificação de frete' },
  { value: 'seguro_check', description: 'Verificação de seguro' },
  { value: 'origem_check', description: 'Verificação de origem' },
  { value: 'exportador_check', description: 'Verificação de exportador' },
  { value: 'importador_check', description: 'Verificação de importador' },
  { value: 'duplicidade_check', description: 'Verificação de duplicidade' },
  { value: 'consistencia_check', description: 'Verificação de consistência entre documentos' },
] as const;
