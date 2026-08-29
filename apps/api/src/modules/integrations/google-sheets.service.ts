import { sheets_v4, auth as googleAuth } from '@googleapis/sheets';
import { normalizeGooglePrivateKey } from '../../shared/utils/google-private-key.js';
import { logger } from '../../shared/utils/logger.js';
import { withRetry, withTimeout } from '../../shared/utils/resilience.js';
import { integrationRetryOptions } from './retry-policy.js';

const SHEETS_API_TIMEOUT_MS = 30_000;

function followUpRange(range: string): string {
  const tab = process.env.GOOGLE_SHEETS_FOLLOW_UP_TAB?.trim() || 'Processos';
  return `'${tab.replace(/'/g, "''")}'!${range}`;
}

/**
 * Timeout de guarda das chamadas do Sheets, agora com cancelamento REAL.
 *
 * A versao anterior era um `Promise.race` com `setTimeout`: a promessa perdedora
 * era descartada, mas a requisicao seguia em voo. `withTimeout` de
 * `shared/utils/resilience.ts` cria um `AbortController`, e o cliente
 * `@googleapis/sheets` aceita `signal` por requisicao (MethodOptions estende
 * GaxiosOptions, que estende RequestInit), entao o abort chega ao fetch.
 */
function sheetsCall<T>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return withTimeout(fn, SHEETS_API_TIMEOUT_MS, `Google Sheets ${label}`);
}

/**
 * Chamada com re-tentativa.
 *
 * Vale para as LEITURAS e tambem para `values.update`: escrever de novo o mesmo
 * valor no MESMO intervalo (`'Aba'!F12`) e idempotente — sobrescreve a celula,
 * nao acrescenta linha. Nao ha `values.append` neste servico, que e a operacao
 * que duplicaria linha se re-tentada.
 */
function sheetsRetry<T>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return withRetry(() => sheetsCall(label, fn), integrationRetryOptions, `sheets:${label}`);
}

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = normalizeGooglePrivateKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY);

  if (!clientEmail || !privateKey) {
    throw new Error('Google credentials not configured');
  }

  const authClient = new googleAuth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = new sheets_v4.Sheets({ auth: authClient });
  return sheetsClient;
}

// Column mapping for milestones - adjust based on actual spreadsheet structure
const MILESTONE_COLUMNS: Record<string, string> = {
  documentsReceivedAt: 'F',
  preInspectionAt: 'G',
  espelhoGeneratedAt: 'H',
  sentToFeniciaAt: 'I',
};

