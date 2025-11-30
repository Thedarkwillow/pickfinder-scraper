import 'dotenv/config';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { uploadDefenseRowsToSheets, DefenseSheetRow } from './sheets';
import * as path from 'path';
import * as fs from 'fs';
import { isSignedOut, handleGoogleLogin, saveCookies, loadCookies } from './googleAuth';

interface TodayGame {
  teamA: string;
  teamB: string;
  gameTime: string;
  clickableElement?: number;
}

async function openBrowserWithSchedule(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  // Try to load saved cookies first so we stay logged in
  await loadCookies(context);

  const page = await context.newPage();

  console.log('🌐 Opening PickFinder home…');
  await page.goto('https://www.pickfinder.app/', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  await page.waitForTimeout(4000);

  // If we’re signed out, run the Google OAuth flow (uses GOOGLE_EMAIL / GOOGLE_PASSWORD)
  if (await isSignedOut(page)) {
    console.log('🔐 Not logged in, starting Google login...');
    await handleGoogleLogin(page, process.env.GOOGLE_EMAIL, process.env.GOOGLE_PASSWORD);
    await saveCookies(context);
  } else {
    console.log('✅ Already authenticated on PickFinder');
  }

  // Navigate: Home → Projections → NHL
  console.log('🧭 Navigating to NHL projections...');
  
  let onNHLPage = false;
  
  // First try to navigate directly to NHL projections URL
  try {
    console.log('🔗 Navigating directly to NHL projections...');
    await page.goto('https://www.pickfinder.app/projections/nhl', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await page.waitForTimeout(3000);
    
    // Verify we're on the NHL projections page
    const url = page.url().toLowerCase();
    if (url.includes('projections') && url.includes('nhl')) {
      console.log('✅ Successfully navigated to NHL projections page');
      onNHLPage = true;
    }
  } catch (err: any) {
    console.warn('⚠️ Direct navigation failed:', err?.message);
  }
  
  // If direct navigation didn't work, try manual navigation
  if (!onNHLPage) {
    console.log('🔄 Trying manual navigation: Home → Projections → NHL');
    
    // Navigate to home first
    try {
      await page.goto('https://www.pickfinder.app/', {
        waitUntil: 'networkidle',
        timeout: 60000,
      });
      await page.waitForTimeout(2000);
    } catch (err: any) {
      console.warn('⚠️ Could not navigate to home:', err?.message);
    }
    
    // Click Projections menu item
    console.log('📋 Clicking Projections menu...');
    try {
  await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('a,button,div,span,[role="menuitem"]'),
    );
    const item = candidates.find(el => /projections/i.test(el.innerText || ''));
    if (item) item.click();
  });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
    } catch (err: any) {
      console.warn('⚠️ Error clicking Projections:', err?.message);
    }
    
    // Now click NHL filter
    console.log('🏒 Clicking NHL league filter...');
    await page.waitForTimeout(2000);
    
    let nhlClicked = false;
    
    // Strategy 1: Try Playwright's text selector
    try {
      const nhlButton = await page.getByRole('button', { name: /^NHL$/i }).first().catch(() => null);
      if (nhlButton && await nhlButton.isVisible().catch(() => false)) {
        await nhlButton.click({ timeout: 5000 });
        console.log('✅ Clicked NHL button using role selector');
        nhlClicked = true;
      }
    } catch (err) {
      // Continue
    }
    
    // Strategy 2: Try text locator
    if (!nhlClicked) {
      try {
        const nhlLink = await page.getByText(/^NHL$/i).first().catch(() => null);
        if (nhlLink && await nhlLink.isVisible().catch(() => false)) {
          await nhlLink.click({ timeout: 5000 });
          console.log('✅ Clicked NHL using text locator');
          nhlClicked = true;
        }
      } catch (err) {
        // Continue
      }
    }
    
    // Strategy 3: Try evaluate with multiple selectors
    if (!nhlClicked) {
      try {
        const clicked = await page.evaluate(() => {
          const allElements = Array.from(
            document.querySelectorAll<HTMLElement>('button, a, [role="button"], [role="tab"], div, span')
          );
          
          for (const el of allElements) {
            const text = (el.innerText || el.textContent || '').trim();
            const style = window.getComputedStyle(el);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            
            if (isVisible && /^NHL$/i.test(text) && text.length <= 5) {
              el.click();
              return true;
            }
          }
          return false;
        });
        
        if (clicked) {
          console.log('✅ Clicked NHL using evaluate method');
          nhlClicked = true;
        }
      } catch (err: any) {
        console.warn('⚠️ Error in evaluate NHL click:', err?.message);
      }
    }
    
    if (nhlClicked) {
      await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
      onNHLPage = true;
    } else {
      console.warn('⚠️ Could not click NHL filter');
    }
  }
  
  if (!onNHLPage) {
    throw new Error('Failed to navigate to NHL projections page. Please check the URL structure.');
  }

  // Ensure "All games" dropdown is opened/selected so games list is visible
  console.log('📋 Opening "All games" dropdown...');
  try {
    await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('button,div,span,select,[role="button"],[role="listbox"]'),
    );

      // Try to find an element whose visible text or aria-label contains "All games"
      const dropdown = candidates.find(el => {
        const text = (el.innerText || '').trim();
        const label =
          (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
        return /all\s*games/i.test(text) || /all\s*games/i.test(label);
      });

      if (!dropdown) return false;

      if (dropdown.tagName === 'SELECT') {
        const select = dropdown as HTMLSelectElement;
        const option = Array.from(select.options).find(o =>
          /all\s*games/i.test(o.text || ''),
        );
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      } else {
        dropdown.click();
        return true;
      }
      return false;
    });
    await page.waitForTimeout(2000);
    console.log('✅ "All games" dropdown opened');
  } catch (err: any) {
    console.warn(
      '⚠️ Error while trying to open/select "All games" dropdown:',
      err?.message || err,
    );
  }

  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  return { browser, context, page };
}

