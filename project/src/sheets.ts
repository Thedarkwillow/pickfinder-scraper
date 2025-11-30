import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { DefenseRow, todayIsoDate, resolveProjectPath } from './utils';

interface SheetsConfig {
  spreadsheetId: string;
  credentials: {
    client_email: string;
    private_key: string;
  };
}

function loadSheetsConfig(): SheetsConfig | null {
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (!spreadsheetId) {
    console.log('⚠️ SPREADSHEET_ID not set, skipping Google Sheets upload');
    return null;
  }

  // Prefer explicit env credentials if provided
  const envEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const envKey = process.env.GOOGLE_PRIVATE_KEY;

  if (envEmail && envKey) {
    const privateKey = envKey.replace(/\\n/g, '\n');
    return {
      spreadsheetId,
      credentials: {
        client_email: envEmail,
        private_key: privateKey,
      },
    };
  }

  // Fallback to service_account.json in config
  const serviceAccountPath = resolveProjectPath('config', 'service_account.json');

  if (!fs.existsSync(serviceAccountPath)) {
    console.log(
      `⚠️ Neither GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY nor ${serviceAccountPath} are available. Skipping Sheets upload.`,
    );
    return null;
  }

  try {
    const raw = fs.readFileSync(serviceAccountPath, 'utf-8');
    const json = JSON.parse(raw);

    if (!json.client_email || !json.private_key) {
      console.log('⚠️ service_account.json is missing client_email or private_key. Skipping Sheets upload.');
      return null;
    }

    return {
      spreadsheetId,
      credentials: {
        client_email: json.client_email,
        private_key: json.private_key,
      },
    };
  } catch (err: any) {
    console.error('❌ Failed to read/parse service_account.json:', err.message);
    return null;
  }
}

async function ensureSheetExists(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<void> {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = meta.data.sheets?.find(s => s.properties?.title === sheetTitle);
    if (existing) return;

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
  } catch (err: any) {
    console.error('⚠️ Failed to ensure sheet exists (will still attempt append):', err.message);
  }
}

export async function appendDefenseRows(rows: DefenseRow[]): Promise<void> {
  if (!rows.length) {
    console.log('ℹ️ No rows to upload to Google Sheets.');
    return;
  }

  const config = loadSheetsConfig();
  if (!config) return;

  try {
    console.log('📤 Uploading defense rows to Google Sheets...');

    const auth = new google.auth.GoogleAuth({
      credentials: config.credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const sheetTitle = `Defense_${todayIsoDate()}`;
    await ensureSheetExists(sheets, config.spreadsheetId, sheetTitle);

    const header = [
      'Team',
      'Opponent',
      'Game Time',
      'Position',
      'Value',
      'Player Page URL',
      'Date Scraped',
    ];

    const values = [
      header,
      ...rows.map(r => [
        r.team,
        r.opponent,
        r.gameTime,
        r.position,
        r.value,
        r.playerPageUrl,
        r.scrapedAt,
      ]),
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });

    console.log(`✅ Uploaded ${rows.length} defense rows to Google Sheets (${sheetTitle}).`);
  } catch (err: any) {
    console.error('❌ Error uploading defense rows to Google Sheets:', err.message);
    console.log('⚠️ Continuing without failing the scraper.');
  }
}


