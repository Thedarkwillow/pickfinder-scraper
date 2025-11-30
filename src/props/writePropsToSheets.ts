/**
 * Write merged props to Google Sheets
 */
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { MergedProp } from './types';

/**
 * Format game time for Google Sheets so it displays properly
 * Converts time strings to a format Google Sheets recognizes as time
 */
function formatGameTimeForSheets(gameTime?: string): string {
  if (!gameTime || !gameTime.trim()) {
    return '';
  }

  const timeStr = gameTime.trim();

  try {
    // If it's already in ISO format or date format, try to parse and format
    if (timeStr.includes('T') || timeStr.includes('-')) {
      const date = new Date(timeStr);
      if (!isNaN(date.getTime())) {
        // Format as time: "HH:MM AM/PM" for display
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`;
      }
    }

    // Try to parse time formats like "7:00 PM" or "19:00"
    const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3]?.toUpperCase();

      if (period === 'PM' && hours !== 12) {
        hours += 12;
      } else if (period === 'AM' && hours === 12) {
        hours = 0;
      }

      // Format as time value for Google Sheets: "HH:MM:SS" format
      // Google Sheets will recognize this as a time when using USER_ENTERED
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    }

    // If we can't parse it, return as-is (might already be formatted)
    return timeStr;
  } catch (e) {
    // If parsing fails, return as-is
    return timeStr;
  }
}

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
 * Write PrizePicks props to Google Sheets
 */
export async function writePrizePicksPropsToSheets(props: MergedProp[]): Promise<void> {
  if (!props.length) {
    console.log('ℹ️ No PrizePicks props to write');
    return;
  }

  const { sheets, spreadsheetId } = getSheetsClient();
  const sheetName = 'PrizePicks_Props';

  // Create or clear the sheet
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = meta.data.sheets?.find((s: any) => s.properties?.title === sheetName);

    if (existing) {
      // Clear existing data
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A:Z`,
      });
      console.log(`🗑️ Cleared existing ${sheetName} sheet`);
    } else {
      // Create new sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
      });
      console.log(`📝 Created new sheet: ${sheetName}`);
    }
  } catch (error: any) {
    console.error(`⚠️ Error managing sheet ${sheetName}:`, error.message);
    throw error;
  }

  // Sort props by game time (only for Google Sheets output)
  const sortedProps = sortPropsByGameTime(props);
  if (props.length > 0 && props[0].gameTime) {
    console.log(`📅 Sorted ${sortedProps.length} PrizePicks props by game start time for Google Sheets`);
  }

  // Write header
  const header = ['Player', 'Team', 'Opponent', 'Position', 'Stat', 'Line', 'Defense Strength', 'Projection ID', 'Game Time'];
  
  // Write data
  const values = [
    header,
    ...sortedProps.map((prop) => [
      prop.player,
      prop.team,
      prop.opponent,
      prop.position,
      prop.stat,
      prop.line.toString(),
      prop.defenseStrength || 'NA',
      prop.projectionId || '',
      formatGameTimeForSheets(prop.gameTime),
    ]),
  ];

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    });
    console.log(`✅ Wrote ${props.length} PrizePicks props to ${sheetName}`);
  } catch (error: any) {
    console.error(`❌ Error writing to ${sheetName}:`, error.message);
    throw error;
  }
}

/**
 * Parse game time string to a sortable timestamp
 */
function parseGameTime(gameTime?: string): number {
  if (!gameTime) return Infinity; // Put props without time at the end
  
  try {
    // Try to parse ISO format
    if (gameTime.includes('T') || gameTime.includes('-')) {
      const date = new Date(gameTime);
      if (!isNaN(date.getTime())) {
        return date.getTime();
      }
    }
    
    // Try to parse time formats like "7:00 PM" or "19:00"
    const timeMatch = gameTime.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3]?.toUpperCase();
      
      if (period === 'PM' && hours !== 12) {
        hours += 12;
      } else if (period === 'AM' && hours === 12) {
        hours = 0;
      }
      
      // Use today's date with the parsed time
      const today = new Date();
      const gameDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);
      return gameDate.getTime();
    }
    
    // If we can't parse it, try direct Date parsing
    const date = new Date(gameTime);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  } catch (e) {
    // Parsing failed
  }
  
  return Infinity; // Put unparseable times at the end
}

/**
 * Sort props by game start time
 */
function sortPropsByGameTime(props: MergedProp[]): MergedProp[] {
  return [...props].sort((a, b) => {
    const timeA = parseGameTime(a.gameTime);
    const timeB = parseGameTime(b.gameTime);
    return timeA - timeB; // Sort ascending (earliest games first)
  });
}

/**
 * Write Underdog props to Google Sheets
 */
export async function writeUnderdogPropsToSheets(props: MergedProp[]): Promise<void> {
  if (!props.length) {
    console.log('ℹ️ No Underdog props to write');
    return;
  }

  const { sheets, spreadsheetId } = getSheetsClient();
  const sheetName = 'Underdog_Props';

  // Create or clear the sheet
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = meta.data.sheets?.find((s: any) => s.properties?.title === sheetName);

    if (existing) {
      // Clear existing data
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A:Z`,
      });
      console.log(`🗑️ Cleared existing ${sheetName} sheet`);
    } else {
      // Create new sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
      });
      console.log(`📝 Created new sheet: ${sheetName}`);
    }
  } catch (error: any) {
    console.error(`⚠️ Error managing sheet ${sheetName}:`, error.message);
    throw error;
  }

  // Sort props by game time (only for Google Sheets output)
  const sortedProps = sortPropsByGameTime(props);
  console.log(`📅 Sorted ${sortedProps.length} Underdog props by game start time for Google Sheets`);

  // Write header - Position is now in its own column
  const header = ['Player', 'Team', 'Opponent', 'Position', 'Stat', 'Line', 'Defense Strength', 'Game Time'];
  
  // Write data
  const values = [
    header,
    ...sortedProps.map((prop) => [
      prop.player,
      prop.team,
      prop.opponent,
      prop.position || '', // Player position (LW, RW, C, D, G) in its own column
      prop.stat,
      prop.line.toString(),
      prop.defenseStrength || 'NA',
      formatGameTimeForSheets(prop.gameTime),
    ]),
  ];

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    });
    console.log(`✅ Wrote ${props.length} Underdog props to ${sheetName}`);
  } catch (error: any) {
    console.error(`❌ Error writing to ${sheetName}:`, error.message);
    throw error;
  }
}

