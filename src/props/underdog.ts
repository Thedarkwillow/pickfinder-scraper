/**
 * Scrape Underdog Fantasy player props using Puppeteer
 * Replaces the API-based scraper that was getting 422 circuit breaker errors
 */
import puppeteer, { Browser, Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import * as readline from 'readline';
import { UnderdogProp } from './types';

const UNDERDOG_URL = 'https://underdogfantasy.com/pick-em';
const COOKIES_PATH = path.join(process.cwd(), 'cookies', 'underdog.json');

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDateString(): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Normalize team names to match defense dataset
 */
export function normalizeTeamName(teamName: string): string {
  const teamMap: Record<string, string> = {
    'ARI': 'ARI',
    'ATL': 'WPG', // Old Thrashers
    'BOS': 'BOS',
    'BUF': 'BUF',
    'CGY': 'CGY',
    'CAR': 'CAR',
    'CHI': 'CHI',
    'COL': 'COL',
    'CBJ': 'CBJ',
    'DAL': 'DAL',
    'DET': 'DET',
    'EDM': 'EDM',
    'FLA': 'FLA',
    'LAK': 'LAK',
    'LA': 'LAK',
    'MIN': 'MIN',
    'MTL': 'MTL',
    'NSH': 'NSH',
    'NJD': 'NJD',
    'NJ': 'NJD',
    'NYI': 'NYI',
    'NYR': 'NYR',
    'OTT': 'OTT',
    'PHI': 'PHI',
    'PIT': 'PIT',
    'SJS': 'SJS',
    'SJ': 'SJS',
    'SEA': 'SEA',
    'STL': 'STL',
    'TBL': 'TBL',
    'TB': 'TBL',
    'TOR': 'TOR',
    'UTA': 'UTA',
    'VAN': 'VAN',
    'VGK': 'VGK',
    'VEG': 'VGK',
    'WSH': 'WSH',
    'WAS': 'WSH',
    'WPG': 'WPG',
    'WIN': 'WPG',
  };

  const upper = teamName.toUpperCase().trim();
  return teamMap[upper] || upper;
}

/**
 * Map Underdog stat type to our stat categories
 */
function normalizeStatType(statType: string): string {
  const statMap: Record<string, string> = {
    'Points': 'Points',
    'Pts': 'Points',
    'Goals': 'Goals',
    'Assists': 'Assists',
    'Asts': 'Assists',
    'Shots on Goal': 'Shots on Goal',
    'SOG': 'Shots on Goal',
    'Shots': 'Shots on Goal',
    'Hits': 'Hits',
    'Blocked Shots': 'Blocked Shots',
    'Blocks': 'Blocked Shots',
    'Time On Ice': 'Time On Ice',
    'TOI': 'Time On Ice',
    'Faceoffs Won': 'Faceoffs Won',
    'FOW': 'Faceoffs Won',
    'Faceoffs Lost': 'Faceoffs Lost',
    'FOL': 'Faceoffs Lost',
    'Faceoffs': 'Faceoffs',
    'FO': 'Faceoffs',
    'Goals Allowed': 'Goals Allowed',
    'GA': 'Goals Allowed',
    'Saves': 'Goalie Saves',
    'SV': 'Goalie Saves',
    'Goalie Saves': 'Goalie Saves',
    'Fantasy Score': 'Points', // Underdog might use "Fantasy Score"
  };

  const normalized = statType.trim();
  return statMap[normalized] || normalized;
}

/**
 * Extract team abbreviation from text
 */
function extractTeamFromText(text: string): string {
  // NHL team abbreviations (2-4 letters)
  const nhlTeams = [
    'ARI', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET',
    'EDM', 'FLA', 'LAK', 'LA', 'MIN', 'MTL', 'NSH', 'NJD', 'NJ', 'NYI', 'NYR',
    'OTT', 'PHI', 'PIT', 'SJS', 'SJ', 'SEA', 'STL', 'TBL', 'TB', 'TOR',
    'UTA', 'VAN', 'VGK', 'VEG', 'WSH', 'WAS', 'WPG', 'WIN'
  ];

  const upperText = text.toUpperCase();
  
  // Look for team abbreviations in the text
  for (const team of nhlTeams) {
    // Match whole word boundaries
    const regex = new RegExp(`\\b${team}\\b`);
    if (regex.test(upperText)) {
      return normalizeTeamName(team);
    }
  }

  return '';
}

/**
 * Extract opponent team from text
 */
function extractOpponentFromText(text: string, playerTeam: string): string {
  // Look for patterns like "vs", "@", or team abbreviations
  const vsPattern = /(?:vs|@|v\.?)\s*([A-Z]{2,4})/i;
  const match = text.match(vsPattern);
  
  if (match && match[1]) {
    const opponent = normalizeTeamName(match[1]);
    // Make sure it's not the same as player team
    if (opponent && opponent !== playerTeam) {
      return opponent;
    }
  }

  // Try to find all team abbreviations and return the one that's not the player team
  const nhlTeams = [
    'ARI', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET',
    'EDM', 'FLA', 'LAK', 'LA', 'MIN', 'MTL', 'NSH', 'NJD', 'NJ', 'NYI', 'NYR',
    'OTT', 'PHI', 'PIT', 'SJS', 'SJ', 'SEA', 'STL', 'TBL', 'TB', 'TOR',
    'UTA', 'VAN', 'VGK', 'VEG', 'WSH', 'WAS', 'WPG', 'WIN'
  ];

  const upperText = text.toUpperCase();
  const normalizedPlayerTeam = normalizeTeamName(playerTeam).toUpperCase();

  for (const team of nhlTeams) {
    const regex = new RegExp(`\\b${team}\\b`);
    if (regex.test(upperText)) {
      const normalized = normalizeTeamName(team).toUpperCase();
      if (normalized !== normalizedPlayerTeam) {
        return normalizeTeamName(team);
      }
    }
  }

  return '';
}

/**
 * Load cookies from file
 */
function loadCookies(): any[] | null {
  try {
    if (fs.existsSync(COOKIES_PATH)) {
      const cookiesData = fs.readFileSync(COOKIES_PATH, 'utf-8');
      const cookies = JSON.parse(cookiesData);
      // Check if cookies are expired (older than 7 days)
      if (Array.isArray(cookies) && cookies.length > 0) {
        return cookies;
      }
    }
  } catch (error: any) {
    console.log(`⚠️ Could not load cookies: ${error.message}`);
  }
  return null;
}

/**
 * Save cookies to file
 */
function saveCookies(cookies: any[]): void {
  try {
    const cookiesDir = path.dirname(COOKIES_PATH);
    if (!fs.existsSync(cookiesDir)) {
      fs.mkdirSync(cookiesDir, { recursive: true });
    }
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log(`✅ Saved cookies to ${COOKIES_PATH}`);
  } catch (error: any) {
    console.warn(`⚠️ Could not save cookies: ${error.message}`);
  }
}

/**
 * Wait for user to press ENTER
 */
function waitForUserInput(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Please log in to Underdog in the opened browser window. Press ENTER when finished.\n', () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Check if user is logged in (look for logout button, user menu, etc.)
 */
async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    // Wait a bit for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check URL first - if we're on login page, definitely not logged in
    const url = page.url();
    if (url.includes('/login') || url.includes('/sign-in') || url.includes('/signin')) {
      // But check if login form is visible (not just loading)
      const hasLoginForm = await page.$('input[type="email"], input[name="email"], input[type="text"], form');
      if (hasLoginForm) {
        return false;
      }
      // If no login form, might still be loading
    }

    // Check for common logged-in indicators
    const loggedInSelectors = [
      'button[data-testid="logout"]',
      '[data-testid="user-menu"]',
      'button:has-text("Logout")',
      'button:has-text("Log out")',
      '[class*="user-menu"]',
      '[class*="account"]',
      '[class*="profile"]',
    ];

    for (const selector of loggedInSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          return true;
        }
      } catch {
        // Continue
      }
    }

    // If we're on the pick-em page and see props, we're probably logged in
    const hasProps = await page.$('[data-testid*="player"], [class*="player-card"], [class*="prop-card"], [class*="Card"]');
    if (hasProps) {
      return true;
    }

    // Check if we're past the login page (on pick-em or other pages)
    if (!url.includes('/login') && !url.includes('/sign-in') && !url.includes('/signin')) {
      // If we're not on login page and page has loaded, assume logged in
      const bodyText = await page.evaluate(() => {
        // @ts-ignore - browser context
        return document.body.innerText || '';
      });
      if (bodyText.length > 100) {
        // Page has content, likely logged in
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Handle automatic login using credentials from environment variables
 */
async function attemptAutoLogin(page: Page): Promise<boolean> {
  const email = process.env.UNDERDOG_EMAIL;
  const password = process.env.UNDERDOG_PASSWORD;

  if (!email || !password) {
    return false;
  }

  console.log('🔐 Attempting automatic login...');

  try {
    // Wait for email input field
    await page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="Email" i]', {
      timeout: 10000,
      visible: true
    });

    // Fill in email
    const emailSelector = 'input[type="email"], input[name="email"], input[placeholder*="Email" i]';
    await page.click(emailSelector);
    await page.type(emailSelector, email, { delay: 50 });
    console.log('   ✅ Email entered');

    // Wait for password field
    await page.waitForSelector('input[type="password"]', {
      timeout: 5000,
      visible: true
    });

    // Fill in password
    await page.click('input[type="password"]');
    await page.type('input[type="password"]', password, { delay: 50 });
    console.log('   ✅ Password entered');

    // Wait a moment before clicking login
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click login button - try multiple selectors
    let loginButton = null;
    
    // Try different button selectors
    const buttonSelectors = [
      'button[type="submit"]',
      'button',
      'input[type="submit"]',
    ];
    
    for (const selector of buttonSelectors) {
      const buttons = await page.$$(selector);
      for (const btn of buttons) {
        const text = await page.evaluate((el) => el.textContent || '', btn);
        if (text.includes('Log in') || text.includes('Sign in') || text.includes('Login')) {
          loginButton = btn;
          break;
        }
      }
      if (loginButton) break;
    }
    
    if (loginButton) {
      await loginButton.click();
      console.log('   ✅ Login button clicked');
    } else {
      // Try pressing Enter as fallback
      await page.keyboard.press('Enter');
      console.log('   ✅ Pressed Enter to submit');
    }

    // Wait for login to complete (either redirect or form disappears)
    console.log('   ⏳ Waiting for login to complete...');
    
    // Wait longer and check for redirects or errors
    let loginSuccessful = false;
    const maxWaitTime = 15000; // 15 seconds
    const checkInterval = 1000; // Check every second
    let waited = 0;
    
    while (waited < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
      
      // Check current URL
      const currentUrl = page.url();
      
      // If we're no longer on login page, login likely succeeded
      if (!currentUrl.includes('/login') && !currentUrl.includes('/sign-in') && !currentUrl.includes('/signin')) {
        console.log(`   ✅ Redirected to: ${currentUrl}`);
        loginSuccessful = true;
        break;
      }
      
      // Check for error messages
      const hasError = await page.evaluate(() => {
        // @ts-ignore - browser context
        const body = (window as any).document.body;
        const text = body.innerText || '';
        return text.includes('Invalid') || 
               text.includes('incorrect') || 
               text.includes('error') ||
               text.includes('try again');
      });
      
      if (hasError) {
        console.log('   ⚠️ Error message detected on page');
        break;
      }
      
      // Check if we're logged in (even if still on login page, might be processing)
      const isLoggedInNow = await isLoggedIn(page);
      if (isLoggedInNow) {
        loginSuccessful = true;
        break;
      }
    }
    
    // Final check
    if (!loginSuccessful) {
      const finalUrl = page.url();
      if (!finalUrl.includes('/login') && !finalUrl.includes('/sign-in')) {
        loginSuccessful = true;
      }
    }
    
    if (loginSuccessful) {
      console.log('✅ Automatic login successful!');
      
      // Handle location permission request if it appears
      console.log('   🔍 Checking for location permission request...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Try to handle location permission dialog/button
      try {
        // Check if there's a location permission dialog or button on the page
        const hasLocationPrompt = await page.evaluate(() => {
          // @ts-ignore - browser context
          const body = (window as any).document.body;
          const text = body.innerText || '';
          return text.includes('location') || 
                 text.includes('Location') ||
                 text.includes('Allow') ||
                 text.includes('location access') ||
                 text.includes('Enable location');
        });
        
        if (hasLocationPrompt) {
          console.log('   📍 Location permission prompt detected on page');
          
          // Try multiple strategies to click Allow
          let clicked = false;
          
          // Strategy 1: Find buttons with Allow/Yes/Accept text
          const buttons = await page.$$('button, a, [role="button"], [class*="button"]');
          for (const btn of buttons) {
            try {
              const text = await page.evaluate((el) => el.textContent || '', btn);
              const lowerText = text.toLowerCase().trim();
              if (lowerText.includes('allow') || 
                  lowerText.includes('yes') || 
                  lowerText.includes('accept') ||
                  lowerText.includes('enable') ||
                  lowerText === 'allow' ||
                  lowerText === 'yes') {
                await btn.click();
                console.log('   ✅ Clicked location permission button');
                clicked = true;
                break;
              }
            } catch (e) {
              // Continue to next button
            }
          }
          
          // Strategy 2: Try to find by aria-label or data attributes
          if (!clicked) {
            const allowByLabel = await page.$('[aria-label*="Allow" i], [aria-label*="location" i], [data-testid*="allow" i]');
            if (allowByLabel) {
              await allowByLabel.click();
              console.log('   ✅ Clicked location button by label');
              clicked = true;
            }
          }
          
          // Strategy 3: Try pressing Enter (might work for some dialogs)
          if (!clicked) {
            await page.keyboard.press('Enter');
            await new Promise(resolve => setTimeout(resolve, 500));
            console.log('   💡 Pressed Enter to accept location permission');
          }
          
          // Wait for permission to be processed
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          console.log('   ✅ No location permission prompt found (may already be granted)');
        }
      } catch (error: any) {
        // Location handling failed, continue anyway
        console.log(`   ⚠️ Could not handle location permission automatically: ${error.message}`);
      }
      
      return true;
    } else {
      console.log('⚠️ Login may have failed - still on login page after waiting');
      return false;
    }
  } catch (error: any) {
    console.error('❌ Automatic login failed:', error.message);
    return false;
  }
}