interface GameCard {
  teamA: string;
  teamB: string;
  gameTime: string;
  clickableElement: any; // We'll store selector info for clicking
}

async function scrapeTodayGames(page: Page): Promise<GameCard[]> {
  console.log('📅 Scraping today\'s NHL games from Projections...');
  await page.waitForTimeout(3000);

  const games = await page.evaluate(() => {
    const results: Array<{ teamA: string; teamB: string; gameTime: string; index: number }> = [];

    // Primary strategy: obvious game/schedule containers
    const primaryCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid*="game"],[class*="game-card"],[class*="matchup"],[class*="game_row"],[class*="schedule"]',
      ),
    );

    for (let i = 0; i < primaryCards.length; i++) {
      const card = primaryCards[i];
      const text = card.innerText || '';
      if (!text) continue;

      const lines = text.split(/\n+/);
      for (const line of lines) {
        const abbrevs = (line.match(/\b[A-Z]{2,4}\b/g) || []).slice(0, 2);
        if (abbrevs.length < 2) continue;

        const teamA = abbrevs[0];
        const teamB = abbrevs[1];

        const timeMatch = line.match(/\b\d{1,2}:\d{2}\s*(AM|PM)?\b/i);
        const gameTime = timeMatch ? timeMatch[0].trim() : '';

        results.push({ teamA, teamB, gameTime, index: i });
        break; // Only take first match per card
      }
    }

    // Fallback: search the whole page if we didn't find anything
    if (!results.length) {
      const allText = document.body.innerText || '';
      const lines = allText.split(/\n+/);
      for (const line of lines) {
        const abbrevs = (line.match(/\b[A-Z]{2,4}\b/g) || []).slice(0, 2);
      if (abbrevs.length < 2) continue;

      const teamA = abbrevs[0];
      const teamB = abbrevs[1];

        const timeMatch = line.match(/\b\d{1,2}:\d{2}\s*(AM|PM)?\b/i);
      const gameTime = timeMatch ? timeMatch[0].trim() : '';

        results.push({ teamA, teamB, gameTime, index: -1 });
      }
    }

    return results;
  });

  // Map to GameCard with clickable element reference
  const gameCards: GameCard[] = games.map((game, idx) => ({
    ...game,
    clickableElement: game.index >= 0 ? game.index : idx,
  }));

  console.log(`✅ Found ${gameCards.length} games for today.`);
  return gameCards;
}

/**
 * Click into a game card to open the game page
 */
