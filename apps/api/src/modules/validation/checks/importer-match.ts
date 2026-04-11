import {
  extractCompanyLine,
  companySimilarity,
  COMPANY_PASS_THRESHOLD,
  COMPANY_WARN_THRESHOLD,
} from '../utils/name-normalize.js';

interface CheckInput {
  invoiceData?: Record<string, any>;
  packingListData?: Record<string, any>;
  blData?: Record<string, any>;
  processData?: Record<string, any>;
  followUpData?: Record<string, any>;
}

interface CheckResult {
  checkName: string;
  status: 'passed' | 'failed' | 'warning';
  expectedValue?: string;
  actualValue?: string;
  documentsCompared: string;
  message: string;
}

export default function importerMatch(input: CheckInput): CheckResult {
  const checkName = 'importer-match';

  const rawInv = input.invoiceData?.importerName;
  const rawPl = input.packingListData?.importerName;
  const rawBl = input.blData?.consignee ?? input.blData?.consigneeName;

  const entries: { source: string; raw: unknown; display: string }[] = [];
  if (rawInv) entries.push({ source: 'INV', raw: rawInv, display: extractCompanyLine(rawInv) });
  if (rawPl) entries.push({ source: 'PL', raw: rawPl, display: extractCompanyLine(rawPl) });
  if (rawBl) entries.push({ source: 'BL', raw: rawBl, display: extractCompanyLine(rawBl) });

  if (entries.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: entries.map((e) => e.source).join(' vs '),
      message: 'Documentos insuficientes para comparar o nome do importador.',
    };
  }

  // Compute lowest pairwise similarity — worst case wins.
  let minSim = 1;
  let worstPair: [typeof entries[number], typeof entries[number]] = [entries[0], entries[1]];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const sim = companySimilarity(entries[i].raw, entries[j].raw);
      if (sim < minSim) {
        minSim = sim;
        worstPair = [entries[i], entries[j]];
      }
    }
  }

  const documentsCompared = entries.map((e) => e.source).join(' vs ');

  if (minSim >= COMPANY_PASS_THRESHOLD) {
    return {
      checkName,
      status: 'passed',
      expectedValue: entries[0].display,
      actualValue: entries[0].display,
      documentsCompared,
      message: 'Nome do importador confere (match fuzzy) entre os documentos.',
    };
  }

  if (minSim >= COMPANY_WARN_THRESHOLD) {
    return {
      checkName,
      status: 'warning',
      expectedValue: worstPair[0].display,
      actualValue: worstPair[1].display,
      documentsCompared,
      message: `Nome do importador possui diferenças leves entre ${worstPair[0].source} e ${worstPair[1].source} (similaridade ${(minSim * 100).toFixed(0)}%).`,
    };
  }

  return {
    checkName,
    status: 'failed',
    expectedValue: worstPair[0].display,
    actualValue: worstPair[1].display,
    documentsCompared,
    message: `Nome do importador não confere entre ${worstPair[0].source} e ${worstPair[1].source} (similaridade ${(minSim * 100).toFixed(0)}%).`,
  };
}
