import { sheets_v4, auth as googleAuth } from '@googleapis/sheets';
import { logger } from '../../shared/utils/logger.js';

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
    return !!(process.env.GOOGLE_SHEETS_FOLLOW_UP_ID && process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY);
  },

  async findProcessRow(processCode: string): Promise<number | null> {
    if (!this.isConfigured()) return null;

    const spreadsheetId = process.env.GOOGLE_SHEETS_FOLLOW_UP_ID!;
    const sheets = getSheetsClient();

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'A:A',
      });

      const values = response.data.values;
      if (!values) return null;

      for (let i = 0; i < values.length; i++) {
        if (values[i][0] && String(values[i][0]).trim().toUpperCase() === processCode.toUpperCase()) {
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

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${column}${row}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[formattedDate]],
        },
      });

      logger.info({ processCode, field, row }, 'Milestone updated in Follow-Up sheet');
    } catch (error) {
      logger.error({ error, processCode, field }, 'Failed to update milestone in Google Sheets');
    }
  },

  async syncMilestone(processCode: string, field: string, date: Date): Promise<void> {
    // Non-blocking wrapper
    this.updateMilestone(processCode, field, date).catch(err =>
      logger.error({ err, processCode, field }, 'Failed to sync milestone to Sheets')
    );
  },
};
