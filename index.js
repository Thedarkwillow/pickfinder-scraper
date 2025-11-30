const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { JWT } = require('@google-cloud/google-auth-library');
const { google } = require('googleapis');

puppeteer.use(StealthPlugin());

const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL;
const GOOGLE_PASSWORD = process.env.GOOGLE_PASSWORD;

const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

const COOKIES_PATH = path.join(__dirname, 'cookies.json');
const PICKFINDER_URL =
  'https://www.pickfinder.app/players/nhl/xk4sew4et1xgr8j?from=projections&stat=5&line=2.5&game=ztfgeq5fx67nerq';

async function loadCookies(page) {
  if (!fs.existsSync(COOKIES_PATH)) {
    return false;
  }
  try {
    const raw = await fsp.readFile(COOKIES_PATH, 'utf8');
    if (!raw.trim()) return false;
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || cookies.length === 0) return false;
    await page.setCookie(...cookies);
    return true;
  } catch (err) {
    console.error('Failed to load cookies, will perform login:', err.message);
    return false;
  }
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  await fsp.writeFile(COOKIES_PATH, JSON.stringify(cookies, null, 2), 'utf8');
}

async function googleLoginIfNeeded(page) {
  const hasCookies = await loadCookies(page);
  if (hasCookies) {
    console.log('Loaded existing cookies, skipping Google login.');
    return;
  }

  if (!GOOGLE_EMAIL || !GOOGLE_PASSWORD) {
    throw new Error(
      'GOOGLE_EMAIL and GOOGLE_PASSWORD environment variables must be set for initial login.'
    );
  }

  console.log('No cookies found, performing automated Google login...');

  await page.goto('https://accounts.google.com/', {
    waitUntil: 'networkidle2'
  });

  // Email step
  await page.waitForSelector('input[type="email"]', { visible: true });
  await page.type('input[type="email"]', GOOGLE_EMAIL, { delay: 50 });

  const identifierNextSelector = '#identifierNext button, #identifierNext';
  await page.waitForSelector(identifierNextSelector, { visible: true });
  await page.click(identifierNextSelector);

  // Password step
  await page.waitForSelector('input[type="password"]', {
    visible: true,
    timeout: 60000
  });
  await page.type('input[type="password"]', GOOGLE_PASSWORD, { delay: 50 });

  const passwordNextSelector = '#passwordNext button, #passwordNext';
  await page.waitForSelector(passwordNextSelector, { visible: true });
  await page.click(passwordNextSelector);

  // Wait for login to complete - often redirects to myaccount.google.com or other Google page
  await page.waitForNavigation({
    waitUntil: 'networkidle2',
    timeout: 120000
  });

  console.log('Google login successful, saving cookies...');
  await saveCookies(page);
}

async function waitForNetworkIdle(page, timeout = 15000, maxInflightRequests = 0) {
  let inflight = 0;
  let resolveIdle;

  const idlePromise = new Promise((resolve) => {
    resolveIdle = resolve;
  });

  const onRequest = () => {
    inflight++;
  };
  const onRequestFinished = () => {
    inflight = Math.max(0, inflight - 1);
    if (inflight <= maxInflightRequests) {
      resolveIdle();
    }
  };
  const onRequestFailed = () => {
    inflight = Math.max(0, inflight - 1);
    if (inflight <= maxInflightRequests) {
      resolveIdle();
    }
  };

  page.on('request', onRequest);
  page.on('requestfinished', onRequestFinished);
  page.on('requestfailed', onRequestFailed);

  try {
    await Promise.race([
      idlePromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Network idle timeout exceeded')), timeout)
      )
    ]);
  } finally {
    page.off('request', onRequest);
    page.off('requestfinished', onRequestFinished);
    page.off('requestfailed', onRequestFailed);
  }
}

