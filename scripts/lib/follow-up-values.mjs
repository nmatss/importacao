export function parseLocalizedNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const original = String(value).trim();
  if (!original) return null;

  const accountingNegative = /^\s*\(.*\)\s*$/.test(original);
  let normalized = original.replace(/[^\d.,-]/g, '');
  if (!normalized || normalized === '-') return null;

  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return accountingNegative ? -Math.abs(parsed) : parsed;
}

export function parsePercentage(value) {
  const parsed = parseLocalizedNumber(value);
  if (parsed === null) return null;

  const explicitPercentage = typeof value === 'string' && value.includes('%');
  const normalized = explicitPercentage || Math.abs(parsed) > 1 ? parsed / 100 : parsed;
  // numeric(5,4) stores the fractional representation and supports up to
  // 999.99% (9.9999). Operational cash advances may legitimately exceed 100%.
  if (Math.abs(normalized) > 9.9999) {
    throw new RangeError(`Percentual fora do intervalo suportado: ${String(value)}`);
  }
  return normalized;
}

function validIsoParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function parseSpreadsheetDateISO(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (!text) return null;

  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const [, dayText, monthText, yearText] = br;
    const [year, month, day] = [Number(yearText), Number(monthText), Number(dayText)];
    if (!validIsoParts(year, month, day)) return null;
    return `${yearText}-${monthText}-${dayText}`;
  }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (iso) {
    const [, yearText, monthText, dayText] = iso;
    const [year, month, day] = [Number(yearText), Number(monthText), Number(dayText)];
    if (!validIsoParts(year, month, day)) return null;
    return `${yearText}-${monthText}-${dayText}`;
  }

  return null;
}

export function parseSpreadsheetTimestamp(value) {
  const isoDate = parseSpreadsheetDateISO(value);
  return isoDate ? `${isoDate}T00:00:00.000Z` : null;
}