/**
 * Handle login flow
 */
async function handleLogin(page: Page): Promise<void> {
  console.log('🔐 Checking authentication status...');
  
  const loggedIn = await isLoggedIn(page);
  
  if (loggedIn) {
    console.log('✅ Already authenticated on Underdog');
    return;
  }

  // Try automatic login first if credentials are provided
  const autoLoginSuccess = await attemptAutoLogin(page);
  
  if (autoLoginSuccess) {
    // Give extra time for page to settle after login
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verify login and save cookies
    const stillLoggedIn = await isLoggedIn(page);
    if (stillLoggedIn) {
      const cookies = await page.cookies();
      saveCookies(cookies);
      console.log('✅ Login successful, cookies saved');
    } else {
      console.warn('⚠️ Login status unclear. Continuing anyway...');
    }
    return;
  }

  // Fall back to manual login if auto-login failed or credentials not provided
  if (!process.env.UNDERDOG_EMAIL || !process.env.UNDERDOG_PASSWORD) {
    console.log('🔑 Credentials not found in environment variables.');
    console.log('💡 To enable automatic login, set UNDERDOG_EMAIL and UNDERDOG_PASSWORD in your .env file');
  } else {
    console.log('🔑 Automatic login failed, falling back to manual login...');
  }
  
  console.log('🔑 Please log in manually...');
  console.log('💡 After logging in, you can manually scroll the page if needed.');
  console.log('💡 Press ENTER when you\'re done logging in and ready to continue...');
  await waitForUserInput();
  
  // Give extra time for page to settle after login
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Verify login after user input
  const stillLoggedIn = await isLoggedIn(page);
  if (stillLoggedIn) {
    const cookies = await page.cookies();
    saveCookies(cookies);
    console.log('✅ Login successful, cookies saved');
  } else {
    console.warn('⚠️ Login status unclear. Continuing anyway...');
  }
}