async function scrapePickfinderData(page) {
  const data = await page.evaluate(() => {
    const text = (el) => (el ? el.textContent.trim() : '');

    // Try to infer key pieces of information from common patterns
    const player =
      text(document.querySelector('h1')) ||
      text(document.querySelector('[data-testid*="player-name"], [class*="PlayerName"]'));

    const stat =
      text(document.querySelector('[data-testid*="stat-name"], [class*="StatName"]')) ||
      text(
        document.querySelector(
          'header h2, [class*="ProjectionTitle"], [data-testid*="projection-title"]'
        )
      );

    const line =
      text(document.querySelector('[data-testid*="line"], [class*="LineValue"]')) ||
      text(document.querySelector('span[class*="line"], div[class*="line"]'));

    const projection =
      text(document.querySelector('[data-testid*="projection"], [class*="ProjectionValue"]')) ||
      text(
        document.querySelector(
          'span[class*="projection"], div[class*="projection"], strong[class*="projection"]'
        )
      );

    const over =
      text(document.querySelector('[data-testid*="over"], [class*="Over"] span')) ||
      text(
        Array.from(document.querySelectorAll('span, div')).find((el) =>
          /over/i.test(el.textContent) && /%/.test(el.textContent)
        )
      );

    const under =
      text(document.querySelector('[data-testid*="under"], [class*="Under"] span')) ||
      text(
        Array.from(document.querySelectorAll('span, div')).find((el) =>
          /under/i.test(el.textContent) && /%/.test(el.textContent)
        )
      );

    const opponent =
      text(
        document.querySelector(
          '[data-testid*="opponent"], [class*="Opponent"], [class*="Matchup"] span'
        )
      ) ||
      text(
        Array.from(document.querySelectorAll('span, div')).find((el) =>
          /vs\.|@/i.test(el.textContent)
        )
      );

    const game =
      text(
        document.querySelector(
          '[data-testid*="game-date"], [class*="GameDate"], time, [class*="Date"]'
        )
      ) ||
      text(
        Array.from(document.querySelectorAll('span, div, time')).find((el) =>
          /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(el.textContent)
        )
      );

    const rows = [];
    const tables = document.querySelectorAll('table');
    tables.forEach((table) => {
      const tableRows = Array.from(table.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.querySelectorAll('th,td')).map((cell) => text(cell))
      );
      if (tableRows.length) {
        rows.push(...tableRows);
      }
    });

    // Additional "valuable" fields – capture key-value style lists/cards if present
    const extra = {};
    document.querySelectorAll('dl').forEach((dl) => {
      const terms = dl.querySelectorAll('dt');
      const defs = dl.querySelectorAll('dd');
      terms.forEach((dt, i) => {
        const key = text(dt);
        const value = text(defs[i]);
        if (key && value) {
          extra[key] = value;
        }
      });
    });

    return {
      player: player || '',
      stat: stat || '',
      line: line || '',
      projection: projection || '',
      over: over || '',
      under: under || '',
      opponent: opponent || '',
      game: game || '',
      rows,
      extra
    };
  });

  console.log('Scraped data:', data);
  return data;
}

async function appendToGoogleSheets(scraped) {
  if (!GOOGLE_SHEETS_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error(
      'GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_PRIVATE_KEY must all be set.'
    );
  }

  const privateKey = GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const client = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth: client });

  // Change this sheet name if needed, or make it an env var if you prefer.
  const sheetName = 'Sheet1';

  const values = [
    [
      new Date().toISOString(),
      scraped.player,
      scraped.stat,
      scraped.line,
      scraped.projection,
      scraped.over,
      scraped.under,
      scraped.opponent,
      scraped.game,
      JSON.stringify(scraped.rows),
      scraped.extra ? JSON.stringify(scraped.extra) : ''
    ]
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values
    }
  });

  console.log('Appended row to Google Sheets.');
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  try {
    const [page] = await browser.pages();

    // Use a modern Chrome user agent to help avoid "browser not secure"
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/120.0.0.0 Safari/537.36'
    );

    await page.setViewport({ width: 1366, height: 768 });

    // Ensure Google is logged in (or cookies loaded)
    await googleLoginIfNeeded(page);

    // Navigate to PickFinder page
    console.log('Navigating to PickFinder URL...');
    await page.goto(PICKFINDER_URL, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });

    // Additional wait for dynamic requests to settle
    await waitForNetworkIdle(page, 15000, 0);

    // Scrape data
    const scraped = await scrapePickfinderData(page);

    // Export to Google Sheets
    await appendToGoogleSheets(scraped);

    // Update cookies after using Google-authenticated session
    await saveCookies(page);
  } catch (err) {
    console.error('Error in main workflow:', err);
  } finally {
    await browser.close();
  }
}

