import { Page } from 'puppeteer';

export interface DefenseRow {
  team: string;
  opponent: string;
  position: string;
  rank: string; // textual positional strength (e.g., "7th", "22nd", "3.5")
}

export async function openPlayersForTeam(page: Page, teamAbbrev: string): Promise<void> {
  console.log(`🔎 Opening players page for team: ${teamAbbrev}`);

  // Directly open filtered players page for the team
  await page.goto(`https://www.pickfinder.app/players?team=${encodeURIComponent(teamAbbrev)}`, {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  // Click NHL tab if visible (extra safety)
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a,button'));
    const nhl = links.find(l => /NHL/i.test(l.innerText || ''));
    if (nhl) nhl.click();
  });
  await page.waitForTimeout(2000);

  // Click the first player link
  const clicked = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/players/nhl/"]'));
    const first = links[0];
    if (!first) return false;
    first.click();
    return true;
  });

  if (!clicked) {
    console.log(`⚠️ No player found for team filter; team may have no active players in list.`);
  }

  await page.waitForTimeout(4000);
}

export async function scrapeDefenseForTeam(
  page: Page,
  team: string,
  opponent: string,
): Promise<DefenseRow[]> {
  console.log(`🛡️ Scraping Defense tab for team ${team} vs ${opponent}…`);

  // Click Defense tab (text-based, resilient selector)
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('button,a,[role="tab"]'));
    const tab = candidates.find(el => /defense/i.test(el.innerText || ''));
    if (tab) tab.click();
  });
  await page.waitForTimeout(2000);

  const rows = await page.evaluate(
    ({ team, opponent }) => {
      const results: DefenseRow[] = [];

      // Find heading or label "Opponent Positional Strength"
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
        // Fallback: any table containing that phrase
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



