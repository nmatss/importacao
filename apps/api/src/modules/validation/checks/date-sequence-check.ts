// Parser ÚNICO de data para todo o módulo de validação. O parser local daqui
// usava `new Date(value)`, que interpreta '03/04/2026' como MM/DD, enquanto
// date-compare interpreta DMY: a MESMA string virava 2026-03-04 aqui e
// 2026-04-03 lá, e como inversão cronológica é `failed`, o artefato de parsing
// gerava falha dura.
import { parseDate } from '../utils/date-compare.js';

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

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function dateSequenceCheck(input: CheckInput): CheckResult {
  const checkName = 'date-sequence-check';

  const invoiceDate = parseDate(input.invoiceData?.invoiceDate ?? input.invoiceData?.date);
  const shipmentDate = parseDate(
    input.blData?.shipmentDate ?? input.blData?.dateOfShipment ?? input.processData?.shipmentDate,
  );
  const eta = parseDate(input.blData?.eta ?? input.processData?.eta);
  const etd = parseDate(input.blData?.etd ?? input.processData?.etd);

  const sources: string[] = [];
  if (invoiceDate) sources.push('INV');
  if (shipmentDate || eta || etd) sources.push('BL');
  if (input.processData?.eta || input.processData?.etd || input.processData?.shipmentDate)
    sources.push('Sistema');

  if (!invoiceDate && !shipmentDate && !eta) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: sources.join(' vs ') || 'N/A',
      message: 'Nenhuma data encontrada nos documentos para validar a sequencia.',
    };
  }

  const issues: string[] = [];
  const warnings: string[] = [];
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // invoiceDate <= shipmentDate
  if (invoiceDate && shipmentDate && invoiceDate > shipmentDate) {
    issues.push(
      `Data da invoice (${formatDate(invoiceDate)}) e posterior a data de embarque (${formatDate(shipmentDate)})`,
    );
  }

  // shipmentDate <= eta
  if (shipmentDate && eta && shipmentDate > eta) {
    issues.push(
      `Data de embarque (${formatDate(shipmentDate)}) e posterior ao ETA (${formatDate(eta)})`,
    );
  }

  // invoiceDate should not be in the future
  if (invoiceDate && invoiceDate > today) {
    issues.push(`Data da invoice (${formatDate(invoiceDate)}) esta no futuro`);
  }

  // Historical ETD is expected for completed/older imports. Treat age as a
  // freshness warning, never as proof that the source date is wrong. Logical
  // inversions and future dates remain hard failures.
  if (etd) {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    if (etd < ninetyDaysAgo) {
      warnings.push(`ETD (${formatDate(etd)}) esta ha mais de 90 dias no passado`);
    }
  }

  const datesSummary: string[] = [];
  if (invoiceDate) datesSummary.push(`INV=${formatDate(invoiceDate)}`);
  if (etd) datesSummary.push(`ETD=${formatDate(etd)}`);
  if (shipmentDate) datesSummary.push(`Ship=${formatDate(shipmentDate)}`);
  if (eta) datesSummary.push(`ETA=${formatDate(eta)}`);

  if (issues.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: 'Data INV <= Embarque <= ETA, sem datas futuras',
      actualValue: datesSummary.join(', '),
      documentsCompared: sources.join(' vs '),
      message: [...issues, ...warnings].join('. ') + '.',
    };
  }

  if (warnings.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Data INV <= Embarque <= ETA, sem datas futuras',
      actualValue: datesSummary.join(', '),
      documentsCompared: sources.join(' vs '),
      message: `${warnings.join('. ')}. A idade da ETD exige revisao de frescor, mas nao prova divergencia.`,
    };
  }

  return {
    checkName,
    status: 'passed',
    expectedValue: 'Datas em ordem logica',
    actualValue: datesSummary.join(', '),
    documentsCompared: sources.join(' vs '),
    message: 'Todas as datas estao em ordem cronologica correta.',
  };
}