async function clickIntoGame(page: Page, gameIndex: number): Promise<void> {
  console.log(`🖱️ Clicking into game #${gameIndex + 1}...`);

  await page.evaluate((index) => {
    const primaryCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid*="game"],[class*="game-card"],[class*="matchup"],[class*="game_row"],[class*="schedule"]',
      ),
    );
    
    if (index >= 0 && index < primaryCards.length) {
      const card = primaryCards[index];
      // Find clickable element within the card (link or button)
      const clickable = card.querySelector('a, button, [role="button"]') || card;
      if (clickable) {
        (clickable as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, gameIndex);
  
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
}

/**
 * Find and click the first clickable player for a specific team on the game page
 */
async function clickFirstPlayerForTeam(page: Page, teamAbbrev: string): Promise<boolean> {
  console.log(`👤 Looking for first player for team ${teamAbbrev}...`);
  
  const clicked = await page.evaluate((team) => {
    // Look for player links/buttons that might be associated with this team
    // Strategy: find all player links and click the first one
    const playerLinks = Array.from(
      document.querySelectorAll<HTMLElement>('a[href*="/players/"], a[href*="/player/"], [class*="player"] a, [class*="player"] button')
    );
    
    // Also try to find elements that contain team abbreviation
    const teamElements = Array.from(
      document.querySelectorAll<HTMLElement>('a, button, [role="button"]')
    ).filter(el => {
      const text = (el.innerText || '').toUpperCase();
      return text.includes(team.toUpperCase()) || el.getAttribute('href')?.includes('/players/');
    });
    
    // Combine and try to find first clickable player link
    const allCandidates = [...playerLinks, ...teamElements];
    
    for (const candidate of allCandidates) {
      const href = candidate.getAttribute('href');
      if (href && (href.includes('/players/') || href.includes('/player/'))) {
        candidate.click();
    return true;
      }
    }
    
    // Fallback: just click first player link found
    if (playerLinks.length > 0) {
      playerLinks[0].click();
      return true;
    }
    
    return false;
  }, teamAbbrev);
  
  if (clicked) {
    await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);
    return true;
  }
  
  return false;
}


interface DefenseRow {
  team: string;
  opponent: string;
  position: string;
  rank: string;
}

async function scrapeDefenseForTeam(
  page: Page,
  team: string,
  opponent: string,
): Promise<DefenseRow[]> {
  console.log(`🛡️ Scraping Defense tab for team ${team} vs ${opponent}…`);

  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('button,a,[role="tab"]'));
    const tab = candidates.find(el => /defense/i.test(el.innerText || ''));
    if (tab) tab.click();
  });
  await page.waitForTimeout(2000);

  const rows = await page.evaluate(
    ({ team, opponent }) => {
      const results: DefenseRow[] = [];

      const headings = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,strong,span'));
      let container: HTMLElement | null = null;
      for (const h of headings) {
        const txt = h.innerText || '';
        if (/opponent\s+positional\s+strength/i.test(txt)) {
          container = h.closest('section') || (h.parentElement as HTMLElement | null) || h;
          break;
        }
      }

      if (!container) {
        const tables = Array.from(document.querySelectorAll<HTMLTableElement>('table'));
        for (const t of tables) {
          if (/opponent\s+positional\s+strength/i.test(t.innerText || '')) {
            container = t;
            break;
          }
        }
      }

      if (!container) {
        console.warn('Opponent Positional Strength table not found.');
        return results;
      }

      const table =
        (container.tagName === 'TABLE'
          ? (container as HTMLTableElement)
          : (container.querySelector('table') as HTMLTableElement | null)) || null;

      if (!table) {
        console.warn('Table element not found inside container.');
        return results;
      }

      const trs = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr, tr'));

      for (const tr of trs) {
        const cells = Array.from(tr.querySelectorAll<HTMLTableCellElement>('td,th'));
        if (cells.length < 2) continue;

        const pos = cells[0].innerText.trim();
        const valText = cells[1].innerText.trim();
        if (!pos || !valText) continue;

        results.push({
          team,
          opponent,
          position: pos,
          rank: valText,
        });
      }

      return results;
    },
    { team, opponent },
  );

  console.log(`   ➜ Found ${rows.length} defense rows for ${team}.`);
  rows.forEach(r => {
    console.log(`      • Position ${r.position} rank ${r.rank}`);
  });
  return rows;
}

/**
 * Build the desired defense sheet rows for a single team/game.
 * Assumes we're already on the game page.
 */
