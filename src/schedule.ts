import puppeteer, { Browser, Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';

export interface TodayGame {
  teamA: string;
  teamB: string;
  gameTime: string;
}

const COOKIES_PATH = path.join(process.cwd(), 'cookies.json');

async function loadCookies(page: Page): Promise<void> {
  if (!fs.existsSync(COOKIES_PATH)) return;
  try {
    const raw = fs.readFileSync(COOKIES_PATH, 'utf-8');
    const cookies = JSON.parse(raw);
    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      console.log(`🍪 Loaded ${cookies.length} cookies from cookies.json`);
    }
  } catch (err) {
    console.error('⚠️ Failed to load cookies.json:', err);
  }
}

async function needsLogin(page: Page): Promise<boolean> {
  const url = page.url();
  const body = await page.evaluate(() => document.body.innerText || '');
  if (url.includes('accounts.google.com')) return true;
  if (/sign in/i.test(body) || /sign-in/i.test(url)) return true;
  if (/not found \(404\)/i.test(body)) return true;
  return false;
}

export async function openBrowserWithSchedule(): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080',
    ],
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();
  await loadCookies(page);

  console.log('🌐 Opening PickFinder home…');
  await page.goto('https://www.pickfinder.app/', {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });

  await page.waitForTimeout(4000);

  if (await needsLogin(page)) {
    console.error('❌ Login required but only cookie-based auth is allowed. Please refresh cookies.json and retry.');
    throw new Error('Authentication required');
  }

  // Click sidebar "Projections"
  console.log('🧭 Navigating: Home → Projections → NHL');
  await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('a,button,div,span,[role="menuitem"]'),
    );
    const item = candidates.find(el => /projections/i.test(el.innerText || ''));
    if (item) item.click();
  });

  await page.waitForTimeout(3000);

  // Click top-row league button "NHL"
  await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('button,a,div,span'),
    );
    const nhl = candidates.find(el => /\bNHL\b/i.test(el.innerText || ''));
    if (nhl) nhl.click();
  });

  // Wait for games list to load
  await page.waitForTimeout(5000);

  return { browser, page };
}

export async function scrapeTodayGames(page: Page): Promise<TodayGame[]> {
  console.log('📅 Scraping today’s NHL games from Projections…');

  // Give Projections → NHL a bit more time if needed
  await page.waitForTimeout(3000);

  const games = await page.evaluate(() => {
    const results: TodayGame[] = [];

    // Game cards with two team logos and game time
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid*="game"],[class*="game-card"],[class*="matchup"],[class*="game_row"],[class*="schedule"]',
      ),
    );

    for (const card of cards) {
      const text = card.innerText || '';
      if (!text) continue;

      // Find all ALL-CAPS 2–4 letter tokens (team abbreviations)
      const abbrevs = (text.match(/\b[A-Z]{2,4}\b/g) || []).slice(0, 2);
      if (abbrevs.length < 2) continue;

      const teamA = abbrevs[0];
      const teamB = abbrevs[1];

      // Extract game time (e.g., 7:00 PM)
      const timeMatch = text.match(/\b\d{1,2}:\d{2}\s*(AM|PM)?\b/i);
      const gameTime = timeMatch ? timeMatch[0].trim() : '';

      results.push({ teamA, teamB, gameTime });
    }

    return results;
  });

  console.log(`✅ Found ${games.length} games for today.`);
  return games;
}