main();

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PICKFINDER_URL = 'https://www.pickfinder.app/players/nhl/xk4sew4et1xgr8j?from=projections&stat=5&line=2.5&game=ztfgeq5fx67nerq';
const COOKIES_FILE = path.join(__dirname, 'cookies.json');
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'service_account.json');
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
const WORKSHEET_NAME = 'Sheet1';

// Helper function to load cookies
function loadCookies() {
  try {
    if (!fs.existsSync(COOKIES_FILE)) {
      console.error('❌ cookies.json not found. Please export your Google login cookies.');
      process.exit(1);
    }
    
    const cookiesData = fs.readFileSync(COOKIES_FILE, 'utf-8');
    const cookies = JSON.parse(cookiesData);
    
    // Validate cookies format
    if (!Array.isArray(cookies) && typeof cookies === 'object') {
      // Convert to array format if needed
      return Array.isArray(cookies) ? cookies : [];
    }
    
    return Array.isArray(cookies) ? cookies : [];
  } catch (error) {
    console.error('❌ Error loading cookies.json:', error.message);
    process.exit(1);
  }
}

// Helper function to check if cookies are expired
function checkCookiesExpired(cookies) {
  const now = Date.now() / 1000;
  return cookies.some(cookie => {
    if (cookie.expires && cookie.expires < now) {
      return true;
    }
    return false;
  });
}

// Helper function to wait for element with timeout
async function waitForElement(page, selector, timeout = 10000, description = 'element') {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (error) {
    console.log(`⚠️ Element changed — update selector for: ${description} (${selector})`);
    return false;
  }
}

