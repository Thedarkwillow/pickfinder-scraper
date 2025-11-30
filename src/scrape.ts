import { Page, chromium } from 'playwright';
import * as path from 'path';
import {
  ScrapedData,
  PlayerInfo,
  LineMovement,
  DefenseRanking,
  TabContent,
  MatchupNotes,
  MatchupStat,
} from './types';
import { isSignedOut, handleGoogleLogin, saveCookies, loadCookies } from './googleAuth';
import { uploadToSheets } from './sheets';

/**
 * Main scraper module
 * Handles all data extraction from PickFinder player page
 */

const PICKFINDER_URL =
  'https://www.pickfinder.app/players/nhl/xk4sew4et1xgr8j?from=projections&stat=5&line=2.5&game=ztfgeq5fx67nerq';

/**
 * Wait for element with retry logic
 */
async function waitForElement(
  page: Page,
  selector: string,
  timeout: number = 10000,
  description: string = 'element'
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (error) {
    console.log(`⚠️ Element not found: ${description} (${selector})`);
    return false;
  }
}

/**
 * Extract player information from header section
 */
async function extractPlayerInfo(page: Page): Promise<PlayerInfo> {
  console.log('📋 Extracting player info...');
  
  const playerInfo: PlayerInfo = {
    name: null,
    team: null,
    position: null,
    height: null,
    opponent: null,
    gameTime: null,
    stat: null,
    line: null,
  };

  try {
    // Wait for page to be interactive
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Player name - try multiple selectors
    const nameSelectors = [
      'h1',
      'h2',
      '[data-testid="player-name"]',
      '.player-name',
      'header h1',
      '[class*="player"][class*="name"]',
      'h1[class*="text"]',
    ];

    for (const selector of nameSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && text.trim().length > 0 && text.trim().length < 100) {
            playerInfo.name = text.trim();
            console.log(`✅ Found player name: ${playerInfo.name}`);
            break;
          }
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    // Extract all text from header area for parsing
    const headerSelectors = ['header', '[class*="header"]', '[class*="player-header"]'];
    let headerText = '';
    
    for (const selector of headerSelectors) {
      try {
        const header = await page.$(selector);
        if (header) {
          headerText = (await header.textContent()) || '';
          break;
        }
      } catch (error) {
        // Continue
      }
    }

    // Position extraction
    const positionRegex = /\b(C|LW|RW|D|G|CENTER|LEFT WING|RIGHT WING|DEFENSE|GOALIE|DEFENSEMAN)\b/i;
    const positionMatch = headerText.match(positionRegex);
    if (positionMatch) {
      playerInfo.position = positionMatch[1].toUpperCase();
    }

    // Team and Opponent - look for "vs" or "@" patterns
    const vsPattern = /([A-Za-z]+)\s*(?:vs|@)\s*([A-Za-z]+)/i;
    const vsMatch = headerText.match(vsPattern) || page.url().match(vsPattern);
    if (vsMatch) {
      playerInfo.team = vsMatch[1].trim();
      playerInfo.opponent = vsMatch[2].trim();
    }

    // Also check URL for team info
    if (!playerInfo.team || !playerInfo.opponent) {
      // Try to extract from page elements
      const teamElements = await page.$$('[class*="team"], [class*="opponent"]');
      for (const el of teamElements) {
        const text = (await el.textContent()) || '';
        const match = text.match(/([A-Za-z]+)\s*(?:vs|@)\s*([A-Za-z]+)/i);
        if (match) {
          playerInfo.team = match[1].trim();
          playerInfo.opponent = match[2].trim();
          break;
        }
      }
    }

    // Stat being viewed (from URL or page)
    const statFromUrl = page.url().match(/stat=(\d+)/);
    const statSelectors = [
      '[class*="stat"]',
      '[class*="prop"]',
      'span:has-text("SOG"), span:has-text("Shots"), span:has-text("Goals"), span:has-text("Points")',
    ];

    for (const selector of statSelectors) {
      try {
        const statEl = await page.$(selector);
        if (statEl) {
          playerInfo.stat = (await statEl.textContent())?.trim() || null;
          if (playerInfo.stat) break;
        }
      } catch (error) {
        // Continue
      }
    }

    // Line value extraction
    const lineSelectors = [
      '[class*="line"]',
      '[class*="total"]',
      '[data-testid="line"]',
      'span:has-text("2.5"), span:has-text("1.5"), span:has-text("O/U")',
    ];

    for (const selector of lineSelectors) {
      try {
        const lineEl = await page.$(selector);
        if (lineEl) {
          const lineText = (await lineEl.textContent()) || '';
          const lineMatch = lineText.match(/(\d+\.?\d*)/);
          if (lineMatch) {
            playerInfo.line = parseFloat(lineMatch[1]);
            break;
          }
        }
      } catch (error) {
        // Continue
      }
    }

    // Also check URL for line
    if (!playerInfo.line) {
      const lineFromUrl = page.url().match(/line=(\d+\.?\d*)/);
      if (lineFromUrl) {
        playerInfo.line = parseFloat(lineFromUrl[1]);
      }
    }

    // Height extraction
    const heightSelectors = [
      '[class*="height"]',
      'text=/\\d+\'\\s*\\d+"/',
      'text=/\\d+\\s*cm/',
    ];

    for (const selector of heightSelectors) {
      try {
        const heightEl = await page.$(selector);
        if (heightEl) {
          playerInfo.height = (await heightEl.textContent())?.trim() || null;
          if (playerInfo.height) break;
        }
      } catch (error) {
        // Continue
      }
    }

    // Game time extraction
    const timeSelectors = [
      '[class*="time"]',
      '[class*="game-time"]',
      'text=/\\d+:\\d+\\s*(AM|PM)/',
      '[datetime]',
    ];

    for (const selector of timeSelectors) {
      try {
        const timeEl = await page.$(selector);
        if (timeEl) {
          playerInfo.gameTime = (await timeEl.textContent())?.trim() || null;
          if (playerInfo.gameTime) break;
        }
      } catch (error) {
        // Continue
      }
    }

    console.log('✅ Player info extraction completed');
  } catch (error) {
    console.error('❌ Error extracting player info:', error);
  }

  return playerInfo;
}