export const googleSheetsService = {
  isConfigured(): boolean {
    return !!(
      process.env.GOOGLE_SHEETS_FOLLOW_UP_ID &&
      process.env.GOOGLE_DRIVE_CLIENT_EMAIL &&
      process.env.GOOGLE_DRIVE_PRIVATE_KEY
    );
  },

  async findProcessRow(processCode: string): Promise<number | null> {
    if (!this.isConfigured()) return null;

    const spreadsheetId = process.env.GOOGLE_SHEETS_FOLLOW_UP_ID!;
    const sheets = getSheetsClient();

    try {
      const response = await sheetsRetry(`findProcessRow(${processCode})`, (signal) =>
        sheets.spreadsheets.values.get({ spreadsheetId, range: followUpRange('A:A') }, { signal }),
      );

      const values = response.data.values;
      if (!values) return null;

      for (let i = 0; i < values.length; i++) {
        if (
          values[i][0] &&
          String(values[i][0]).trim().toUpperCase() === processCode.toUpperCase()
        ) {
          return i + 1; // Sheets rows are 1-indexed
        }
      }

      return null;
    } catch (error) {
      logger.error({ error, processCode }, 'Failed to find process row in Google Sheets');
      return null;
    }
  },

  async updateMilestone(processCode: string, field: string, date: Date): Promise<void> {
    if (!this.isConfigured()) return;

    const column = MILESTONE_COLUMNS[field];
    if (!column) {
      logger.warn({ field }, 'Unknown milestone field for Sheets sync');
      return;
    }

    try {
      const row = await this.findProcessRow(processCode);
      if (!row) {
        logger.warn({ processCode }, 'Process not found in Follow-Up sheet');
        return;
      }

      const spreadsheetId = process.env.GOOGLE_SHEETS_FOLLOW_UP_ID!;
      const sheets = getSheetsClient();
      const formattedDate = date.toLocaleDateString('pt-BR');

      await sheetsRetry(`updateMilestone(${processCode}, ${field})`, (signal) =>
        sheets.spreadsheets.values.update(
          {
            spreadsheetId,
            range: followUpRange(`${column}${row}`),
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[formattedDate]],
            },
          },
          { signal },
        ),
      );

      logger.info({ processCode, field, row }, 'Milestone updated in Follow-Up sheet');
    } catch (error) {
      logger.error({ error, processCode, field }, 'Failed to update milestone in Google Sheets');
    }
  },

  async syncMilestone(processCode: string, field: string, date: Date): Promise<void> {
    try {
      await this.updateMilestone(processCode, field, date);
    } catch (err) {
      logger.error({ err, processCode, field }, 'Failed to sync milestone to Sheets');
    }
  },

  async readProcessRow(processCode: string): Promise<Record<string, string> | null> {
    if (!this.isConfigured()) return null;

    const spreadsheetId = process.env.GOOGLE_SHEETS_FOLLOW_UP_ID!;
    const sheets = getSheetsClient();

    try {
      const row = await this.findProcessRow(processCode);
      if (!row) return null;

      // Read the entire row (columns A through Z)
      const response = await sheetsRetry(`readProcessRow(${processCode})`, (signal) =>
        sheets.spreadsheets.values.get(
          { spreadsheetId, range: followUpRange(`A${row}:Z${row}`) },
          { signal },
        ),
      );

      const values = response.data.values?.[0];
      if (!values) return null;

      // Read header row to map column names
      const headerResponse = await sheetsRetry(`readProcessRow.headers(${processCode})`, (signal) =>
        sheets.spreadsheets.values.get(
          { spreadsheetId, range: followUpRange('A1:Z1') },
          { signal },
        ),
      );

      const headers = headerResponse.data.values?.[0] ?? [];
      const result: Record<string, string> = {};

      for (let i = 0; i < headers.length; i++) {
        const key = String(headers[i]).trim();
        if (key) {
          result[key] = values[i] != null ? String(values[i]).trim() : '';
        }
      }

      return result;
    } catch (error) {
      logger.error({ error, processCode }, 'Failed to read process row from Google Sheets');
      return null;
    }
  },

  async readAllProcessRows(): Promise<Record<string, string>[]> {
    if (!this.isConfigured()) return [];

    const spreadsheetId = process.env.GOOGLE_SHEETS_FOLLOW_UP_ID!;
    const sheets = getSheetsClient();

    try {
      const response = await sheetsRetry('readAllProcessRows', (signal) =>
        sheets.spreadsheets.values.get({ spreadsheetId, range: followUpRange('A:Z') }, { signal }),
      );

      const rows = response.data.values;
      if (!rows || rows.length < 2) return [];

      const headers = rows[0].map((h: string) => String(h).trim());
      const result: Record<string, string>[] = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue; // skip empty rows

        const obj: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
          if (headers[j]) {
            obj[headers[j]] = row[j] != null ? String(row[j]).trim() : '';
          }
        }
        result.push(obj);
      }

      return result;
    } catch (error) {
      logger.error({ error }, 'Failed to read all process rows from Google Sheets');
      return [];
    }
  },

  async getSheetHeaders(): Promise<string[]> {
    if (!this.isConfigured()) return [];

    const spreadsheetId = process.env.GOOGLE_SHEETS_FOLLOW_UP_ID!;
    const sheets = getSheetsClient();

    try {
      const response = await sheetsRetry('getSheetHeaders', (signal) =>
        sheets.spreadsheets.values.get(
          { spreadsheetId, range: followUpRange('A1:Z1') },
          { signal },
        ),
      );

      return (response.data.values?.[0] ?? []).map((h: string) => String(h).trim()).filter(Boolean);
    } catch (error) {
      logger.error({ error }, 'Failed to read sheet headers');
      return [];
    }
  },

  /**
   * Process references declared in column A of the Follow Up sheet (header
   * row excluded).
   *
   * Deliberately THROWS when the sheet cannot be read, unlike the readers
   * above that swallow the error and return an empty array. The caller
   * (`follow-up/reference-registry`) uses this list as an allow-list, so
   * "the sheet says there are no processes" and "we could not reach the
   * sheet" must never collapse into the same empty answer — that ambiguity
   * is what let a 12-day integration outage go unnoticed in 08/2026.
   */
  async readProcessReferences(): Promise<string[]> {
    if (!this.isConfigured()) {
      throw new Error(
        'Follow Up sheet not configured (GOOGLE_SHEETS_FOLLOW_UP_ID / GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY)',
      );
    }

    const spreadsheetId = process.env.GOOGLE_SHEETS_FOLLOW_UP_ID!;
    const sheets = getSheetsClient();

    const response = await sheetsRetry('readProcessReferences', (signal) =>
      sheets.spreadsheets.values.get({ spreadsheetId, range: followUpRange('A2:A') }, { signal }),
    );

    return (response.data.values ?? [])
      .map((row) => (row?.[0] != null ? String(row[0]).trim() : ''))
      .filter((value) => value.length > 0);
  },
};
