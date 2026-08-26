/**
 * Classificacao de tipo de documento por nome de arquivo (puro, sem deps pesadas
 * — extraido do processor.ts para ser testavel). Ordem importa: primeiro match
 * vence (afinado contra o set real Odett).
 */

// ── Document classification (filename-based, fast) ──────────────────────
//
// IMPORTANT — ordering matters. Checks run top to bottom and the first match
// wins. The sequence below was hand-tuned against the real Odett test set
// (/tmp/odett_analysis/zip/ + ai classifier smoke in /tmp/classify-test.ts):
//   1. invoice / packing_list — unambiguous keyword tokens
//   2. espelho — xlsx file with the literal word
//   3. DRAFT BL before final BL — a file that contains *both* a draft
//      signal (draft / rascunho / preliminar) AND any BL signal must be
//      routed to draft_bl, otherwise it hits the ohbl branch and fires the
//      `documentsReceivedAt` trigger on a draft instead of on the real BL.
//   4. final BL
//   5. draft (without BL token) — still treated as draft_bl because
//      Odett's partners routinely send drafts named only with numeric IDs
//      plus "(draft <process>)".
//   6. DUIMP / Draft DUIMP — explicit registration documents
//   7. certificate (expanded keyword set — phyto / fumiga / ispm / CO / COA
//      / origem / inmetro / radiation / anvisa)
//   8. li — checked last since "li" is a very generic 2-char token
//   9. other — catch-all; processWithAI logs + alerts instead of silent drop
export function classifyDocument(filename: string): string {
  const lower = filename.toLowerCase();
  // Strip extension, then split on separators including parentheses.
  const tokens = lower.replace(/\.[^.]+$/, '').split(/[-_.\s()[\]]+/);

  const hasDraftSignal =
    tokens.includes('draft') ||
    tokens.includes('rascunho') ||
    tokens.includes('preliminar') ||
    lower.includes('draft') ||
    lower.includes('rascunho') ||
    lower.includes('preliminar');

  const hasBLSignal =
    tokens.includes('bl') ||
    tokens.includes('ohbl') ||
    tokens.includes('hbl') ||
    tokens.includes('mbl') ||
    lower.includes('bill') ||
    lower.includes('lading') ||
    lower.includes('conhecimento') ||
    lower.includes('ohbl');

  const hasDuimpSignal = tokens.includes('duimp') || lower.includes('duimp');

  if (hasDuimpSignal) return hasDraftSignal ? 'draft_duimp' : 'duimp';

  // 0. proforma invoice — MUST come before commercial invoice match.
  // Proformas are pre-shipment estimates and should not pollute the Comparativo
  // (which compares actual shipment values across Invoice / PL / BL / Espelho).
  // Só classifica como proforma por sinal EXPLÍCITO. Antes, qualquer "PI<dígitos>"
  // no nome sequestrava Commercial Invoices reais para proforma_invoice (que não
  // conta para documents_received nem entra no Comparativo) — UAT Odett #7.
  // 'pi' como TOKEN standalone = convencao do fornecedor "KIOM PI - ..." (Proforma
  // Invoice). NAO usa "PI<digitos>" (que sequestrava CIs reais — UAT Odett #7): o
  // token so casa "PI" isolado, nao "PI4257Y" nem "KIOM CI". Incidente 2026-06-22:
  // dezenas de "KIOM PI" estavam classificadas como invoice.
  const hasProformaSignal =
    lower.includes('proforma') ||
    lower.includes('pro-forma') ||
    lower.includes('pro forma') ||
    tokens.includes('pi');
  if (hasProformaSignal) return 'proforma_invoice';

  // 1. invoice — só PALAVRAS fortes aqui ('invoice'/'fatura'/'commercial').
  //    Os TOKENS de referência ('inv'/'ci') descem para DEPOIS do BL: um BL
  //    chega rotineiramente nomeado com o número da CI ("OHBL ... CI IM071...")
  //    e era sequestrado para invoice (auditoria 2026-07-17 — o misclass
  //    OHBL-como-invoice conhecido). Palavra forte é autodescrição; token é
  //    referência cruzada.
  if (lower.includes('invoice') || lower.includes('fatura') || lower.includes('commercial'))
    return 'invoice';

  // 2. packing list — idem: palavras fortes antes do BL, token 'pl' depois.
  if (lower.includes('packing') || lower.includes('pack') || lower.includes('romaneio'))
    return 'packing_list';

  // 3. espelho (xlsx) — literal
  if (lower.includes('espelho')) return 'espelho';

  // 4. DRAFT BL — BEFORE final BL. Also catches "draft <process-code>" files
  //    where the BL signal is only implicit (no "bl" token, but the payload
  //    *is* a BL draft in the Uni.co email flow).
  if (hasDraftSignal && (hasBLSignal || /draft[-\s_]*\(?[a-z]{2,5}\d{5,}\)?/i.test(filename))) {
    return 'draft_bl';
  }

  // 5. final BL — vence os tokens de referência 'ci'/'inv'/'pl'.
  if (hasBLSignal) return 'ohbl';

  // 5b. invoice / packing list por TOKEN de referência (fraco) — só chega aqui
  //     um arquivo SEM sinal de BL.
  if (tokens.includes('inv') || tokens.includes('ci')) return 'invoice';
  if (tokens.includes('pl')) return 'packing_list';

  // 6. draft alone — still route to draft_bl (the only non-DUIMP "draft" type
  //    the system models).
  if (hasDraftSignal && !lower.includes('duimp')) return 'draft_bl';

  // 7. certificate — expanded keyword set
  if (
    lower.includes('certificado') ||
    lower.includes('certificate') ||
    tokens.includes('cert') ||
    tokens.includes('co') || // standalone CO token (Certificate of Origin)
    lower.includes('coa') ||
    lower.includes('inmetro') ||
    lower.includes('anvisa') ||
    lower.includes('phyto') ||
    lower.includes('fito') ||
    lower.includes('fumig') ||
    lower.includes('ispm') ||
    lower.includes('origem') ||
    lower.includes('origin')
  )
    return 'certificate';

  // 8. LI — last (too generic otherwise)
  if (tokens.includes('li') || lower.includes('licen') || lower.includes('lpco')) return 'li';

  return 'other';
}