/**
 * Scroll down by a specified distance in pixels
 * @param page - Puppeteer page object
 * @param distance - Number of pixels to scroll down (positive value)
 */
export async function scrollDown(page: Page, distance: number): Promise<void> {
  console.log(`📜 Scrolling down by ${distance}px...`);
  await page.evaluate((dist) => {
    // @ts-ignore - browser context
    (window as any).scrollBy(0, dist);
  }, distance);
}

/**
 * Scroll up by a specified distance in pixels
 * @param page - Puppeteer page object
 * @param distance - Number of pixels to scroll up (positive value, will be negated)
 */
export async function scrollUp(page: Page, distance: number): Promise<void> {
  console.log(`📜 Scrolling up by ${distance}px...`);
  await page.evaluate((dist) => {
    // @ts-ignore - browser context
    (window as any).scrollBy(0, -dist);
  }, distance);
}

/**
 * Scroll to an exact Y coordinate position
 * @param page - Puppeteer page object
 * @param yPosition - Y coordinate to scroll to (0 = top of page)
 */
export async function scrollTo(page: Page, yPosition: number): Promise<void> {
  console.log(`📜 Scrolling to Y position ${yPosition}px...`);
  await page.evaluate((y) => {
    // @ts-ignore - browser context
    (window as any).scrollTo(0, y);
  }, yPosition);
}

/**
 * Extract props from the page
 */
