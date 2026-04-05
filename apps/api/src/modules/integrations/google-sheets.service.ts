import { sheets_v4, auth as googleAuth } from '@googleapis/sheets';
import { logger } from '../../shared/utils/logger.js';

const SHEETS_API_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Google Sheets API timeout after 30s: ${label}`)),
      SHEETS_API_TIMEOUT_MS,
    ),
  );
  return Promise.race([promise, timeout]);
}

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n');

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
      const response = await withTimeout(
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'A:A',
        }),
        `findProcessRow(${processCode})`,
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

      await withTimeout(
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${column}${row}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[formattedDate]],
          },
        }),
        `updateMilestone(${processCode}, ${field})`,
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
      const response = await withTimeout(
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `A${row}:Z${row}`,
        }),
        `readProcessRow(${processCode})`,
      );

      const values = response.data.values?.[0];
      if (!values) return null;

      // Read header row to map column names
      const headerResponse = await withTimeout(
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'A1:Z1',
        }),
        `readProcessRow.headers(${processCode})`,
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
      const response = await withTimeout(
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'A:Z',
        }),
        'readAllProcessRows',
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
      const response = await withTimeout(
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'A1:Z1',
        }),
        'getSheetHeaders',
      );

      return (response.data.values?.[0] ?? []).map((h: string) => String(h).trim()).filter(Boolean);
    } catch (error) {
      logger.error({ error }, 'Failed to read sheet headers');
      return [];
    }
  },
};
