import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseLocalizedNumber,
  parsePercentage,
  parseSpreadsheetDateISO,
  parseSpreadsheetTimestamp,
} from './follow-up-values.mjs';

test('parseLocalizedNumber supports pt-BR and international monetary formats', () => {
  assert.equal(parseLocalizedNumber('R$ 1.234.567,89'), 1_234_567.89);
  assert.equal(parseLocalizedNumber('$24,395.55'), 24_395.55);
  assert.equal(parseLocalizedNumber('2.500'), 2_500);
  assert.equal(parseLocalizedNumber('0.6'), 0.6);
  assert.equal(parseLocalizedNumber('(R$ 1.234,50)'), -1_234.5);
});

test('parsePercentage stores percentages as fractions', () => {
  assert.equal(parsePercentage('30,00%'), 0.3);
  assert.equal(parsePercentage(0.6), 0.6);
  assert.equal(parsePercentage(30), 0.3);
  assert.equal(parsePercentage('139,14%'), 1.3914);
  assert.equal(parsePercentage(''), null);
  assert.throws(() => parsePercentage('1.500%'), RangeError);
});

test('spreadsheet dates preserve the pt-BR day/month order', () => {
  assert.equal(parseSpreadsheetDateISO('01/05/2025'), '2025-05-01');
  assert.equal(parseSpreadsheetDateISO('10/09/2026'), '2026-09-10');
  assert.equal(parseSpreadsheetDateISO('2026-08-25'), '2026-08-25');
  assert.equal(parseSpreadsheetDateISO('31/02/2026'), null);
  assert.equal(parseSpreadsheetTimestamp('23/07/2026'), '2026-07-23T00:00:00.000Z');
});