// Main scraping function
async function scrapePickFinder(page) {
  console.log('🔍 Starting page scrape...');
  
  const data = {
    player: null,
    team: null,
    opponent: null,
    prop: null,
    line: null,
    position: null,
    height: null,
    matchup: {},
    defense: {},
    similar: {},
    injuries: {},
    lineMovement: [],
    defenseRankings: [],
    notesTextBlock: null,
    timestamp: new Date().toISOString()
  };

  try {
    // Wait for page to load
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.waitForTimeout(2000);

    // A. Player Header Section
    console.log('📋 Extracting player header...');
    
    try {
      // Player name - try multiple selectors
      const nameSelectors = [
        'h1',
        '[data-testid="player-name"]',
        '.player-name',
        'header h1',
        'h1.text-lg, h1.text-xl, h1.text-2xl'
      ];
      
      for (const selector of nameSelectors) {
        const nameElement = await page.$(selector);
        if (nameElement) {
          data.player = await nameElement.textContent();
          data.player = data.player?.trim() || null;
          if (data.player) break;
        }
      }

      // Position, Height, Team, Opponent - look in header area
      const headerText = await page.textContent('header, .player-header, [class*="header"]').catch(() => null);
      
      // Try to extract position (common formats: C, LW, RW, D, G, etc.)
      const positionMatch = headerText?.match(/\b(C|LW|RW|D|G|CENTER|LEFT WING|RIGHT WING|DEFENSE|GOALIE)\b/i);
      if (positionMatch) {
        data.position = positionMatch[1].toUpperCase();
      }

      // Try to extract team and opponent from various locations
      const teamOpponentSelectors = [
        '[class*="team"]',
        '[class*="opponent"]',
        '.vs',
        '[class*="matchup"]'
      ];

      for (const selector of teamOpponentSelectors) {
        const elements = await page.$$(selector);
        for (const el of elements) {
          const text = await el.textContent();
          if (text && text.length < 50) {
            if (text.includes('vs') || text.includes('@')) {
              const parts = text.split(/vs|@/i);
              if (parts.length >= 2) {
                data.team = parts[0]?.trim() || null;
                data.opponent = parts[1]?.trim() || null;
              }
            }
          }
        }
        if (data.team && data.opponent) break;
      }

      // Line value
      const lineSelectors = [
        '[class*="line"]',
        '[class*="total"]',
        '[data-testid="line"]',
        'span:has-text("2.5"), span:has-text("O/U")'
      ];

      for (const selector of lineSelectors) {
        const lineElement = await page.$(selector);
        if (lineElement) {
          const lineText = await lineElement.textContent();
          const lineMatch = lineText?.match(/(\d+\.?\d*)/);
          if (lineMatch) {
            data.line = parseFloat(lineMatch[1]);
            break;
          }
        }
      }

      // Prop type
      const propSelectors = [
        '[class*="prop"]',
        '[data-testid="prop"]',
        'span:has-text("Goals"), span:has-text("Points"), span:has-text("Assists")'
      ];

      for (const selector of propSelectors) {
        const propElement = await page.$(selector);
        if (propElement) {
          data.prop = await propElement.textContent()?.trim() || null;
          if (data.prop) break;
        }
      }

      // Height
      const heightElement = await page.$('[class*="height"], [class*="6\'"], [class*="cm"]');
      if (heightElement) {
        data.height = await heightElement.textContent()?.trim() || null;
      }

    } catch (error) {
      console.log('⚠️ Element changed — update selector for player header.');
    }

    // B. Line Movement Table
    console.log('📊 Extracting line movement table...');
    
    try {
      const tableSelectors = [
        'table',
        '[class*="table"]',
        '[class*="movement"]',
        '[class*="line-movement"]'
      ];

      for (const tableSelector of tableSelectors) {
        const table = await page.$(tableSelector);
        if (table) {
          const rows = await table.$$('tr');
          for (const row of rows) {
            const cells = await row.$$('td, th');
            if (cells.length >= 3) {
              const line = await cells[0]?.textContent()?.trim();
              const app = await cells[1]?.textContent()?.trim();
              const time = await cells[2]?.textContent()?.trim();
              
              if (line || app || time) {
                data.lineMovement.push({
                  line: line || null,
                  app: app || null,
                  time: time || null
                });
              }
            }
          }
          if (data.lineMovement.length > 0) break;
        }
      }
    } catch (error) {
      console.log('⚠️ Element changed — update selector for line movement table.');
    }

    // C. Matchup Boxes - Extract 4 categories
    console.log('📦 Extracting matchup boxes...');
    
    const categoryNames = ['Matchup', 'Defense', 'Similar', 'Injuries'];
    const categoryKeys = ['matchup', 'defense', 'similar', 'injuries'];

    for (let i = 0; i < categoryNames.length; i++) {
      try {
        const categoryName = categoryNames[i];
        const categoryKey = categoryKeys[i];
        
        // Look for section with category name
        const sectionSelectors = [
          `[class*="${categoryKey.toLowerCase()}"]`,
          `[class*="${categoryName.toLowerCase()}"]`,
          `section:has-text("${categoryName}")`,
          `div:has-text("${categoryName}")`
        ];

        for (const selector of sectionSelectors) {
          const section = await page.$(selector);
          if (section) {
            // Extract all text/stats from this section
            const sectionText = await section.textContent();
            const stats = {};
            
            // Try to parse structured stats (key-value pairs)
            const lines = sectionText?.split('\n').filter(l => l.trim()) || [];
            for (const line of lines) {
              if (line.includes(':') || line.includes('-')) {
                const parts = line.split(/[:-\-]/);
                if (parts.length >= 2) {
                  const key = parts[0]?.trim();
                  const value = parts.slice(1).join(':').trim();
                  if (key && value) {
                    stats[key] = value;
                  }
                }
              }
            }
            
            data[categoryKey] = Object.keys(stats).length > 0 ? stats : { rawText: sectionText?.trim() || '' };
            break;
          }
        }

        // Fallback: if section not found, try to find any text containing category name
        if (!data[categoryKey] || Object.keys(data[categoryKey]).length === 0) {
          const pageText = await page.textContent();
          if (pageText?.includes(categoryName)) {
            data[categoryKey] = { rawText: 'Section found but could not parse structure' };
          }
        }
      } catch (error) {
        console.log(`⚠️ Element changed — update selector for ${categoryNames[i]} section.`);
        data[categoryKeys[i]] = {};
      }
    }

    // D. Defense Rankings Section
    console.log('🛡️ Extracting defense rankings...');
    
    try {
      const defenseRankingSelectors = [
        '[class*="defense-rank"]',
        '[class*="ranking"]',
        'table:has-text("Rank")',
        '[class*="rank"]'
      ];

      for (const selector of defenseRankingSelectors) {
        const section = await page.$(selector);
        if (section) {
          const rows = await section.$$('tr, [class*="row"]');
          for (const row of rows) {
            const cells = await row.$$('td, th, span, div');
            if (cells.length >= 2) {
              const statName = await cells[0]?.textContent()?.trim();
              const rankText = await cells[1]?.textContent()?.trim();
              const allowedText = await cells[2]?.textContent()?.trim();
              
              if (statName) {
                data.defenseRankings.push({
                  statName: statName || null,
                  opponentRank: rankText || null,
                  allowedValue: allowedText || null
                });
              }
            }
          }
          if (data.defenseRankings.length > 0) break;
        }
      }
    } catch (error) {
      console.log('⚠️ Element changed — update selector for defense rankings.');
    }

    // E. Extra Notes Section
    console.log('📝 Extracting notes section...');
    
    try {
      const notesSelectors = [
        '[class*="note"]',
        '[class*="extra"]',
        '[class*="additional"]',
        'section:has-text("Note")',
        '[class*="text-block"]'
      ];

      for (const selector of notesSelectors) {
        const notesElement = await page.$(selector);
        if (notesElement) {
          data.notesTextBlock = await notesElement.textContent()?.trim() || null;
          if (data.notesTextBlock) break;
        }
      }

      // Fallback: get all visible text if no specific notes section found
      if (!data.notesTextBlock) {
        const bodyText = await page.textContent('body');
        // Try to find a block of text that looks like notes
        const paragraphs = await page.$$('p');
        for (const p of paragraphs) {
          const text = await p.textContent();
          if (text && text.length > 100) {
            data.notesTextBlock = text.trim();
            break;
          }
        }
      }
    } catch (error) {
      console.log('⚠️ Element changed — update selector for notes section.');
    }

    // Try comprehensive fallback - get all page text for manual review
    if (!data.player || !data.team) {
      console.log('⚠️ Some critical data missing, attempting comprehensive scrape...');
      const allText = await page.textContent('body');
      console.log('📄 Full page text length:', allText?.length || 0);
    }

    console.log('✅ Scraping completed');
    return data;

  } catch (error) {
    console.error('❌ Error during scraping:', error.message);
    throw error;
  }
}

