/**
 * Precedencia declarada entre documentos, por campo.
 *
 * Os checks cross-document escolhiam a referencia ("esperado") com `values[0]`
 * — isto e, o primeiro documento que por acaso tinha o campo extraido, na ordem
 * em que o array foi montado (INV -> PL -> BL). O operador via um "esperado"
 * cuja origem dependia de qual extracao deu certo, e podia comparar peso bruto
 * de um documento contra peso liquido de outro.
 *
 * `docs/BUSINESS_RULES.md` documenta precedencia para o CARD do processo
 * (Invoice > Espelho > Processo), nao para os checks. A tabela abaixo declara a
 * precedencia DOS CHECKS e o resultado passa a registrar de qual documento veio
 * o valor de referencia.
 *
 * Racional de cada linha:
 * - peso bruto / peso liquido / caixas / cubagem: o Packing List e o documento
 *   que existe para declarar embalagem, peso e cubagem; o BL vem depois porque
 *   traz os numeros que o armador aceitou transportar; a Invoice e comercial e
 *   repete esses dados por conveniencia.
 * - portos: o BL e o contrato de transporte emitido pelo armador — e ele que
 *   governa embarque e descarga reais; INV e PL sao informativos.
 * - referencia do processo: a Invoice e o documento comercial que da origem ao
 *   processo, entao ela e a referencia; PL e BL confirmam.
 */

export type DocumentSource = 'INV' | 'PL' | 'BL';

export const FIELD_SOURCE_PRECEDENCE = {
  grossWeight: ['PL', 'BL', 'INV'],
  netWeight: ['PL', 'INV'],
  cbm: ['PL', 'BL', 'INV'],
  boxes: ['PL', 'BL', 'INV'],
  ports: ['BL', 'INV', 'PL'],
  processReference: ['INV', 'PL', 'BL'],
} as const satisfies Record<string, readonly DocumentSource[]>;

export interface SourcedValue<T> {
  source: DocumentSource;
  value: T;
}

/**
 * Escolhe o valor de referencia segundo a precedencia do campo, e nao segundo a
 * ordem em que os documentos foram lidos. Retorna `null` quando nenhuma das
 * fontes disponiveis tem valor.
 */
export function pickPreferred<T>(
  available: Array<SourcedValue<T>>,
  precedence: readonly DocumentSource[],
): SourcedValue<T> | null {
  for (const source of precedence) {
    const found = available.find((entry) => entry.source === source);
    if (found) return found;
  }
  return available[0] ?? null;
}
