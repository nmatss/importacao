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

export const allChecks = [
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
];