// Google Sheets upload function
async function uploadToSheets(data) {
  if (!SPREADSHEET_ID) {
    console.log('⚠️ SPREADSHEET_ID not set, skipping Google Sheets upload');
    return;
  }

  if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
    console.log('⚠️ service_account.json not found, skipping Google Sheets upload');
    return;
  }

  try {
    console.log('📤 Uploading to Google Sheets...');
    
    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf-8'));
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Prepare row data
    const rowData = [
      data.timestamp,
      data.player || '',
      data.team || '',
      data.opponent || '',
      data.line?.toString() || '',
      data.prop || '',
      JSON.stringify(data)
    ];

    // Append row to sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${WORKSHEET_NAME}!A:G`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowData]
      }
    });

    console.log('✅ Data uploaded to Google Sheets successfully');
  } catch (error) {
    console.error('❌ Error uploading to Google Sheets:', error.message);
    throw error;
  }
}

// Main execution function
async function main() {
  console.log('🚀 Starting PickFinder scraper...\n');

  // Load cookies
  console.log('🍪 Loading cookies...');
  const cookies = loadCookies();

  if (checkCookiesExpired(cookies)) {
    console.log('❌ Cookies appear to be expired.');
    console.log('Please export your Google login cookies as cookies.json and run again.');
    process.exit(1);
  }

  let browser = null;
  let page = null;

  try {
    // Launch browser
    console.log('🌐 Launching browser...');
    browser = await chromium.launch({
      headless: false, // Set to true for headless mode
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    page = await context.newPage();

    // Load cookies into browser context
    console.log('🍪 Injecting cookies...');
    
    // Format cookies for Playwright
    const formattedCookies = cookies.map(cookie => {
      // Ensure cookie has required fields
      return {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || '.pickfinder.app',
        path: cookie.path || '/',
        expires: cookie.expires || Math.floor(Date.now() / 1000) + 86400, // Default 24h
        httpOnly: cookie.httpOnly || false,
        secure: cookie.secure !== undefined ? cookie.secure : true,
        sameSite: cookie.sameSite || 'Lax'
      };
    });

    await context.addCookies(formattedCookies);

    // Navigate to PickFinder
    console.log(`🔗 Navigating to ${PICKFINDER_URL}...`);
    await page.goto(PICKFINDER_URL, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Wait a bit for page to fully render
    await page.waitForTimeout(3000);

    // Check if login is required
    const url = page.url();
    const pageContent = await page.textContent('body').catch(() => '');
    
    if (url.includes('accounts.google.com') || pageContent.includes('Sign in') || pageContent.includes('Sign in with Google')) {
      console.log('⚠️ Login required detected');
      console.log('Please export your Google login cookies as cookies.json and run again.');
      console.log('Current URL:', url);
      
      // Wait a bit to see if cookies work
      await page.waitForTimeout(5000);
      
      // Check again
      const newUrl = page.url();
      if (newUrl.includes('accounts.google.com')) {
        await browser.close();
        process.exit(1);
      }
    }

    // Wait for PickFinder page to load
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Scrape the page
    const scrapedData = await scrapePickFinder(page);

    // Print summary
    console.log('\n📊 Scraping Summary:');
    console.log(`   Player: ${scrapedData.player || 'N/A'}`);
    console.log(`   Team: ${scrapedData.team || 'N/A'}`);
    console.log(`   Opponent: ${scrapedData.opponent || 'N/A'}`);
    console.log(`   Line: ${scrapedData.line || 'N/A'}`);
    console.log(`   Prop: ${scrapedData.prop || 'N/A'}`);
    console.log(`   Line Movements: ${scrapedData.lineMovement.length}`);
    console.log(`   Defense Rankings: ${scrapedData.defenseRankings.length}`);

    // Save to local JSON file
    const outputFile = path.join(__dirname, `scrape_${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(scrapedData, null, 2));
    console.log(`\n💾 Data saved to: ${outputFile}`);

    // Upload to Google Sheets
    await uploadToSheets(scrapedData);

    console.log('\n✅ Scraping completed successfully!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

