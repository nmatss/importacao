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
  { value: 'proforma_invoice', label: 'Proforma Invoice' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'ohbl', label: 'Conhecimento de Embarque (BL)' },
  { value: 'draft_bl', label: 'Draft BL (Rascunho)' },
  { value: 'draft_duimp', label: 'Draft DUIMP' },
  { value: 'duimp', label: 'DUIMP' },
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
  { value: 'ncm-bl-description', description: 'NCM OHBL x Espelho' },
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

/**
 * O catalogo do checklist NAO mora mais aqui (decisao D7, reuniao 11/09).
 *
 * A lista de passos, os rotulos, quais estao ativos e as etapas especificas do
 * processo vem prontos do servidor em `GET /api/processes/:id/checklist`
 * (`apps/api/src/modules/processes/checklist-catalog.ts`). Manter uma copia na
 * web era a causa de "Atualizar Follow-up" na tela virar "Enviado para
 * Fenicia" no historico. O teste de guarda em
 * `features/processes/components/DocumentChecklistTab.test.tsx` falha se a
 * lista voltar para este arquivo.
 */

/**
 * Rotulo em portugues do `correctionStatus` do processo.
 *
 * A barra fixa mostrava a chave tecnica crua — o print da reuniao tem um
 * `pending_correction` em ingles ao lado do codigo do processo. Chave
 * desconhecida cai num rotulo generico, nunca no valor do banco.
 */
const CORRECTION_STATUS_LABELS: Record<string, string> = {
  pending_correction: 'Aguardando correção',
  pending: 'Aguardando correção',
  corrected: 'Corrigido',
  resolved: 'Corrigido',
};

export function correctionStatusLabel(status: string): string {
  return CORRECTION_STATUS_LABELS[status.trim().toLowerCase()] ?? 'Em correção';
}

export const DRAFT_BL_CHECKS = [
  {
    key: 'draftReceivedOk',
    label: 'Draft Recebido',
    description: 'Draft BL recebido e identificado no processo',
  },
  {
    key: 'exporterOk',
    label: 'Exportador/Embarcador',
    description: 'Dados do exportador conferem',
  },
  { key: 'consigneeOk', label: 'Consignee', description: 'Dados da empresa importadora corretos' },
  {
    key: 'descriptionOk',
    label: 'Descricao dos Produtos',
    description: 'Descricao resumida confere',
  },
  {
    key: 'referenceOk',
    label: 'Referencia Interna',
    description: 'Referencia do processo presente',
  },
  { key: 'ncmsOk', label: 'NCMs', description: 'NCMs presentes e corretos' },
  {
    key: 'woodOk',
    label: 'Declaracao de Madeira',
    description: 'Informacao de madeira presente (obrigatorio)',
  },
  { key: 'freeTimeOk', label: 'Free Time', description: 'Free time negociado presente' },
  { key: 'weightCbmOk', label: 'Peso e Cubagem', description: 'Peso e CBM consistentes' },
  { key: 'freightOk', label: 'Valor do Frete', description: 'Frete confere' },
  {
    key: 'containersOk',
    label: 'Containers',
    description: 'Quantidade de containers confere com follow-up',
  },
] as const;

export const CORRECTION_ERROR_TYPES = [
  { value: 'descricao', label: 'Descricao' },
  { value: 'ncm', label: 'NCM' },
  { value: 'composicao_ncm', label: 'Composicao NCM' },
  { value: 'cbm', label: 'CBM' },
  { value: 'peso', label: 'Peso' },
  { value: 'frete', label: 'Frete' },
  { value: 'manufacturer', label: 'Fabricante' },
  { value: 'certificado', label: 'Certificado' },
  { value: 'bl', label: 'BL' },
  { value: 'espelho', label: 'Espelho' },
  { value: 'foc', label: 'Free of Charge' },
  { value: 'invoice_valor', label: 'Valor Invoice' },
  { value: 'invoice_qtd', label: 'Qtd Invoice' },
  { value: 'pl_peso', label: 'Peso PL' },
  { value: 'pl_volumes', label: 'Volumes PL' },
  { value: 'pl_cbm', label: 'CBM PL' },
  { value: 'incoterm', label: 'Incoterm' },
  { value: 'porto', label: 'Porto' },
  { value: 'moeda', label: 'Moeda' },
  { value: 'importador', label: 'Importador' },
  { value: 'exportador', label: 'Exportador' },
  { value: 'endereco', label: 'Endereco' },
  { value: 'unidade', label: 'Unidade' },
  { value: 'data', label: 'Data' },
  { value: 'referencia', label: 'Referencia' },
  { value: 'outros', label: 'Outros' },
] as const;

export const LOGISTIC_STAGES = [
  { key: 'consolidation', label: 'Em Consolidacao', icon: 'Package', subInfo: null },
  { key: 'waiting_shipment', label: 'Ag. Embarque', icon: 'Clock', subInfo: 'etd' },
  { key: 'in_transit', label: 'Em Transito', icon: 'Ship', subInfo: null },
  { key: 'berthing', label: 'Em Atracacao', icon: 'Anchor', subInfo: 'port_eta' },
  { key: 'registered', label: 'Registrado', icon: 'FileCheck', subInfo: 'duimp_channel' },
  { key: 'customs_inspection', label: 'Conf. Aduaneira', icon: 'Search', subInfo: 'organ' },
  { key: 'port_release', label: 'Lib. Portuaria', icon: 'ShieldCheck', subInfo: null },
  { key: 'waiting_loading', label: 'Ag. Carregamento', icon: 'Clock', subInfo: null },
  { key: 'traveling_cd', label: 'Em Viagem CD', icon: 'Truck', subInfo: null },
  { key: 'waiting_entry', label: 'Ag. Entrada', icon: 'Warehouse', subInfo: 'date' },
  { key: 'internalized', label: 'Internalizado', icon: 'CheckCircle', subInfo: null },
] as const;