async function processTeamForGame(
  page: Page,
  game: TodayGame,
  team: string,
  opponent: string,
): Promise<DefenseSheetRow[]> {
  console.log(`\n🎯 Processing team ${team} vs ${opponent} (${game.gameTime})`);

  // Click the first player for this team on the game page
  const playerClicked = await clickFirstPlayerForTeam(page, team);

  if (!playerClicked) {
    console.log(`⚠️ Could not find/click a player for team ${team}`);
    return [];
  }

  // Extract player name from the player page
  const playerUsed =
    (await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>('h1,h2,[data-testid*="player-name"],[class*="player"]'),
      );
      const el = candidates.find(e => (e.innerText || '').trim().length > 0);
      return el ? el.innerText.trim() : '';
    })) || '';

  // Scrape defense data for this player
  const defenseRows: DefenseRow[] = await scrapeDefenseForTeam(page, team, opponent);

  const sheetRows: DefenseSheetRow[] = defenseRows.map(r => {
    console.log(`   ✅ Position processed: ${r.position} (${r.rank})`);
    return {
      playerUsed,
      team: r.team,
      position: r.position,
      opponent: r.opponent,
      gameTime: game.gameTime,
      stat: 'Defense Strength',
      line: '',
    };
  });

  return sheetRows;
}

async function main() {
  console.log('🚀 PickFinder NHL Defense Positional Strength Scraper\n');
  console.log('='.repeat(50));

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const ctx = await openBrowserWithSchedule();
    browser = ctx.browser;
    context = ctx.context;
    page = ctx.page;

    const games = await scrapeTodayGames(page);
    if (!games.length) {
      console.log('ℹ️ No games found for today. Exiting.');
      return;
    }

    console.log(`\n📅 Games to process: ${games.length}`);

    const allSheetRows: DefenseSheetRow[] = [];
    const projectionsUrl = page.url(); // Save URL to go back to

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      console.log(`\n🎮 Processing game ${i + 1}/${games.length}: ${game.teamA} vs ${game.teamB}`);
      
      // Click into the game
      await clickIntoGame(page, typeof game.clickableElement === 'number' ? game.clickableElement : i);
      
      // Process both teams for this game
      const teams = [game.teamA, game.teamB];
      for (const team of teams) {
        const opponent = team === game.teamA ? game.teamB : game.teamA;
        try {
          // Make sure we're on the game page (might have navigated to player page)
          // If we're on a player page, go back to game page first
          const currentUrl = page.url();
          if (currentUrl.includes('/players/') && !currentUrl.includes('/game')) {
            // We're on a player page, need to go back to game page
            await page.goBack();
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(2000);
          }
          
          const rows = await processTeamForGame(page, game, team, opponent);
          allSheetRows.push(...rows);
          
          // Go back to game page after processing each team
          if (page.url().includes('/players/')) {
            await page.goBack();
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(2000);
          }
        } catch (err: any) {
          console.error(`⚠️ Error processing team ${team} vs ${opponent}:`, err?.message || err);
        }
      }
      
      // Go back to projections page before next game
      console.log(`↩️ Returning to projections page...`);
      try {
        await page.goto(projectionsUrl, { waitUntil: 'networkidle', timeout: 60000 });
      } catch {
        // If that fails, try going back
        await page.goBack();
        await page.waitForLoadState('networkidle').catch(() => {});
      }
      await page.waitForTimeout(3000);
      
      // Re-open "All games" dropdown if needed
      try {
        await page.evaluate(() => {
          const candidates = Array.from(
            document.querySelectorAll<HTMLElement>('button,div,span,select,[role="button"],[role="listbox"]'),
          );
          const dropdown = candidates.find(el => {
            const text = (el.innerText || '').trim();
            const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
            return /all\s*games/i.test(text) || /all\s*games/i.test(label);
          });
          if (dropdown && dropdown.tagName !== 'SELECT') {
            dropdown.click();
          }
        });
        await page.waitForTimeout(2000);
      } catch (err) {
        // Ignore
      }
    }

    console.log(`\n📊 Total rows to upload: ${allSheetRows.length}`);

    if (allSheetRows.length) {
      await uploadDefenseRowsToSheets(allSheetRows);
    } else {
      console.log('ℹ️ No defense rows scraped; nothing to upload.');
    }

    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFile = path.join(outputDir, `defense_${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(allSheetRows, null, 2));
    console.log(`\n💾 Raw defense rows saved to: ${outputFile}`);

    console.log('\n' + '='.repeat(50));
    console.log('✅ Workflow completed successfully!');
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error?.message || error);
    console.error(error?.stack);
    process.exit(1);
  } finally {
    if (browser) {
      // small delay so you can visually confirm login state / results
      await new Promise(resolve => setTimeout(resolve, 5000));
      await browser.close();
    }
  }
}

main();
