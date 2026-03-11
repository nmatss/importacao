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

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function namesSimilar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return true; // skip comparison if either is empty
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  // Levenshtein-like: allow small differences relative to length
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length < nb.length ? na : nb;
  const threshold = Math.floor(longer.length * 0.2); // 20% tolerance
  let diffs = longer.length - shorter.length;
  for (let i = 0; i < shorter.length && diffs <= threshold; i++) {
    if (shorter[i] !== longer[i]) diffs++;
  }
  return diffs <= threshold;
}

function addressesSimilar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // For addresses, check if the main part (first 60% of chars) overlaps
  const minLen = Math.min(na.length, nb.length);
  const checkLen = Math.floor(minLen * 0.6);
  if (checkLen > 0 && na.slice(0, checkLen) === nb.slice(0, checkLen)) return true;
  return false;
}

export default function supplierAddressMatch(input: CheckInput): CheckResult {
  const checkName = 'supplier-address-match';

  const invExporter = String(input.invoiceData?.exporterName ?? input.invoiceData?.supplierName ?? '').trim();
  const plExporter = String(input.packingListData?.exporterName ?? input.packingListData?.supplierName ?? '').trim();
  const blShipper = String(input.blData?.shipper ?? input.blData?.shipperName ?? input.blData?.exporterName ?? '').trim();

  const invAddress = String(input.invoiceData?.exporterAddress ?? input.invoiceData?.supplierAddress ?? '').trim();
  const plAddress = String(input.packingListData?.exporterAddress ?? input.packingListData?.supplierAddress ?? '').trim();

  const names = [
    { source: 'INV', value: invExporter },
    { source: 'PL', value: plExporter },
    { source: 'BL', value: blShipper },
  ].filter(n => n.value.length > 0);

  if (names.length < 2) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: names.map(n => n.source).join(' vs ') || 'N/A',
      message: 'Not enough supplier/exporter data across documents to compare.',
    };
  }

  const issues: string[] = [];
  const warnings: string[] = [];

  // Compare exporter names across all pairs
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (!namesSimilar(names[i].value, names[j].value)) {
        issues.push(`Exporter name mismatch: ${names[i].source}="${names[i].value}" vs ${names[j].source}="${names[j].value}"`);
      }
    }
  }

  // Compare addresses (INV vs PL)
  if (invAddress && plAddress && !addressesSimilar(invAddress, plAddress)) {
    warnings.push(`Exporter address differs: INV vs PL`);
  }

  // Compare manufacturer with known brand manufacturer (from process data)
  const invManufacturer = String(input.invoiceData?.manufacturerName ?? input.invoiceData?.manufacturer ?? '').trim();
  const processManufacturer = String(input.processData?.exporterName ?? '').trim();
  if (invManufacturer && processManufacturer && !namesSimilar(invManufacturer, processManufacturer)) {
    warnings.push(`Manufacturer in INV (${invManufacturer}) differs from system record (${processManufacturer})`);
  }

  const sources = names.map(n => n.source).join(' vs ');

  if (issues.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: 'Consistent exporter/supplier across documents',
      actualValue: issues.join('; '),
      documentsCompared: sources,
      message: issues.join('. ') + '.',
    };
  }

  if (warnings.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Matching supplier info',
      actualValue: warnings.join('; '),
      documentsCompared: sources,
      message: warnings.join('. ') + '.',
    };
  }

  return {
    checkName,
    status: 'passed',
    expectedValue: names[0].value,
    actualValue: names.map(n => `${n.source}="${n.value}"`).join(', '),
    documentsCompared: sources,
    message: 'Supplier/exporter information is consistent across all documents.',
  };
}
