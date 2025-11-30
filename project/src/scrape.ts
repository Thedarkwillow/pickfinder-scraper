import 'dotenv/config';
import { Browser, Page } from 'puppeteer';
import { createBrowser, closeBrowser } from './browser';
import { appendDefenseRows } from './sheets';
import { DefenseRow, GameInfo, todayIsoDate } from './utils';

async function scrapeTodayGames(page: Page): Promise<GameInfo[]> {
  console.log('📅 Scraping today\'s NHL games from schedule...');

  // Give React app time to render schedule
  await page.waitForTimeout(5000);

  const games: GameInfo[] = await page.evaluate(() => {
    const results: GameInfo[] = [];

    // Heuristic selectors for game rows
    const rowCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid*="game-row"],[data-testid*="matchup-row"],[class*="matchup"],[class*="game-row"]',
      ),
    );

    const rows = rowCandidates.length
      ? rowCandidates
      : Array.from(document.querySelectorAll<HTMLElement>('tr'));

    for (const row of rows) {
      const text = row.innerText || '';
      if (!text) continue;
      if (!/vs|@/i.test(text)) continue;

      // Extract teams and time
      const timeMatch = text.match(/\b\d{1,2}:\d{2}\s*(AM|PM)?\b/i);
      const gameTime = timeMatch ? timeMatch[0].trim() : '';

      const vsMatch = text.match(/([A-Za-z\s]+?)\s*(vs|@)\s*([A-Za-z\s]+)/i);
      if (!vsMatch) continue;

      const homeTeam = vsMatch[1].trim();
      const awayTeam = vsMatch[3].trim();

      // Find any player links for each team within the row
      const playerLinks = Array.from(
        row.querySelectorAll<HTMLAnchorElement>('a[href*="/players/nhl/"]'),
      );

      const firstPlayerUrl = (link: HTMLAnchorElement | null) =>
        link ? new URL(link.href, window.location.origin).toString() : '';

      const homePlayer = playerLinks[0] || null;
      const awayPlayer = playerLinks.find(a => a !== homePlayer) || playerLinks[1] || null;

      results.push({
        homeTeam,
        awayTeam,
        gameTime,
        homePlayerUrl: firstPlayerUrl(homePlayer),
        awayPlayerUrl: firstPlayerUrl(awayPlayer),
      } as GameInfo);
    }

    return results;
  });

  console.log(`✅ Found ${games.length} games on schedule.`);
  return games;
}

async function scrapeDefenseTableForTeam(
  page: Page,
  teamName: string,
  opponent: string,
  gameTime: string,
  playerPageUrl: string,
): Promise<DefenseRow[]> {
  console.log(`🛡️ Scraping defense table for team: ${teamName} (opponent: ${opponent})`);

  await page.goto(playerPageUrl, {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });
  await page.waitForTimeout(4000);

  // Click the "Defense" tab if present
  const defenseTabSelectors = [
    'button:contains("Defense")',
    'button[role="tab"]:contains("Defense")',
    '[role="tab"]:contains("Defense")',
    'a:contains("Defense")',
  ];

  for (const selector of defenseTabSelectors) {
    try {
      const clicked = await page.evaluate(sel => {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(sel));
        const el = candidates.find(e => /defense/i.test(e.innerText || ''));
        if (!el) return false;
        el.click();
        return true;
      }, selector);

      if (clicked) {
        console.log(`✅ Clicked Defense tab via selector: ${selector}`);
        await page.waitForTimeout(2000);
        break;
      }
    } catch {
      // Try next selector
    }
  }

  // Extract Opponent Positional Strength table
  const rows: DefenseRow[] = await page.evaluate(
    ({ teamName, opponent, gameTime, playerPageUrl, scrapedAt }) => {
      const results: DefenseRow[] = [];

      // Find the section labeled "Opponent Positional Strength"
      const allHeadings = Array.from(
        document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,strong'),
      );

      let tableContainer: HTMLElement | null = null;

      for (const heading of allHeadings) {
        const text = heading.innerText || '';
        if (/opponent\s+positional\s+strength/i.test(text)) {
          // Assume the table is either the next sibling or within the same section
          const parent = heading.parentElement;
          const nextTable =
            (parent && (parent.querySelector('table') as HTMLTableElement | null)) ||
            (heading.nextElementSibling as HTMLTableElement | null) ||
            (heading.closest('section') as HTMLElement | null);

          if (nextTable) {
            tableContainer = nextTable;
            break;
          }
        }
      }

      if (!tableContainer) {
        // Fallback: any table containing the phrase
        const tables = Array.from(document.querySelectorAll<HTMLTableElement>('table'));
        for (const tbl of tables) {
          if (/opponent\s+positional\s+strength/i.test(tbl.innerText || '')) {
            tableContainer = tbl;
            break;
          }
        }
      }

      if (!tableContainer) {
        console.warn('Could not locate Opponent Positional Strength table.');
        return results;
      }

      const table =
        (tableContainer.tagName === 'TABLE'
          ? (tableContainer as HTMLTableElement)
          : (tableContainer.querySelector('table') as HTMLTableElement | null)) || null;

      if (!table) {
        console.warn('Opponent Positional Strength table not found inside container.');
        return results;
      }

      const trs = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr, tr'));

      for (const tr of trs) {
        const cells = Array.from(tr.querySelectorAll<HTMLTableCellElement>('td,th'));
        if (cells.length < 2) continue;

        const posText = cells[0].innerText.trim();
        const valText = cells[1].innerText.trim();
        if (!posText || !valText) continue;

        let numericValue: number | string = valText;
        const numMatch = valText.replace(',', '').match(/-?\d+(\.\d+)?/);
        if (numMatch) {
          numericValue = parseFloat(numMatch[0]);
        }

        results.push({
          team: teamName,
          opponent,
          gameTime,
          position: posText,
          value: numericValue,
          playerPageUrl,
          scrapedAt,
        } as DefenseRow);
      }

      return results;
    },
    {
      teamName,
      opponent,
      gameTime,
      playerPageUrl,
      scrapedAt: todayIsoDate(),
    },
  );

  console.log(`   ➜ Found ${rows.length} positions for ${teamName}`);
  return rows;
}

async function run(): Promise<void> {
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    const browserCtx = await createBrowser();
    browser = browserCtx.browser;
    page = browserCtx.page;

    const games = await scrapeTodayGames(page);

    const allRows: DefenseRow[] = [];

    for (const game of games) {
      const { homeTeam, awayTeam, gameTime, homePlayerUrl, awayPlayerUrl } = game;

      if (homePlayerUrl) {
        const rows = await scrapeDefenseTableForTeam(
          page,
          homeTeam,
          awayTeam,
          gameTime,
          homePlayerUrl,
        );
        allRows.push(...rows);
      } else {
        console.log(`⚠️ No player page URL found for home team: ${homeTeam}`);
      }

      if (awayPlayerUrl) {
        const rows = await scrapeDefenseTableForTeam(
          page,
          awayTeam,
          homeTeam,
          gameTime,
          awayPlayerUrl,
        );
        allRows.push(...rows);
      } else {
        console.log(`⚠️ No player page URL found for away team: ${awayTeam}`);
      }
    }

    console.log(`\n📊 Total defense rows scraped: ${allRows.length}`);

    await appendDefenseRows(allRows);
  } catch (err: any) {
    console.error('❌ Fatal error during scrape:', err?.message || err);
  } finally {
    if (browser) {
      await closeBrowser(browser, page || undefined);
    }
  }
}

run().catch(err => {
  console.error('❌ Unhandled error in main:', err);
});


