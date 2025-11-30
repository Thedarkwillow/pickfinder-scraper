/**
 * Read defense data from Google Sheets
 */
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { DefenseData } from './types';

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
 * Find the most recent Defense sheet or a sheet named "DefenseStrength"
 */
async function findDefenseSheet(sheets: any, spreadsheetId: string): Promise<string | null> {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const allSheets = meta.data.sheets || [];

    // List all sheet names for debugging
    const allSheetNames = allSheets.map((s: any) => s.properties?.title || '').filter(Boolean);
    console.log(`📋 Available sheets: ${allSheetNames.join(', ')}`);

    // First, try to find a sheet named "DefenseStrength" (case-insensitive)
    const defenseStrengthSheet = allSheets.find(
      (s: any) => s.properties?.title?.toLowerCase() === 'defensestrength'
    );
    if (defenseStrengthSheet) {
      console.log(`✅ Found DefenseStrength sheet: ${defenseStrengthSheet.properties.title}`);
      return defenseStrengthSheet.properties.title;
    }

    // Try to find any sheet with "defense" in the name (case-insensitive)
    const defenseSheetsByName = allSheets.filter((s: any) => {
      const title = (s.properties?.title || '').toLowerCase();
      return title.includes('defense');
    });

    if (defenseSheetsByName.length > 0) {
      // Prefer sheets with date pattern
      const datedSheets = defenseSheetsByName
        .filter((s: any) => {
          const title = s.properties?.title || '';
          return /Defense_\d{4}-\d{2}-\d{2}/.test(title);
        })
        .map((s: any) => ({
          title: s.properties.title,
          date: s.properties.title.replace(/.*Defense_(\d{4}-\d{2}-\d{2}).*/, '$1'),
        }))
        .sort((a: any, b: any) => b.date.localeCompare(a.date)); // Most recent first

      if (datedSheets.length > 0) {
        console.log(`✅ Found dated defense sheet: ${datedSheets[0].title}`);
        return datedSheets[0].title;
      }

      // Otherwise, use the first sheet with "defense" in the name
      const firstDefenseSheet = defenseSheetsByName[0].properties.title;
      console.log(`✅ Found defense sheet: ${firstDefenseSheet}`);
      return firstDefenseSheet;
    }

    // Otherwise, find the most recent Defense_YYYY-MM-DD sheet
    const defenseSheets = allSheets
      .filter((s: any) => {
        const title = s.properties?.title || '';
        return title.startsWith('Defense_') && /Defense_\d{4}-\d{2}-\d{2}/.test(title);
      })
      .map((s: any) => ({
        title: s.properties.title,
        date: s.properties.title.replace('Defense_', ''),
      }))
      .sort((a: any, b: any) => b.date.localeCompare(a.date)); // Most recent first

    if (defenseSheets.length > 0) {
      console.log(`✅ Found dated defense sheet: ${defenseSheets[0].title}`);
      return defenseSheets[0].title;
    }

    console.warn('⚠️ No defense sheet found. Available sheets:', allSheetNames.join(', '));
    return null;
  } catch (error: any) {
    console.error('Error finding defense sheet:', error.message);
    return null;
  }
}

/**
 * Read defense data from Google Sheets
 * Returns array of DefenseData objects
 */
export async function readDefenseDataFromSheets(): Promise<DefenseData[]> {
  const { sheets, spreadsheetId } = getSheetsClient();

  // Find the defense sheet
  const sheetName = await findDefenseSheet(sheets, spreadsheetId);
  if (!sheetName) {
    console.warn('⚠️ No Defense sheet found. Looking for "DefenseStrength" or "Defense_YYYY-MM-DD"');
    return [];
  }

  console.log(`📖 Reading defense data from sheet: ${sheetName}`);

  try {
    // First, check the header row to understand the structure
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:Z1`,
    });
    
    const headers = (headerResponse.data.values || [])[0] || [];
    console.log(`📋 Sheet headers: ${headers.join(' | ')}`);
    
    // Try to find column indices dynamically
    const teamCol = headers.findIndex((h: string) => 
      h && (h.toLowerCase().includes('team') || h.toLowerCase() === 'team')
    );
    const opponentCol = headers.findIndex((h: string) => 
      h && (h.toLowerCase().includes('opponent') || h.toLowerCase() === 'opponent')
    );
    const positionCol = headers.findIndex((h: string) => 
      h && (h.toLowerCase().includes('position') || h.toLowerCase() === 'position' || h.toLowerCase().includes('stat'))
    );
    const rankCol = headers.findIndex((h: string) => 
      h && (h.toLowerCase().includes('rank') || h.toLowerCase() === 'rank')
    );
    const gameTimeCol = headers.findIndex((h: string) => 
      h && (h.toLowerCase().includes('time') || h.toLowerCase().includes('game'))
    );

    // If we found columns by header, use them; otherwise fall back to A-E
    let teamIdx = teamCol >= 0 ? teamCol : 0;
    let opponentIdx = opponentCol >= 0 ? opponentCol : 1;
    let gameTimeIdx = gameTimeCol >= 0 ? gameTimeCol : 2;
    let positionIdx = positionCol >= 0 ? positionCol : 3;
    let rankIdx = rankCol >= 0 ? rankCol : 4;

    console.log(`📊 Column mapping: Team=${teamIdx}, Opponent=${opponentIdx}, GameTime=${gameTimeIdx}, Position=${positionIdx}, Rank=${rankIdx}`);

    // Read all data from the sheet (skip header row)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:Z`, // Read more columns to be safe
    });

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('ℹ️ No defense data found in sheet (no rows after header)');
      return [];
    }

    console.log(`📊 Found ${rows.length} rows in defense sheet`);

    const defenseData: DefenseData[] = rows
      .map((row: any[], index: number) => {
        // Ensure we have enough columns
        if (row.length <= Math.max(teamIdx, opponentIdx, positionIdx, rankIdx)) {
          return null;
        }

        const team = (row[teamIdx] || '').trim();
        const opponent = (row[opponentIdx] || '').trim();
        const position = (row[positionIdx] || '').trim(); // This is actually the stat category
        const rank = (row[rankIdx] || '').trim();
        const gameTime = (row[gameTimeIdx] || '').trim();

        // Skip rows with missing essential data
        if (!team || !opponent || !position || !rank) {
          if (index < 5) { // Only log first few skipped rows
            console.log(`⚠️ Skipping row ${index + 2}: team="${team}", opponent="${opponent}", position="${position}", rank="${rank}"`);
          }
          return null;
        }

        return {
          team,
          opponent,
          gameTime,
          position, // Stat category like "Shots on Goal", "Assists", etc.
          rank, // Defense strength rank like "24th", "25th", etc.
        };
      })
      .filter((item: DefenseData | null): item is DefenseData => item !== null);

    console.log(`✅ Read ${defenseData.length} defense data entries`);
    
    // Show sample data for debugging
    if (defenseData.length > 0) {
      const sample = defenseData.slice(0, 3);
      console.log(`📊 Sample defense data:`);
      sample.forEach((d, i) => {
        console.log(`   ${i + 1}. Team: ${d.team}, Opponent: ${d.opponent}, Position: ${d.position}, Rank: ${d.rank}`);
      });
    }
    
    return defenseData;
  } catch (error: any) {
    console.error('❌ Error reading defense data from sheets:', error.message);
    console.error(error.stack);
    return [];
  }
}