/**
 * Extract line movement data
 */
async function extractLineMovements(page: Page): Promise<LineMovement[]> {
  console.log('📊 Extracting line movements...');
  
  const movements: LineMovement[] = [];

  try {
    // Wait for line movement section to appear
    await page.waitForTimeout(2000);

    // Try multiple selectors for line movement table/section
    const tableSelectors = [
      'table',
      '[class*="table"]',
      '[class*="movement"]',
      '[class*="line-movement"]',
      '[class*="line"]',
      'tbody',
    ];

    for (const tableSelector of tableSelectors) {
      try {
        const tables = await page.$$(tableSelector);
        
        for (const table of tables) {
          const rows = await table.$$('tr');
          
          for (const row of rows) {
            const cells = await row.$$('td, th');
            
            if (cells.length >= 2) {
              const rowText = (await row.textContent()) || '';
              
              // Skip header rows
              if (rowText.toLowerCase().includes('line') && rowText.toLowerCase().includes('app')) {
                continue;
              }

              // Extract line value
              let line: string | null = null;
              let app: string | null = null;
              let emoji: string | null = null;
              let timestamp: string | null = null;

              // Get text from each cell
              const cellTexts: string[] = [];
              for (const cell of cells) {
                const text = (await cell.textContent())?.trim() || '';
                cellTexts.push(text);
                
                // Check for emoji (using Unicode property escapes or simple pattern)
                const emojiMatch = text.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u);
                if (emojiMatch) {
                  emoji = emojiMatch[0];
                }
              }

              // Try to parse line value (number with decimal)
              const lineMatch = rowText.match(/(\d+\.?\d*)/);
              if (lineMatch) {
                line = lineMatch[1];
              }

              // App name is usually in second or third cell
              if (cellTexts.length >= 2) {
                app = cellTexts[1] || cellTexts[0];
              }

              // Timestamp is usually last cell
              if (cellTexts.length >= 3) {
                timestamp = cellTexts[cellTexts.length - 1];
              }

              // Only add if we have at least line or app
              if (line || app) {
                movements.push({
                  line,
                  app,
                  emoji,
                  timestamp,
                });
              }
            }
          }

          if (movements.length > 0) {
            console.log(`✅ Found ${movements.length} line movements`);
            return movements;
          }
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    // Fallback: look for any list/div structure with line movements
    const listSelectors = ['[class*="line"]', '[class*="movement"]', 'ul', 'ol'];
    for (const selector of listSelectors) {
      try {
        const elements = await page.$$(selector);
        for (const el of elements) {
          const text = (await el.textContent()) || '';
          if (text.match(/\d+\.?\d*/) && text.length < 500) {
            // Might be line movement data
            const lines = text.split('\n').filter(l => l.trim());
            for (const line of lines) {
              const lineMatch = line.match(/(\d+\.?\d*)/);
              if (lineMatch) {
                movements.push({
                  line: lineMatch[1],
                  app: null,
                  emoji: null,
                  timestamp: null,
                });
              }
            }
            if (movements.length > 0) break;
          }
        }
        if (movements.length > 0) break;
      } catch (error) {
        // Continue
      }
    }
  } catch (error) {
    console.error('❌ Error extracting line movements:', error);
  }

  return movements;
}

/**
 * Extract defense rankings
 */
async function extractDefenseRankings(page: Page): Promise<DefenseRanking[]> {
  console.log('🛡️ Extracting defense rankings...');
  
  const rankings: DefenseRanking[] = [];

  try {
    // Wait a bit for content to load
    await page.waitForTimeout(2000);

    // Look for defense rankings section
    const defenseSelectors = [
      '[class*="defense"]',
      '[class*="rank"]',
      '[class*="ranking"]',
      'section:has-text("Defense")',
      'table:has-text("Rank")',
    ];

    for (const selector of defenseSelectors) {
      try {
        const sections = await page.$$(selector);
        
        for (const section of sections) {
          const sectionText = (await section.textContent()) || '';
          
          // Check if this looks like a defense ranking section
          if (!sectionText.toLowerCase().includes('rank') && !sectionText.toLowerCase().includes('defense')) {
            continue;
          }

          // Try table structure first
          const rows = await section.$$('tr, [class*="row"], div[class*="item"]');
          
          for (const row of rows) {
            const cells = await row.$$('td, th, span, div');
            
            if (cells.length >= 2) {
              const cellTexts: string[] = [];
              for (const cell of cells) {
                cellTexts.push((await cell.textContent())?.trim() || '');
              }

              // Look for rank pattern (e.g., "25th", "7th", "12th")
              let categoryName: string | null = null;
              let opponentRank: string | null = null;
              let allowedValue: string | null = null;

              // First cell is usually category name
              if (cellTexts[0]) {
                categoryName = cellTexts[0];
              }

              // Look for rank (number + "th", "st", "nd", "rd")
              const rankMatch = sectionText.match(/(\d+)(?:th|st|nd|rd)/i);
              if (rankMatch) {
                opponentRank = rankMatch[0];
              }

              // Look for allowed value (decimal number)
              const valueMatch = sectionText.match(/(\d+\.?\d*)/);
              if (valueMatch) {
                allowedValue = valueMatch[1];
              }

              // More structured parsing
              for (let i = 0; i < cellTexts.length; i++) {
                const text = cellTexts[i];
                
                // Check for rank
                if (!opponentRank) {
                  const match = text.match(/(\d+)(?:th|st|nd|rd)/i);
                  if (match) {
                    opponentRank = match[0];
                    continue;
                  }
                }

                // Check for decimal value
                if (!allowedValue) {
                  const match = text.match(/(\d+\.\d+)/);
                  if (match) {
                    allowedValue = match[1];
                    continue;
                  }
                }
              }

              if (categoryName || opponentRank || allowedValue) {
                rankings.push({
                  categoryName,
                  opponentRank,
                  allowedValue,
                });
              }
            }
          }

          // If we found rankings, return
          if (rankings.length > 0) {
            console.log(`✅ Found ${rankings.length} defense rankings`);
            return rankings;
          }
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    // Fallback: parse from text
    const bodyText = (await page.textContent('body')) || '';
    const rankingPattern = /([A-Za-z\s]+?)\s+(\d+)(?:th|st|nd|rd)\s+(\d+\.?\d*)/gi;
    let match;
    
    while ((match = rankingPattern.exec(bodyText)) !== null) {
      rankings.push({
        categoryName: match[1].trim(),
        opponentRank: match[2] + (match[0].match(/(th|st|nd|rd)/i)?.[0] || 'th'),
        allowedValue: match[3],
      });
    }
  } catch (error) {
    console.error('❌ Error extracting defense rankings:', error);
  }

  return rankings;
}

/**
 * Extract matchup notes with structured parsing
 */
async function extractMatchupNotes(page: Page): Promise<MatchupNotes[]> {
  console.log('📝 Extracting matchup notes...');
  
  const notes: MatchupNotes[] = [];

  try {
    // Look for notes section (usually in black/dark background)
    const notesSelectors = [
      '[class*="note"]',
      '[class*="matchup"]',
      '[class*="black"]',
      '[class*="dark"]',
      'section[style*="background"]',
      '[style*="background-color: black"]',
      '[style*="background-color: #000"]',
    ];

    let notesText = '';

    for (const selector of notesSelectors) {
      try {
        const elements = await page.$$(selector);
        
        for (const el of elements) {
          const text = (await el.textContent()) || '';
          
          // Look for matchup notes pattern
          if (text.match(/vs|@/i) && text.length > 50 && text.length < 5000) {
            notesText = text;
            break;
          }
        }
        
        if (notesText) break;
      } catch (error) {
        // Continue
      }
    }

    // Fallback: get all text and search for matchup patterns
    if (!notesText) {
      const bodyText = (await page.textContent('body')) || '';
      const lines = bodyText.split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        if (line.match(/vs|@/i) && line.length > 10 && line.length < 200) {
          notesText += line + '\n';
        }
      }
    }

    if (!notesText) {
      console.log('⚠️ No matchup notes found');
      return notes;
    }

    console.log('📄 Raw notes text:', notesText.substring(0, 200));

    // Parse structured format
    // Example format:
    // Tb vs fla
    // RW vs fla - 25p, 25 sog
    // LW vs fla - 31 fow
    // D vs fla - 32 bs

    const lines = notesText.split('\n').filter(l => l.trim());
    let currentMatchup: MatchupNotes | null = null;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Check if this is a matchup header (e.g., "Tb vs fla")
      const matchupMatch = trimmedLine.match(/^([A-Za-z]+)\s+(?:vs|@)\s+([A-Za-z]+)$/i);
      
      if (matchupMatch) {
        // Save previous matchup if exists
        if (currentMatchup && currentMatchup.stats.length > 0) {
          notes.push(currentMatchup);
        }
        
        // Start new matchup
        currentMatchup = {
          matchup: trimmedLine,
          stats: [],
        };
        continue;
      }

      // Parse stat line (e.g., "RW vs fla - 25p, 25 sog")
      if (currentMatchup) {
        const statMatch = trimmedLine.match(/^([A-Z]+)\s+(?:vs|@)\s+([a-z]+)\s*-\s*(.+)$/i);
        
        if (statMatch) {
          const position = statMatch[1];
          const opponent = statMatch[2];
          const statsText = statMatch[3];
          
          const stat: MatchupStat = {
            position,
            opponent,
          };

          // Parse individual stats (e.g., "25p", "25 sog", "31 fow", "32 bs")
          const statPatterns = [
            { pattern: /(\d+)\s*p\b/i, key: 'p' },
            { pattern: /(\d+)\s*sog\b/i, key: 'sog' },
            { pattern: /(\d+)\s*fow\b/i, key: 'fow' },
            { pattern: /(\d+)\s*bs\b/i, key: 'bs' },
            { pattern: /(\d+)\s*g\b/i, key: 'g' },
            { pattern: /(\d+)\s*a\b/i, key: 'a' },
          ];

          for (const { pattern, key } of statPatterns) {
            const match = statsText.match(pattern);
            if (match) {
              stat[key] = parseInt(match[1], 10);
            }
          }

          currentMatchup.stats.push(stat);
        }
      }
    }

    // Add last matchup
    if (currentMatchup && currentMatchup.stats.length > 0) {
      notes.push(currentMatchup);
    }

    console.log(`✅ Parsed ${notes.length} matchup note(s) with ${notes.reduce((sum, n) => sum + n.stats.length, 0)} total stats`);
  } catch (error) {
    console.error('❌ Error extracting matchup notes:', error);
  }

  return notes;
}

/**
 * Extract tab content (Matchup, Defense, Similar, Injuries)
 */
async function extractTabs(page: Page): Promise<TabContent[]> {
  console.log('📑 Extracting tab content...');
  
  const tabs: TabContent[] = [];
  const tabNames = ['Matchup', 'Defense', 'Similar', 'Injuries'];

  try {
    // Wait for tabs to load
    await page.waitForTimeout(2000);

    for (const tabName of tabNames) {
      try {
        // Try to click the tab
        const tabSelectors = [
          `button:has-text("${tabName}")`,
          `[role="tab"]:has-text("${tabName}")`,
          `a:has-text("${tabName}")`,
          `[class*="tab"]:has-text("${tabName}")`,
        ];

        let tabClicked = false;
        for (const selector of tabSelectors) {
          try {
            const tab = await page.$(selector);
            if (tab) {
              await tab.click();
              await page.waitForTimeout(1500); // Wait for content to load
              tabClicked = true;
              break;
            }
          } catch (error) {
            // Continue
          }
        }

        // Extract content from this tab
        const contentSelectors = [
          '[class*="content"]',
          '[class*="panel"]',
          '[role="tabpanel"]',
          'section',
          'div[class*="tab"]',
        ];

        let tabContent: any = {};
        let rawText = '';

        for (const selector of contentSelectors) {
          try {
            const elements = await page.$$(selector);
            
            for (const el of elements) {
              const text = (await el.textContent()) || '';
              
              // Check if this element is visible and contains relevant content
              const isVisible = await el.isVisible().catch(() => false);
              if (!isVisible) continue;

              // Skip if too short or too long
              if (text.length < 20 || text.length > 10000) continue;

              // Try to parse structured content
              const lines = text.split('\n').filter(l => l.trim());
              
              for (const line of lines) {
                // Look for key-value pairs
                if (line.includes(':') || line.includes('-')) {
                  const parts = line.split(/[:|-]/);
                  if (parts.length >= 2) {
                    const key = parts[0]?.trim();
                    const value = parts.slice(1).join(':').trim();
                    if (key && value) {
                      tabContent[key] = value;
                    }
                  }
                }
              }

              rawText = text;
              break;
            }
            
            if (rawText) break;
          } catch (error) {
            // Continue
          }
        }

        // If no structured content, store raw text
        if (Object.keys(tabContent).length === 0 && rawText) {
          tabContent = { rawText };
        }

        tabs.push({
          tabName,
          content: Object.keys(tabContent).length > 0 ? tabContent : { message: 'No content found' },
          rawText: rawText || undefined,
        });

        console.log(`✅ Extracted ${tabName} tab content`);
      } catch (error) {
        console.log(`⚠️ Error extracting ${tabName} tab:`, error);
        tabs.push({
          tabName,
          content: { error: 'Could not extract content' },
        });
      }
    }
  } catch (error) {
    console.error('❌ Error extracting tabs:', error);
  }

  return tabs;
}

/**
 * Main scraping function
 */
export async function scrapePickFinderPage(page: Page): Promise<ScrapedData> {
  console.log('🔍 Starting comprehensive PickFinder page scrape...\n');

  const scrapedData: ScrapedData = {
    playerInfo: {
      name: null,
      team: null,
      position: null,
      height: null,
      opponent: null,
      gameTime: null,
      stat: null,
      line: null,
    },
    lineMovements: [],
    tabs: [],
    defenseRankings: [],
    matchupNotes: [],
    timestamp: new Date().toISOString(),
  };

  try {
    // Wait for page to fully load
    console.log('⏳ Waiting for page to load...');
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Extract all data sections
    scrapedData.playerInfo = await extractPlayerInfo(page);
    scrapedData.lineMovements = await extractLineMovements(page);
    scrapedData.defenseRankings = await extractDefenseRankings(page);
    scrapedData.matchupNotes = await extractMatchupNotes(page);
    scrapedData.tabs = await extractTabs(page);

    console.log('\n✅ Scraping completed successfully!');
  } catch (error) {
    console.error('❌ Error during scraping:', error);
    throw error;
  }

  return scrapedData;
}

/**
 * Main execution function
 */
export async function runScraper(
  url: string = PICKFINDER_URL,
  email?: string,
  password?: string
): Promise<ScrapedData> {
  console.log('🚀 Starting PickFinder scraper...\n');

  let browser = null;
  let context = null;
  let page: Page | null = null;

  try {
    // Launch browser (non-headless) with stealth settings
    console.log('🌐 Launching browser with stealth mode...');
    browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080',
      ],
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: ['geolocation'],
      geolocation: { longitude: -74.006, latitude: 40.7128 },
      colorScheme: 'light',
    });

    page = await context.newPage();

    // Inject stealth scripts to hide automation
    await page.addInitScript(() => {
      // Hide webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      // Override the plugins property
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5] as any,
      });

      // Override the languages property
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Pass chrome check
      (window as any).chrome = {
        runtime: {},
      };
    });

    // Try to load saved cookies first
    const cookiesLoaded = await loadCookies(context);
    
    // Navigate to PickFinder
    console.log(`🔗 Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    // Check if signed out and handle login
    if (await isSignedOut(page)) {
      console.log('🔐 User is signed out, initiating Google login...');
      await handleGoogleLogin(page, email, password);
      
      // Save cookies after successful login
      await saveCookies(context);
      
      // Wait for redirect back to PickFinder after login
      console.log('⏳ Waiting for redirect to PickFinder after login...');
      let attempts = 0;
      while (attempts < 60) {
        await page.waitForTimeout(1000);
        const currentUrl = page.url();
        const pageText = await page.textContent('body').catch(() => '');
        
        // Check if we're on PickFinder player page (not Google auth pages)
        if (currentUrl.includes('pickfinder.app/players/') && 
            !currentUrl.includes('sign-in') &&
            !currentUrl.includes('accounts.google.com') &&
            !pageText.includes('2-Step Verification') &&
            !pageText.includes("Couldn't sign you in")) {
          console.log('✅ Successfully redirected to PickFinder player page');
          break;
        }
        
        attempts++;
        if (attempts % 10 === 0) {
          console.log(`⏳ Still waiting for PickFinder page... (${attempts}/60 seconds)`);
          if (pageText.includes('2-Step Verification') || pageText.includes('Verify it\'s you')) {
            console.log('📱 Please complete 2FA verification in the browser window');
          }
        }
      }
      
      // Final check - navigate directly if still not on right page
      const finalUrl = page.url();
      if (!finalUrl.includes('pickfinder.app/players/') || finalUrl.includes('sign-in')) {
        console.log('⚠️ Not on PickFinder player page, navigating directly...');
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(3000);
      }
    } else {
      console.log('✅ User is already authenticated');
    }

    // Wait for page to fully load after authentication
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Verify we're on the correct page before scraping
    const verifyUrl = page.url();
    const verifyText = await page.textContent('body').catch(() => '');
    if (verifyText.includes('2-Step Verification') || verifyText.includes("Couldn't sign you in")) {
      throw new Error('Still on Google authentication page. Please complete login manually in the browser window and try again.');
    }

    // Scrape the page
    const scrapedData = await scrapePickFinderPage(page);

    // Print summary
    console.log('\n📊 Scraping Summary:');
    console.log(`   Player: ${scrapedData.playerInfo.name || 'N/A'}`);
    console.log(`   Team: ${scrapedData.playerInfo.team || 'N/A'}`);
    console.log(`   Opponent: ${scrapedData.playerInfo.opponent || 'N/A'}`);
    console.log(`   Line: ${scrapedData.playerInfo.line || 'N/A'}`);
    console.log(`   Stat: ${scrapedData.playerInfo.stat || 'N/A'}`);
    console.log(`   Line Movements: ${scrapedData.lineMovements.length}`);
    console.log(`   Defense Rankings: ${scrapedData.defenseRankings.length}`);
    console.log(`   Matchup Notes: ${scrapedData.matchupNotes.length}`);
    console.log(`   Tabs: ${scrapedData.tabs.length}`);

    return scrapedData;
  } catch (error) {
    console.error('\n❌ Error in scraper:', error);
    
    // Take screenshot on error
    if (page) {
      try {
        const screenshotPath = path.join(process.cwd(), `error-screenshot-${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Error screenshot saved to: ${screenshotPath}`);
      } catch (screenshotError) {
        console.error('Could not take screenshot:', screenshotError);
      }
    }
    
    throw error;
  } finally {
    if (browser) {
      // Keep browser open for a moment to see results
      await new Promise(resolve => setTimeout(resolve, 5000));
      await browser.close();
    }
  }
}
