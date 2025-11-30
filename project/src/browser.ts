import puppeteer, { Browser, Page } from 'puppeteer-extra';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plugin has no official types
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as fs from 'fs';
import * as path from 'path';
import { PICKFINDER_SCHEDULE_URL, sleep } from './utils';

puppeteer.use(StealthPlugin());

const COOKIES_PATH = path.join(process.cwd(), 'cookies.json');

async function loadCookiesIfAvailable(page: Page): Promise<void> {
  if (!fs.existsSync(COOKIES_PATH)) {
    console.log('⚠️ cookies.json not found, starting without cookies');
    return;
  }

  try {
    const raw = fs.readFileSync(COOKIES_PATH, 'utf-8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies)) {
      console.log('⚠️ cookies.json is not an array, skipping cookie load');
      return;
    }

    await page.setCookie(
      ...cookies.map((c: any) => ({
        ...c,
        domain: c.domain || '.pickfinder.app',
      })),
    );

    console.log(`🍪 Loaded ${cookies.length} cookies from cookies.json`);
  } catch (err: any) {
    console.error('❌ Failed to load cookies.json:', err.message);
  }
}

async function saveCookies(page: Page): Promise<void> {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2), 'utf-8');
    console.log(`💾 Saved ${cookies.length} cookies to cookies.json`);
  } catch (err: any) {
    console.error('❌ Failed to save cookies:', err.message);
  }
}

async function needsLogin(page: Page): Promise<boolean> {
  const bodyText = (await page.evaluate(() => document.body.innerText)) || '';
  const url = page.url();

  if (url.includes('accounts.google.com')) return true;
  if (bodyText.toLowerCase().includes('sign in')) return true;
  if (bodyText.toLowerCase().includes('sign in with google')) return true;
  if (bodyText.toLowerCase().includes('404') && bodyText.toLowerCase().includes('not found')) {
    // Often /nhl shows 404 when not authenticated
    return true;
  }

  return false;
}

export async function createBrowser(): Promise<{ browser: Browser; page: Page }> {
  console.log('🌐 Launching Puppeteer (stealth)...');

  const browser = await puppeteer.launch({
    headless: false,
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

  await loadCookiesIfAvailable(page);

  console.log(`🔗 Navigating to schedule: ${PICKFINDER_SCHEDULE_URL}`);
  await page.goto(PICKFINDER_SCHEDULE_URL, {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });
  await sleep(3000);

  if (await needsLogin(page)) {
    console.log('🔐 Login appears to be required.');
    console.log('➡️  Please complete Google login in the opened browser window.');
    console.log('   After you finish and see the NHL schedule, DO NOT close the browser.');

    // Give user up to 2 minutes to log in manually
    const maxSeconds = 120;
    for (let i = 0; i < maxSeconds; i++) {
      await sleep(1000);
      if (!(await needsLogin(page))) {
        console.log('✅ Login detected, continuing...');
        break;
      }
      if (i % 15 === 0) {
        console.log(`⏳ Still waiting for manual login... (${maxSeconds - i}s remaining)`);
      }
    }

    if (await needsLogin(page)) {
      console.log('⚠️ Still not logged in after waiting. Scraper may not find schedule data.');
    } else {
      await saveCookies(page);
    }
  }

  return { browser, page };
}

export async function closeBrowser(browser: Browser, page?: Page): Promise<void> {
  try {
    if (page) {
      await saveCookies(page);
    }
  } catch {
    // ignore
  }

  await browser.close();
}