async function extractPropsFromPage(page: Page): Promise<UnderdogProp[]> {
  console.log('📊 Extracting props from page...');

  const props = await page.evaluate(() => {
    const results: any[] = [];

    // Try multiple selectors for prop cards
    const cardSelectors = [
      '[data-testid*="player-card"]',
      '[data-testid*="prop-card"]',
      '[class*="player-card"]',
      '[class*="prop-card"]',
      '[class*="PlayerCard"]',
      '[class*="PropCard"]',
      'div[class*="card"]', // Fallback to any card-like div
    ];

    let cards: any[] = [];
    for (const selector of cardSelectors) {
      // @ts-ignore - browser context
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length > 0) {
        cards = elements;
        break;
      }
    }

    // If no cards found, try to find any container with player names
    if (cards.length === 0) {
      // Look for elements containing player names and stats
      // @ts-ignore - browser context
      const allDivs = Array.from(document.querySelectorAll('div, article, section'));
      cards = allDivs.filter((el: any) => {
        const text = el.textContent || '';
        // Look for patterns that suggest a prop card
        return (
          (text.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/) || // Player name pattern
           text.match(/\b[A-Z]{2,4}\b/)) && // Team abbreviation
          (text.match(/\d+\.?\d*/) || // Line value
           text.match(/(Points|Goals|Assists|Shots|Hits|Blocks)/i)) // Stat category
        );
      });
    }

    console.log(`Found ${cards.length} potential prop cards`);

    for (const card of cards) {
      try {
        const cardText = card.textContent || '';
        const innerHTML = card.innerHTML || '';

        // Extract player name - look for common patterns
        let playerName = '';
        const nameSelectors = [
          '[data-testid*="player-name"]',
          '[class*="player-name"]',
          '[class*="PlayerName"]',
          'h1', 'h2', 'h3', 'h4',
          'strong', 'b',
        ];

        for (const selector of nameSelectors) {
          const nameEl = card.querySelector(selector);
          if (nameEl) {
            const text = nameEl.textContent?.trim() || '';
            // Check if it looks like a player name (2-3 words, capitalized)
            if (text.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$/)) {
              playerName = text;
              break;
            }
          }
        }

        // Fallback: extract from text using regex
        if (!playerName) {
          const nameMatch = cardText.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
          if (nameMatch) {
            playerName = nameMatch[1].trim();
          }
        }

        // Extract stat category
        let statCategory = '';
        const statKeywords = [
          'Points', 'Goals', 'Assists', 'Shots on Goal', 'Shots', 'SOG',
          'Hits', 'Blocked Shots', 'Blocks', 'Time On Ice', 'TOI',
          'Faceoffs Won', 'FOW', 'Faceoffs Lost', 'FOL', 'Faceoffs',
          'Goals Allowed', 'Saves', 'Fantasy Score',
        ];

        for (const keyword of statKeywords) {
          if (cardText.toLowerCase().includes(keyword.toLowerCase())) {
            statCategory = keyword;
            break;
          }
        }

        // Extract line value
        let lineValue = 0;
        const lineMatch = cardText.match(/(\d+\.?\d*)/);
        if (lineMatch) {
          lineValue = parseFloat(lineMatch[1]);
        }

        // Extract team
        const nhlTeams = [
          'ARI', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET',
          'EDM', 'FLA', 'LAK', 'LA', 'MIN', 'MTL', 'NSH', 'NJD', 'NJ', 'NYI', 'NYR',
          'OTT', 'PHI', 'PIT', 'SJS', 'SJ', 'SEA', 'STL', 'TBL', 'TB', 'TOR',
          'UTA', 'VAN', 'VGK', 'VEG', 'WSH', 'WAS', 'WPG', 'WIN',
        ];

        let team = '';
        for (const teamAbbr of nhlTeams) {
          const regex = new RegExp(`\\b${teamAbbr}\\b`, 'i');
          if (regex.test(cardText)) {
            team = teamAbbr;
            break;
          }
        }

        // Extract player position (LW, RW, C, D, G)
        let position = '';
        const positionPatterns = [
          /\b(LW|RW|C|D|G)\b/i,  // Direct position abbreviations
          /\b(Left Wing|Right Wing|Center|Defenseman|Goalie|Goaltender)\b/i,  // Full position names
        ];
        
        for (const pattern of positionPatterns) {
          const posMatch = cardText.match(pattern);
          if (posMatch && posMatch[1]) {
            const pos = posMatch[1].toUpperCase();
            // Map full names to abbreviations
            if (pos.includes('LEFT WING') || pos === 'LW') position = 'LW';
            else if (pos.includes('RIGHT WING') || pos === 'RW') position = 'RW';
            else if (pos.includes('CENTER') || pos === 'C') position = 'C';
            else if (pos.includes('DEFENSEMAN') || pos === 'D') position = 'D';
            else if (pos.includes('GOAL') || pos === 'G') position = 'G';
            if (position) break;
          }
        }

        // Extract opponent (look for vs/@ patterns or second team abbreviation)
        let opponent = '';
        
        // Strategy 1: Look for explicit vs/@ patterns
        const vsPatterns = [
          /(?:vs|@|v\.?|versus)\s*([A-Z]{2,4})\b/i,
          /([A-Z]{2,4})\s*(?:vs|@|v\.?|versus)/i,
          /vs\.?\s*([A-Z]{2,4})/i,
        ];
        
        for (const pattern of vsPatterns) {
          const vsMatch = cardText.match(pattern);
          if (vsMatch && vsMatch[1]) {
            const potentialOpponent = vsMatch[1].toUpperCase();
            // Make sure opponent is different from team and is a valid NHL team
            if (potentialOpponent !== team.toUpperCase() && nhlTeams.includes(potentialOpponent)) {
              opponent = potentialOpponent;
              break;
            }
          }
        }
        
        // Strategy 2: Look in parent elements for opponent info
        if (!opponent) {
          try {
            let parent = card.parentElement;
            let attempts = 0;
            while (parent && attempts < 3) {
              const parentText = parent.textContent || '';
              for (const pattern of vsPatterns) {
                const vsMatch = parentText.match(pattern);
                if (vsMatch && vsMatch[1]) {
                  const potentialOpponent = vsMatch[1].toUpperCase();
                  if (potentialOpponent !== team.toUpperCase() && nhlTeams.includes(potentialOpponent)) {
                    opponent = potentialOpponent;
                    break;
                  }
                }
              }
              if (opponent) break;
              parent = parent.parentElement;
              attempts++;
            }
          } catch (e) {
            // Continue if parent access fails
          }
        }
        
        // Strategy 3: Find all team abbreviations and pick the one that's different
        if (!opponent) {
          const teamMatches = cardText.matchAll(/\b([A-Z]{2,4})\b/g);
          const teams = Array.from(teamMatches).map((m: any) => m[1].toUpperCase());
          const uniqueTeams = [...new Set(teams.filter(t => nhlTeams.includes(t)))];
          if (uniqueTeams.length >= 2) {
            // Find the team that's different from the player's team
            opponent = uniqueTeams.find(t => t !== team.toUpperCase()) || '';
          } else if (uniqueTeams.length === 1 && uniqueTeams[0] !== team.toUpperCase()) {
            // If only one team found and it's different, use it
            opponent = uniqueTeams[0];
          }
        }
        
        // Strategy 4: Look for matchup patterns like "CHI @ NYI" or "WSH vs NYI"
        if (!opponent) {
          const matchupPatterns = [
            /\b([A-Z]{2,4})\s+[@vs]\s+([A-Z]{2,4})\b/i,
            /\b([A-Z]{2,4})\s+vs\.?\s+([A-Z]{2,4})\b/i,
          ];
          
          for (const pattern of matchupPatterns) {
            const match = cardText.match(pattern);
            if (match && match[1] && match[2]) {
              const team1 = match[1].toUpperCase();
              const team2 = match[2].toUpperCase();
              
              // If one matches the player's team, the other is the opponent
              if (team1 === team.toUpperCase() && team2 !== team.toUpperCase() && nhlTeams.includes(team2)) {
                opponent = team2;
                break;
              } else if (team2 === team.toUpperCase() && team1 !== team.toUpperCase() && nhlTeams.includes(team1)) {
                opponent = team1;
                break;
              }
            }
          }
        }
        
        // Final check: ensure opponent is different from team
        if (opponent && opponent === team.toUpperCase()) {
          opponent = '';
        }

        // Extract game time - look for time patterns like "7:00 PM", "7:00PM", "19:00", etc.
        let gameTime = '';
        const timePatterns = [
          /\b(\d{1,2}:\d{2}\s*(?:AM|PM))\b/i,  // "7:00 PM" or "7:00PM"
          /\b(\d{1,2}:\d{2})\b/,              // "7:00" (24-hour format)
          /\b(\d{1,2}\s*(?:AM|PM))\b/i,      // "7 PM"
        ];
        
        for (const pattern of timePatterns) {
          const timeMatch = cardText.match(pattern);
          if (timeMatch && timeMatch[1]) {
            gameTime = timeMatch[1].trim();
            break;
          }
        }
        
        // Also check for date/time in ISO format or other formats
        if (!gameTime) {
          const dateTimeMatch = cardText.match(/\b(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})\b/);
          if (dateTimeMatch && dateTimeMatch[1]) {
            gameTime = dateTimeMatch[1];
          }
        }

        // Only add if we have essential data
        if (playerName && statCategory && lineValue > 0 && team) {
          results.push({
            playerName: playerName.trim(),
            team: team.toUpperCase(),
            opponent: opponent.toUpperCase() || '',
            position: position || undefined,
            stat: statCategory,
            line: lineValue,
            gameTime: gameTime || undefined,
          });
        }
      } catch (error) {
        // Skip this card if extraction fails
        console.error('Error extracting prop from card:', error);
      }
    }

    return results;
  });

  // Allowed stats for NHL props
  const allowedStats = [
    'Shots on Goal',
    'Faceoffs Won',
    'Hits',
    'Goals',
    'Points',
    'Assists',
    'Blocked Shots',
    'Goals Allowed',
    'Goalie Saves',
  ];

  // Normalize team names and stats, and filter to NHL and allowed stats
  const normalizedProps: UnderdogProp[] = props
    .map((prop) => {
      const normalizedTeam = normalizeTeamName(prop.team);
      const normalizedOpponent = prop.opponent ? normalizeTeamName(prop.opponent) : '';
      const normalizedStat = normalizeStatType(prop.stat);

      return {
        playerName: prop.playerName,
        team: normalizedTeam,
        opponent: normalizedOpponent,
        position: prop.position,
        stat: normalizedStat,
        line: prop.line,
        gameTime: prop.gameTime,
      };
    })
    .filter((prop) => {
      // Filter out invalid props
      if (!prop.playerName || !prop.team || !prop.stat || prop.line <= 0) {
        return false;
      }
      
      // Filter to only allowed stats
      const statLower = prop.stat.toLowerCase();
      const isAllowedStat = allowedStats.some(allowed => 
        statLower === allowed.toLowerCase() ||
        statLower.includes(allowed.toLowerCase()) ||
        allowed.toLowerCase().includes(statLower)
      );
      
      if (!isAllowedStat) {
        return false;
      }
      
      // Ensure opponent is different from team (if opponent exists)
      if (prop.opponent && prop.opponent === prop.team) {
        return false;
      }
      
      return true;
    });

  // Remove duplicates (same player, team, stat, line)
  const uniqueProps = normalizedProps.filter((prop, index, self) => {
    return (
      index ===
      self.findIndex(
        (p) =>
          p.playerName === prop.playerName &&
          p.team === prop.team &&
          p.stat === prop.stat &&
          Math.abs(p.line - prop.line) < 0.01
      )
    );
  });

  console.log(`✅ Extracted ${uniqueProps.length} unique props from page`);
  return uniqueProps;
}

