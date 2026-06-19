interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Anomaly text contract (consumed by validation/service.ts reconciliation).
 *
 * The AI/deterministic anomaly stream and the deterministic document-comparison
 * panel ("Itens no Packing List sem correspondencia na Invoice") MUST agree on
 * how many items are unmatched. The AI uses fuzzy matching and frequently
 * over-reports (e.g. "7 itens nao encontrados no Packing List" while the
 * deterministic panel shows 1). To keep both surfaces consistent, the
 * deterministic comparison is the single source of truth: validation/service
 * drops any AI-emitted item-presence anomaly and re-emits a single anomaly
 * whose count comes from the deterministic unmatched-items set.
 *
 * These markers let the reconciler identify (a) AI item-presence anomalies to
 * suppress, and (b) the canonical field names to use for the re-emitted ones.
 *
 * Matching is BIDIRECTIONAL: the deterministic comparison exposes both
 * unmatchedPlItems (PL items absent from the Invoice) and unmatchedInvoiceItems
 * (Invoice items absent from the PL). The reconciler re-emits one deterministic
 * anomaly PER non-empty direction so the anomaly stream and the comparison
 * panels agree in both directions instead of collapsing into a single count.
 */
/** Canonical field for PL items missing from the Invoice (PL → INV direction). */
export const ITEM_MATCH_ANOMALY_FIELD = 'items.unmatched';
/** Canonical field for PL items missing from the Invoice (explicit alias). */
export const ITEM_MATCH_ANOMALY_FIELD_PL = 'items.unmatched.pl';
/** Canonical field for Invoice items missing from the Packing List (INV → PL). */
export const ITEM_MATCH_ANOMALY_FIELD_INVOICE = 'items.unmatched.invoice';

/** A `field` belongs to the per-item match family (e.g. "items.PI7752Y"). */
export function isItemMatchAnomalyField(field: string | undefined): boolean {
  if (!field) return false;
  // "items", "items.<code>", "items.unmatched" — but NOT "items.<code>.quantity"
  // (quantity divergences are a separate, kept signal).
  if (!/^items(\.|$)/.test(field)) return false;
  if (/\.quantity$/.test(field)) return false;
  return true;
}

export function buildAnomalyPrompt(
  invoiceData: Record<string, any>,
  packingListData: Record<string, any>,
  blData: Record<string, any>,
): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `Voce e um especialista em deteccao de anomalias em documentos de comercio exterior para o Grupo Uni.co, importador brasileiro das marcas Puket e Imaginarium.

CONTEXTO:
- Fornecedor principal: KIOM INDUSTRY CO., LTD (China)
- Documentos: Commercial Invoice, Packing List, Bill of Lading (BL)
- Na Invoice e PL o exportador se chama "exporterName". No BL se chama "shipper".
- Na Invoice e PL o importador se chama "importerName". No BL se chama "consignee".
- Tolerancia numerica: diferencas < 0.5% sao aceitaveis para pesos e volumes.

Execute as seguintes verificacoes cruzadas:

1. **Consistencia de nomes**: Compare exportador/shipper e importador/consignee entre os 3 documentos. Diferencas menores de formatacao (Co., Ltd. vs Co. Ltd) = severidade baixa. Nomes completamente diferentes = severidade alta.

2. **Consistencia numerica**: Compare totais entre documentos:
   - Total de caixas deve bater nos 3 documentos
   - Peso bruto total deve bater entre PL e BL
   - CBM total deve bater entre PL e BL
   - Quantidades por item na Invoice devem bater com o PL

3. **Consistencia de portos**: Porto de embarque e destino devem bater entre Invoice e BL.

4. **Dados faltantes**: Sinalize campos criticos ausentes (numero da invoice, numero do BL, numero do container).

5. **Consistencia de datas**: Data de embarque/BL nao pode ser anterior a data da Invoice.

6. **Consistencia importador/consignee**: Importador na Invoice deve bater com consignee no BL.

Responda com JSON estrito:
{
  "anomalies": [
    {
      "field": "nome_do_campo",
      "description": "Descricao da discrepancia encontrada",
      "severity": "low|medium|high",
      "confidence": 0.0
    }
  ]
}

Niveis de severidade:
- **low**: Diferencas de formatacao, dados nao-criticos faltantes, arredondamentos
- **medium**: Discrepancias moderadas que precisam revisao (quantidades levemente diferentes, datas inconsistentes)
- **high**: Problemas criticos (nomes completamente diferentes, grandes discrepancias numericas, dados essenciais faltantes)

Se nenhuma anomalia for encontrada, retorne: { "anomalies": [] }
NAO invente anomalias. Responda SOMENTE com JSON.`,
    },
    {
      role: 'user',
      content: `Faca a verificacao cruzada dos seguintes 3 documentos e identifique anomalias:

=== FATURA COMERCIAL (INVOICE) ===
${JSON.stringify(invoiceData, null, 2)}

=== PACKING LIST ===
${JSON.stringify(packingListData, null, 2)}

=== CONHECIMENTO DE EMBARQUE (BL) ===
${JSON.stringify(blData, null, 2)}`,
    },
  ];
}
