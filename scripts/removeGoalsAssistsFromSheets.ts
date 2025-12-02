/**
 * Script to remove all rows containing "Goals" or "Assists" from Google Sheets
 */
import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'service_account.json');

/**
 * Get Google Sheets client
 */
function getSheetsClient() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(`service_account.json not found at ${SERVICE_ACCOUNT_PATH}`);
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID env var is not set');
  }

  const raw = fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8');
  const creds = JSON.parse(raw);

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, spreadsheetId };
}

/**
 * Remove rows containing Goals or Assists from a sheet
 */
async function removeGoalsAssistsFromSheet(
  sheets: any,
  spreadsheetId: string,
  sheetName: string
): Promise<number> {
  try {
    // Get all data from the sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log(`   ℹ️ Sheet ${sheetName} is empty`);
      return 0;
    }

    // Find the Stat column index (usually column E, index 4)
    const header = rows[0];
    const statColumnIndex = header.findIndex((col: string) => 
      col && col.toLowerCase().includes('stat')
    );

    if (statColumnIndex === -1) {
      console.log(`   ⚠️ Could not find Stat column in ${sheetName}, skipping`);
      return 0;
    }

    // Filter out rows where Stat column contains "Goals" or "Assists"
    const rowsToKeep: any[] = [header]; // Keep header
    const rowsToDelete: number[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const statValue = row[statColumnIndex] || '';
      const statLower = statValue.toString().toLowerCase();

      if (statLower.includes('goal') && !statLower.includes('allowed') && !statLower.includes('goalie')) {
        // It's "Goals" (not "Goals Allowed" or "Goalie Saves")
        rowsToDelete.push(i + 1); // +1 because Sheets uses 1-based indexing
      } else if (statLower.includes('assist')) {
        // It's "Assists"
        rowsToDelete.push(i + 1);
      } else {
        rowsToKeep.push(row);
      }
    }

    if (rowsToDelete.length === 0) {
      console.log(`   ✅ No Goals/Assists rows found in ${sheetName}`);
      return 0;
    }

    // Instead of deleting rows (which uses many API calls), rewrite the sheet with only rows to keep
    // This uses only 1 write request instead of many delete requests
    console.log(`   📝 Rewriting ${sheetName} with ${rowsToKeep.length - 1} rows (removing ${rowsToDelete.length} Goals/Assists rows)...`);
    
    // Clear the sheet first
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    // Write back only the rows we want to keep
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: rowsToKeep,
      },
    });

    console.log(`   ✅ Removed ${rowsToDelete.length} Goals/Assists rows from ${sheetName}`);
    return rowsToDelete.length;
  } catch (error: any) {
    console.error(`   ❌ Error processing ${sheetName}:`, error.message);
    return 0;
  }
}

/**
 * Get sheet ID by name
 */
async function getSheetId(sheets: any, spreadsheetId: string, sheetName: string): Promise<number> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find((s: any) => s.properties?.title === sheetName);
  if (!sheet) {
    throw new Error(`Sheet ${sheetName} not found`);
  }
  return sheet.properties.sheetId;
}

/**
 * Main function
 */
async function main() {
  console.log('🧹 Removing Goals and Assists from Google Sheets...\n');

  const { sheets, spreadsheetId } = getSheetsClient();

  // Sheets to clean
  const sheetsToClean = [
    'PrizePicks_Props',
    'Underdog_Props',
  ];

  let totalRemoved = 0;

  for (const sheetName of sheetsToClean) {
    try {
      const removed = await removeGoalsAssistsFromSheet(sheets, spreadsheetId, sheetName);
      totalRemoved += removed;
    } catch (error: any) {
      console.error(`❌ Error cleaning ${sheetName}:`, error.message);
    }
  }

  console.log(`\n✅ Cleanup complete! Removed ${totalRemoved} total rows containing Goals/Assists`);
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

