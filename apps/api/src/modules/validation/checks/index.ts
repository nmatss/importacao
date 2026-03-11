import exporterMatch from './exporter-match.js';
import importerMatch from './importer-match.js';
import processReference from './process-reference.js';
import incotermCheck from './incoterm-check.js';
import portsMatch from './ports-match.js';
import datesMatch from './dates-match.js';
import currencyCheck from './currency-check.js';
import fobCalculation from './fob-calculation.js';
import descriptionOdooMatch from './description-odoo-match.js';
import boxQuantityMatch from './box-quantity-match.js';
import netWeightMatch from './net-weight-match.js';
import grossWeightMatch from './gross-weight-match.js';
import cbmMatch from './cbm-match.js';
import freightValueMatch from './freight-value-match.js';
import unitTypeValidation from './unit-type-validation.js';
import manufacturerCompleteness from './manufacturer-completeness.js';
import ncmBlDescription from './ncm-bl-description.js';
import invoiceValueVsFup from './invoice-value-vs-fup.js';
import freightVsFup from './freight-vs-fup.js';
import cbmVsFup from './cbm-vs-fup.js';
import containerTypeVsFup from './container-type-vs-fup.js';
import itemLevelMatch from './item-level-match.js';
import paymentTermsCheck from './payment-terms-check.js';
import dateSequenceCheck from './date-sequence-check.js';
import weightRatioCheck from './weight-ratio-check.js';
import supplierAddressMatch from './supplier-address-match.js';

export interface CheckInput {
  invoiceData?: Record<string, any>;
  packingListData?: Record<string, any>;
  blData?: Record<string, any>;
  processData?: Record<string, any>;
  followUpData?: Record<string, any>;
}

export interface CheckResult {
  checkName: string;
  status: 'passed' | 'failed' | 'warning';
  expectedValue?: string;
  actualValue?: string;
  documentsCompared: string;
  message: string;
}

export type CheckFn = (input: CheckInput) => CheckResult | Promise<CheckResult>;

export const allChecks: CheckFn[] = [
  exporterMatch,
  importerMatch,
  processReference,
  incotermCheck,
  portsMatch,
  datesMatch,
  currencyCheck,
  fobCalculation,
  descriptionOdooMatch,
  boxQuantityMatch,
  netWeightMatch,
  grossWeightMatch,
  cbmMatch,
  freightValueMatch,
  unitTypeValidation,
  manufacturerCompleteness,
  ncmBlDescription,
  invoiceValueVsFup,
  freightVsFup,
  cbmVsFup,
  containerTypeVsFup,
  itemLevelMatch,
  paymentTermsCheck,
  dateSequenceCheck,
  weightRatioCheck,
  supplierAddressMatch,
];
