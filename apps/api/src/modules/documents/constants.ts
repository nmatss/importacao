/**
 * Piso operacional de confiança: abaixo disso a extração fica armazenada para
 * revisão mas NÃO é projetada no processo nem alimenta validação/espelho.
 * Fonte única — service.ts (gates de extração) e reconcile.ts (re-projeção)
 * precisam concordar, senão a reconciliação fura o piso que a extração impôs.
 * O frontend replica o valor em MIN_OPERATIONAL_CONFIDENCE próprio (não importa
 * daqui); mudanças aqui exigem atualizar apps/web.
 */
export const MIN_OPERATIONAL_CONFIDENCE = 0.4;
