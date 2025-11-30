import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'service_account.json');

export interface DefenseSheetRow {
  playerUsed: string;
  team: string;
  position: string;
  opponent: string;
  gameTime: string;
  stat: string;
  line: string;
}

/**
 * Append Defense → Opponent positional strength rows to Google Sheets.
 * Columns (in order):
 * Player Used | Team | Position | Opponent | Game Time | Stat | Line
 */
export async function uploadDefenseRowsToSheets(rows: DefenseSheetRow[]): Promise<void> {
  if (!rows.length) {
    console.log('ℹ️ No rows to upload to Google Sheets.');
    return;
  }

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`❌ service_account.json not found at ${SERVICE_ACCOUNT_PATH}`);
    return;
  }

  const raw = fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8');
  const creds = JSON.parse(raw);

  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.error('❌ SPREADSHEET_ID env var is not set; cannot upload to Google Sheets.');
    return;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const sheetTitle = `Defense_${yyyy}-${mm}-${dd}`;

  // Ensure sheet tab exists (create if needed)
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = meta.data.sheets?.find(s => s.properties?.title === sheetTitle);
    if (!existing) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetTitle,
                },
              },
            },
          ],
        },
      });
      console.log(`📝 Created new sheet tab: ${sheetTitle}`);
    }
  } catch (err: any) {
    console.error('⚠️ Failed to ensure sheet exists:', err.message || err);
  }

  // Ensure header row exists
  try {
    const headerRange = `${sheetTitle}!A1:G1`;
    const existingHeader = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: headerRange,
    });
    const hasHeader =
      existingHeader.data.values && existingHeader.data.values.length > 0 && existingHeader.data.values[0].length > 0;
    if (!hasHeader) {
      const header = ['Player Used', 'Team', 'Position', 'Opponent', 'Game Time', 'Stat', 'Line'];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: headerRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [header],
        },
      });
      console.log('📝 Wrote header row to sheet.');
    }
  } catch (err: any) {
    console.error('⚠️ Failed to ensure header row exists:', err.message || err);
  }

  const values = rows.map(r => [
    r.playerUsed,
    r.team,
    r.position,
    r.opponent,
    r.gameTime,
    r.stat,
    r.line,
  ]);

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetTitle}!A2`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });
    console.log(`✅ Uploaded ${rows.length} rows to Google Sheets (${sheetTitle}).`);
  } catch (err: any) {
    console.error('❌ Failed to upload to Google Sheets:', err.message || err);
  }
}