/**
 * Content-only classification for generic filenames and historical triage.
 * Returns every unambiguous document family mentioned in the supplied text;
 * callers must not choose automatically when more than one family is found.
 */
export function classifyDocumentText(text: string): string[] {
  const lower = text.toLowerCase();
  const types: string[] = [];

  if (/\b(proforma|pro[\s-]?forma)(\s+invoice)?\b/.test(lower)) types.push('proforma_invoice');
  if (
    /\b(invoice|fatura|commercial\s+invoice)\b/.test(lower) &&
    !types.includes('proforma_invoice')
  )
    types.push('invoice');
  if (/\b(packing\s*list|romaneio|lista\s+de\s+embarque)\b/.test(lower)) types.push('packing_list');
  if (/\b(draft\s+bl|draft\s+bill|rascunho\s+(do\s+)?bl|bl\s+draft|preliminary\s+bl)\b/.test(lower))
    types.push('draft_bl');
  if (/\b(draft\s+duimp|minuta\s+duimp|rascunho\s+(da\s+)?duimp)\b/.test(lower))
    types.push('draft_duimp');
  if (/\bduimp\b/.test(lower) && !types.includes('draft_duimp')) types.push('duimp');
  if (
    /\b(bill\s+of\s+lading|conhecimento\s+de\s+embarque|ohbl)\b|(?:^|[^a-z])bl(?:$|[^a-z])/.test(
      lower,
    )
  )
    types.push('ohbl');
  if (/\b(espelho)\b/.test(lower)) types.push('espelho');
  if (/\b(licen[çc]a\s+de\s+importa[çc][aã]o)\b|(?:^|[^a-z])li(?:$|[^a-z])/.test(lower))
    types.push('li');
  if (
    /\b(certificado|certificate|cert\s+of\s+origin|fito(ssanit[aá]rio)?|phyto|fumiga[çc][aã]o|ispm|inmetro|anvisa)\b/.test(
      lower,
    )
  )
    types.push('certificate');

  return [...new Set(types)];
}
