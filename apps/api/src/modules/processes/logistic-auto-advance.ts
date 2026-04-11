import { VALID_LOGISTIC_STATUSES } from './schema.js';

type LogisticStatus = (typeof VALID_LOGISTIC_STATUSES)[number];

const ORDER: Record<LogisticStatus, number> = VALID_LOGISTIC_STATUSES.reduce(
  (acc, s, i) => {
    acc[s] = i;
    return acc;
  },
  {} as Record<LogisticStatus, number>,
);

interface DeriveInput {
  process: {
    etd: Date | string | null;
    eta: Date | string | null;
    shipmentDate: Date | string | null;
    customsChannel: string | null;
    diNumber: string | null;
    customsClearanceAt: Date | null;
    cdArrivalAt: Date | null;
    logisticStatus: string | null;
    status: string;
  };
  followUp: {
    espelhoBuiltAt: Date | null;
    espelhoGeneratedAt: Date | null;
    sentToFeniciaAt: Date | null;
    invoiceSentFeniciaAt: Date | null;
    documentsReceivedAt: Date | null;
  } | null;
  now?: Date;
}

export function deriveLogisticStatus(input: DeriveInput): LogisticStatus {
  const { process: p, followUp: f } = input;
  const now = input.now ?? new Date();

  // 11 — internalized (terminal)
  if (p.status === 'completed') return 'internalized';

  // 10 — waiting_entry: arrived at CD
  if (p.cdArrivalAt) return 'waiting_entry';

  // 7 — port_release: customs cleared
  if (p.customsClearanceAt) return 'port_release';

  // 6 — customs_inspection: customs channel assigned
  if (p.customsChannel) return 'customs_inspection';

  // 5 — registered: DI registered
  if (p.diNumber) return 'registered';

  // 4 — berthing: eta reached
  const eta = toDate(p.eta);
  if (eta && eta.getTime() <= now.getTime()) return 'berthing';

  // 3 — in_transit: shipment departed
  const etd = toDate(p.etd) ?? toDate(p.shipmentDate);
  if (etd && etd.getTime() <= now.getTime()) return 'in_transit';

  // 2 — waiting_shipment: espelho built / sent to fenicia (ready for shipment)
  if (
    f?.espelhoBuiltAt ||
    f?.espelhoGeneratedAt ||
    f?.invoiceSentFeniciaAt ||
    f?.sentToFeniciaAt
  ) {
    return 'waiting_shipment';
  }

  // 1 — consolidation (default)
  return 'consolidation';
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function isForwardTransition(
  current: string | null,
  next: LogisticStatus,
): boolean {
  if (!current) return true;
  const cur = ORDER[current as LogisticStatus];
  if (cur === undefined) return true;
  return ORDER[next] > cur;
}