/**
 * Scrape Underdog Fantasy player props using Puppeteer
 */
export async function scrapeUnderdogProps(): Promise<UnderdogProp[]> {
  console.log('🐕 Scraping Underdog Fantasy props with Puppeteer...');

  let browser: Browser | null = null;

  try {
    // Launch browser (non-stealth, normal Puppeteer)
    browser = await puppeteer.launch({
      headless: false, // Keep visible for login
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--start-maximized', // Start maximized
        '--window-size=1920,1080',
      ],
      defaultViewport: null, // Use full window size instead of fixed viewport
    });

    const page = await browser.newPage();
    
    // Set viewport to full screen
    await page.setViewport({ width: 1920, height: 1080 });
    
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Grant location permissions (Underdog may request location after login)
    const context = browser.defaultBrowserContext();
    // Grant geolocation permission for Underdog domains
    await context.overridePermissions('https://underdogfantasy.com', ['geolocation']);
    await context.overridePermissions('https://app.underdogfantasy.com', ['geolocation']);
    
    // Set a mock geolocation (optional - can use real location if needed)
    // Using NYC coordinates as default
    await page.setGeolocation({ latitude: 40.7128, longitude: -74.0060 });
    
    // Handle browser permission dialogs automatically
    page.on('dialog', async (dialog) => {
      console.log(`   📍 Browser dialog detected: ${dialog.type()} - ${dialog.message()}`);
      if (dialog.type() === 'beforeunload' || dialog.message().toLowerCase().includes('location')) {
        await dialog.accept();
        console.log('   ✅ Accepted location permission dialog');
      }
    });

    // Load cookies if they exist
    const savedCookies = loadCookies();
    if (savedCookies && savedCookies.length > 0) {
      console.log('🍪 Loading saved cookies...');
      await page.setCookie(...savedCookies);
    }

    // Navigate to pick-em page
    console.log(`🌐 Navigating to ${UNDERDOG_URL}...`);
    await page.goto(UNDERDOG_URL, {
      waitUntil: 'networkidle0', // Wait for network to be completely idle
      timeout: 60000,
    });

    // Wait for page to fully load (handle loading animations)
    console.log('⏳ Waiting for page to fully load (this may take a moment)...');
    
    // Give initial time for page to start loading
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check current URL to see where we are
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);
    
    // If we're on login page, wait specifically for login form
    if (currentUrl.includes('/login') || currentUrl.includes('/sign-in') || currentUrl.includes('/signin')) {
      console.log('🔐 Detected login page, waiting for login form to appear...');
      console.log('   (Waiting for loading screen to disappear and login form to show)...');
      
      // Wait for the loading screen to disappear and login form to appear
      // Try multiple strategies to detect when login form is ready
      let loginFormFound = false;
      
      // Strategy 1: Wait for email input field
      try {
        console.log('   Trying to find email input field...');
        await page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="Email" i], input[placeholder*="email" i]', {
          timeout: 30000,
          visible: true
        });
        console.log('✅ Login form detected (email field found)');
        loginFormFound = true;
      } catch (error) {
        console.log('   Email field not found yet, trying other methods...');
      }
      
      // Strategy 2: Wait for password field
      if (!loginFormFound) {
        try {
          console.log('   Trying to find password field...');
          await page.waitForSelector('input[type="password"]', {
            timeout: 15000,
            visible: true
          });
          console.log('✅ Login form detected (password field found)');
          loginFormFound = true;
        } catch (error) {
          console.log('   Password field not found yet...');
        }
      }
      
      // Strategy 3: Wait for login button
      if (!loginFormFound) {
        try {
          console.log('   Trying to find login button...');
          await page.waitForSelector('button:has-text("Log in"), button:has-text("Sign in"), button[type="submit"]', {
            timeout: 15000,
            visible: true
          });
          console.log('✅ Login form detected (login button found)');
          loginFormFound = true;
        } catch (error) {
          console.log('   Login button not found yet...');
        }
      }
      
      // Strategy 4: Wait for form element
      if (!loginFormFound) {
        try {
          console.log('   Trying to find form element...');
          await page.waitForSelector('form', {
            timeout: 15000,
            visible: true
          });
          console.log('✅ Login form detected (form element found)');
          loginFormFound = true;
        } catch (error) {
          console.log('   Form element not found yet...');
        }
      }
      
      // Strategy 5: Wait for text content indicating login form
      if (!loginFormFound) {
        console.log('   Waiting for login form text to appear...');
        try {
          await page.waitForFunction(() => {
            // @ts-ignore - browser context
            const body = (window as any).document.body;
            const text = body.innerText || '';
            // Look for login-related text
            return text.includes('Log in') || 
                   text.includes('Email') || 
                   text.includes('Password') ||
                   text.includes('Sign in');
          }, { timeout: 20000 });
          console.log('✅ Login form detected (login text found)');
          loginFormFound = true;
        } catch (error) {
          console.log('   Login text not found yet...');
        }
      }
      
      // If still not found, wait a bit more and check again
      if (!loginFormFound) {
        console.log('⚠️ Login form not detected yet, waiting additional time...');
        console.log('💡 The page may still be loading. Please check the browser window.');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
      // Final wait to ensure form is fully interactive
      console.log('⏳ Ensuring login form is fully interactive...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      // Not on login page, wait for main content
      try {
        await Promise.race([
          page.waitForSelector('[data-testid*="player"], [class*="player-card"], [class*="prop-card"], [class*="Card"]', { timeout: 15000 }),
          page.waitForFunction(() => {
            // @ts-ignore - browser context
            const body = (window as any).document.body;
            const text = body.innerText || '';
            // Check if we have actual content (not just loading screen)
            return text.length > 500 && !text.includes('UNDERDOG') || 
                   body.querySelector('form') !== null ||
                   body.querySelector('[class*="card"]') !== null;
          }, { timeout: 15000 }),
        ]);
        console.log('✅ Page content loaded');
      } catch {
        console.log('⚠️ Waiting for page content...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // Give extra time for animations
      }
    }

    // Handle login if needed
    await handleLogin(page);

    // Click NHL tab to filter to NHL props only
    console.log('🏒 Clicking NHL tab to filter props...');
    try {
      // Wait a moment for the page to settle after login
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try multiple strategies to find and click the NHL tab
      let nhlTabClicked = false;
      
      // Strategy 1: Look for button/link with "NHL" text
      const nhlSelectors = [
        'button:has-text("NHL")',
        'a:has-text("NHL")',
        '[role="tab"]:has-text("NHL")',
        '[class*="tab"]:has-text("NHL")',
        '[class*="Tab"]:has-text("NHL")',
      ];
      
      // Since Puppeteer doesn't support :has-text(), we'll use evaluate to find elements
      const nhlTabFound = await page.evaluate(() => {
        // @ts-ignore - browser context
        const doc = (window as any).document;
        // @ts-ignore - browser context
        const allElements = Array.from(doc.querySelectorAll('button, a, [role="tab"], [class*="tab"], [class*="Tab"]'));
        
        for (const el of allElements) {
          const text = (el as any).textContent || (el as any).innerText || '';
          const upperText = text.toUpperCase().trim();
          
          // Look for NHL tab (exact match or contains NHL)
          if (upperText === 'NHL' || (upperText.includes('NHL') && upperText.length < 10)) {
            // Check if it's visible and clickable
            // @ts-ignore - browser context
            const style = (window as any).getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              (el as any).click();
              return true;
            }
          }
        }
        return false;
      });
      
      if (nhlTabFound) {
        console.log('✅ Clicked NHL tab');
        nhlTabClicked = true;
        // Wait for NHL props to load after clicking
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Strategy 2: Try data attributes or specific selectors
      if (!nhlTabClicked) {
        const dataSelectors = [
          '[data-testid*="nhl" i]',
          '[data-testid*="NHL"]',
          '[aria-label*="NHL" i]',
          '[aria-label*="nhl"]',
          'button[aria-label*="NHL" i]',
          'a[aria-label*="NHL" i]',
        ];
        
        for (const selector of dataSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              await element.click();
              console.log(`✅ Clicked NHL tab using selector: ${selector}`);
              nhlTabClicked = true;
              await new Promise(resolve => setTimeout(resolve, 3000));
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      }
      
      // Strategy 3: Look for tabs container and find NHL within it
      if (!nhlTabClicked) {
        const tabContainer = await page.evaluate(() => {
          // @ts-ignore - browser context
          const doc = (window as any).document;
          // @ts-ignore - browser context
          const containers = Array.from(doc.querySelectorAll('[class*="tab"], [class*="Tab"], [role="tablist"], nav, [class*="filter"], [class*="Filter"]')) as Element[];
          
          for (const container of containers) {
            const buttons = container.querySelectorAll('button, a, [role="tab"]');
            for (const btn of buttons) {
              const text = (btn as any).textContent || (btn as any).innerText || '';
              if (text.toUpperCase().trim() === 'NHL' || (text.toUpperCase().includes('NHL') && text.length < 10)) {
                (btn as any).click();
                return true;
              }
            }
          }
          return false;
        });
        
        if (tabContainer) {
          console.log('✅ Clicked NHL tab from tab container');
          nhlTabClicked = true;
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      if (!nhlTabClicked) {
        console.log('⚠️ Could not find NHL tab - continuing with all sports');
        console.log('💡 The page may already be showing NHL props, or the tab structure may have changed');
      }
    } catch (error: any) {
      console.log(`⚠️ Error clicking NHL tab: ${error.message}`);
      console.log('💡 Continuing anyway - may already be on NHL tab');
    }

    // Click "More Picks" buttons for all NHL players to load additional props
    console.log('📋 Clicking "More Picks" for all NHL players to load additional props...');
    try {
      // Wait a moment for NHL props to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      let totalClicks = 0;
      let iteration = 0;
      const maxIterations = 5; // Prevent infinite loops
      
      // Keep clicking until no more "More Picks" buttons are found
      while (iteration < maxIterations) {
        iteration++;
        
        // Find all "More Picks" buttons on the page
        const buttonsToClick = await page.evaluate(() => {
          // @ts-expect-error - window exists in browser context
          const doc = (window as any).document;
          const allElements = Array.from(doc.querySelectorAll('button, a, [role="button"], [class*="button"], [class*="Button"]'));
          const buttons: any[] = [];
          
          for (const el of allElements) {
            const text = (el as any).textContent || (el as any).innerText || '';
            const upperText = text.toUpperCase().trim();
            
            // Look for "More Picks", "More", "Show More", "Load More", etc.
            if (
              upperText.includes('MORE PICKS') ||
              (upperText.includes('MORE') && (upperText.includes('PICK') || upperText.includes('PROP'))) ||
              (upperText === 'MORE' && text.length < 20) || // Short "More" buttons
              upperText.includes('SHOW MORE') ||
              upperText.includes('LOAD MORE') ||
              upperText.includes('VIEW MORE')
            ) {
              // Check if it's visible and clickable
              // @ts-expect-error - browser context
              const style = (window as any).getComputedStyle(el);
              const rect = (el as any).getBoundingClientRect();
              
              if (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0
              ) {
                buttons.push({
                  text: text.trim(),
                  className: (el as any).className || '',
                  id: (el as any).id || '',
                  tagName: (el as any).tagName,
                });
              }
            }
          }
          return buttons;
        });
        
        if (buttonsToClick.length === 0) {
          // No more buttons found
          if (totalClicks > 0) {
            console.log(`✅ Finished clicking "More Picks" buttons. Total clicked: ${totalClicks}`);
          } else {
            console.log('ℹ️ No "More Picks" buttons found - may already show all props');
          }
          break;
        }
        
        console.log(`   Found ${buttonsToClick.length} "More Picks" button(s) to click (iteration ${iteration})...`);
        
        // Click all found buttons
        for (let i = 0; i < buttonsToClick.length; i++) {
          const buttonInfo = buttonsToClick[i];
          
          try {
            // Find and click the button using its text
            const clicked = await page.evaluate((info) => {
              // @ts-expect-error - window exists in browser context
              const doc = (window as any).document;
              const allElements = Array.from(doc.querySelectorAll(info.tagName));
              
              for (const el of allElements) {
                const text = (el as any).textContent || (el as any).innerText || '';
                if (text.trim() === info.text) {
                  // Check if still visible (might have been clicked already)
                  // @ts-expect-error - browser context
                  const style = (window as any).getComputedStyle(el);
                  const rect = (el as any).getBoundingClientRect();
                  
                  if (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    rect.width > 0 &&
                    rect.height > 0
                  ) {
                    // Scroll into view and click
                    (el as any).scrollIntoView({ behavior: 'auto', block: 'center' });
                    (el as any).click();
                    return true;
                  }
                }
              }
              return false;
            }, buttonInfo);
            
            if (clicked) {
              totalClicks++;
              // Small delay between clicks
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          } catch (e) {
            // Continue to next button
          }
        }
        
        // Wait for new content to load after clicking
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Scroll down a bit to ensure all buttons are in view
        await scrollDown(page, 500);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Strategy 2: Try data attributes or specific selectors as fallback
      if (totalClicks === 0) {
        console.log('   Trying alternative selectors for "More Picks" buttons...');
        const morePicksSelectors = [
          '[data-testid*="more" i]',
          '[data-testid*="More" i]',
          '[aria-label*="more picks" i]',
          '[aria-label*="more" i]',
          'button[aria-label*="more" i]',
          'a[aria-label*="more" i]',
          '[class*="more-picks" i]',
          '[class*="MorePicks" i]',
        ];
        
        for (const selector of morePicksSelectors) {
          try {
            const elements = await page.$$(selector);
            if (elements.length > 0) {
              console.log(`   Found ${elements.length} element(s) with selector: ${selector}`);
              
              for (const element of elements) {
                const isVisible = await page.evaluate((el) => {
                  // @ts-ignore - browser context
                  const style = (window as any).getComputedStyle(el);
                  const rect = (el as any).getBoundingClientRect();
                  return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    rect.width > 0 &&
                    rect.height > 0
                  );
                }, element);
                
                if (isVisible) {
                  await element.scrollIntoView();
                  await new Promise(resolve => setTimeout(resolve, 500));
                  await element.click();
                  totalClicks++;
                  console.log(`✅ Clicked "More Picks" using selector: ${selector}`);
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
              
              if (totalClicks > 0) break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      }
      
      if (totalClicks > 0) {
        console.log(`✅ Successfully clicked ${totalClicks} "More Picks" button(s) for all NHL players`);
        // Give extra time for all props to load
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error: any) {
      console.log(`⚠️ Error clicking "More Picks": ${error.message}`);
      console.log('💡 Continuing anyway - may already show all available props');
    }

    // Wait for props to load
    console.log('⏳ Waiting for props to load...');
    try {
      // Try to wait for prop cards or any content
      await page.waitForSelector(
        '[data-testid*="player"], [class*="player-card"], [class*="prop-card"], [class*="card"]',
        { timeout: 10000 }
      ).catch(() => {
        // If selector not found, just wait a bit
        console.log('⚠️ Prop cards selector not found, waiting for page to settle...');
      });
    } catch (error) {
      // Continue anyway
    }

    await new Promise(resolve => setTimeout(resolve, 3000)); // Give page time to fully load

    // Auto-scroll to load all props (if lazy loaded)
    console.log('📜 Auto-scrolling to load all props...');
    
    // Get initial page height
    let lastHeight = await page.evaluate(() => {
      // @ts-ignore - browser context
      const win = window as any;
      return Math.max(
        win.document.documentElement.scrollHeight,
        win.document.body.scrollHeight
      );
    });
    
    let scrollAttempts = 0;
    const maxScrollAttempts = 100; // Prevent infinite scrolling
    const scrollDistance = 500; // Pixels to scroll each time
    
    console.log(`   Initial page height: ${lastHeight}px`);
    
    while (scrollAttempts < maxScrollAttempts) {
      // Scroll down using the manual scroll function
      await scrollDown(page, scrollDistance);
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check new height
      const newHeight = await page.evaluate(() => {
        // @ts-expect-error - window exists in browser context
        const win = window as any;
        return Math.max(
          win.document.documentElement.scrollHeight,
          win.document.body.scrollHeight
        );
      });
      
      // Check current scroll position
      const currentScroll = await page.evaluate(() => {
        // @ts-ignore - browser context
        const win = window as any;
        return Math.max(
          win.pageYOffset || win.document.documentElement.scrollTop || win.document.body.scrollTop,
          0
        );
      });
      
      const maxScroll = newHeight - 1080; // Viewport height
      
      // If we've reached the bottom or height didn't change, we're done
      if (currentScroll >= maxScroll - 100 || (newHeight === lastHeight && scrollAttempts > 5)) {
        console.log(`   ✅ Finished scrolling. Reached bottom or no new content (attempt ${scrollAttempts + 1})`);
        console.log(`   Final page height: ${newHeight}px, scrolled to: ${currentScroll}px`);
        break;
      }
      
      lastHeight = newHeight;
      scrollAttempts++;
      
      // Log progress every 10 scrolls
      if (scrollAttempts % 10 === 0) {
        console.log(`   📜 Scrolled ${scrollAttempts} times, current height: ${newHeight}px, position: ${currentScroll}px`);
      }
    }
    
    // Scroll back to top for consistent extraction
    console.log('↩️ Scrolling back to top...');
    await scrollTo(page, 0);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Manual scrolling example (only runs if DEBUG_SCROLL env var is set)
    if (process.env.DEBUG_SCROLL === 'true') {
      console.log('🔧 DEBUG_SCROLL enabled - demonstrating manual scroll functions...');
      
      // Example: Scroll down by 500px
      await scrollDown(page, 500);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Example: Scroll down by another 500px
      await scrollDown(page, 500);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Example: Scroll up by 300px
      await scrollUp(page, 300);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Example: Scroll to top (Y position 0)
      await scrollTo(page, 0);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('✅ Manual scroll demonstration complete');
    }

    // Extract props
    const props = await extractPropsFromPage(page);

    // Save cookies for next time
    const cookies = await page.cookies();
    saveCookies(cookies);

    console.log(`✅ Found ${props.length} Underdog props`);
    return props;
  } catch (error: any) {
    console.error('❌ Underdog scrape failed — continuing without UD props.');
    console.error(`   Error: ${error.message}`);
    return [];
  } finally {
    if (browser) {
      // Small delay so user can see results
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await browser.close();
    }
  }
}
