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

export default function descriptionOdooMatch(_input: CheckInput): CheckResult {
  return {
    checkName: 'description-odoo-match',
    status: 'warning',
    documentsCompared: 'INV vs Odoo',
    message: 'Skipped: Odoo product catalog integration not yet available.',
  };
}
