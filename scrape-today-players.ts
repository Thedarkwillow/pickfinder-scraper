import 'dotenv/config';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { isSignedOut, handleGoogleLogin, saveCookies, loadCookies } from './src/googleAuth';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

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
        // Format as time: "HH:MM AM/PM" or "HH:MM:SS"
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
      // Google Sheets will recognize this as a time
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    }

    // If we can't parse it, return as-is (might already be formatted)
    return timeStr;
  } catch (e) {
    // If parsing fails, return as-is
    return timeStr;
  }
}

// Function to scrape today's NHL games (Playwright version)
async function scrapeTodayGames(page: Page): Promise<Array<{ teamA: string; teamB: string; gameTime: string }>> {
  console.log('📅 Scraping today\'s NHL games from Projections…');
  
  // Give Projections → NHL a bit more time if needed
  await page.waitForTimeout(5000);
  
  // Look for and click "All Games" dropdown if it exists
  console.log('   🔍 Looking for "All Games" dropdown...');
  try {
    const allGamesDropdown = page.getByText(/all games/i).first();
    await allGamesDropdown.scrollIntoViewIfNeeded();
    await allGamesDropdown.click({ timeout: 5000 });
    console.log('   ✅ Clicked "All Games" dropdown');
    await page.waitForTimeout(2000);
  } catch (err) {
    // Try alternative selectors
    try {
      const dropdown = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll<HTMLElement>('button, select, div, span, [role="button"]'));
        for (const el of elements) {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (text.includes('all games') || text.includes('all games')) {
            el.click();
            return true;
          }
        }
        return false;
      });
      if (dropdown) {
        console.log('   ✅ Clicked "All Games" dropdown (alternative method)');
        await page.waitForTimeout(2000);
      }
    } catch {
      console.log('   ⚠️ Could not find "All Games" dropdown, continuing...');
    }
  }
  
  // Scroll to load all games
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(2000);
  
  const games = await page.evaluate(() => {
    const results: Array<{ teamA: string; teamB: string; gameTime: string }> = [];
    const seenGames = new Set<string>();
    
    // Strategy 1: Look for game cards with two team logos and game time
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid*="game"],[class*="game-card"],[class*="matchup"],[class*="game_row"],[class*="schedule"],[class*="game"]',
      ),
    );
    
    for (const card of cards) {
      const text = card.innerText || '';
      if (!text) continue;
      
      // Find all ALL-CAPS 2–4 letter tokens (team abbreviations)
      const abbrevs = (text.match(/\b[A-Z]{2,4}\b/g) || []).filter(abbr => 
        // Filter out common non-team abbreviations
        !['NHL', 'PM', 'AM', 'EST', 'PST', 'CST', 'MST', 'GMT', 'UTC'].includes(abbr)
      ).slice(0, 2);
      
      if (abbrevs.length >= 2) {
        const teamA = abbrevs[0];
        const teamB = abbrevs[1];
        const gameKey = `${teamA}-${teamB}`;
        
        if (seenGames.has(gameKey)) continue;
        seenGames.add(gameKey);
        
        // Extract game time (e.g., 7:00 PM)
        const timeMatch = text.match(/\b\d{1,2}:\d{2}\s*(AM|PM)\b/i);
        const gameTime = timeMatch ? timeMatch[0].trim() : '';
        
        results.push({ teamA, teamB, gameTime });
      }
    }
    
    // Strategy 2: Look for links/buttons that contain team abbreviations and might be game links
    if (results.length === 0) {
      const allLinks = Array.from(document.querySelectorAll<HTMLElement>('a, button, div, [class*="card"]'));
      for (const link of allLinks) {
        const text = (link.innerText || link.textContent || '').trim();
        // Look for patterns like "WSH vs TOR" or "WSH @ TOR" or "WSH TOR"
        const vsMatch = text.match(/\b([A-Z]{2,4})\s+(?:vs|@|v\.?)\s+([A-Z]{2,4})\b/i);
        if (vsMatch) {
          const teamA = vsMatch[1].toUpperCase();
          const teamB = vsMatch[2].toUpperCase();
          const gameKey = `${teamA}-${teamB}`;
          
          if (seenGames.has(gameKey)) continue;
          seenGames.add(gameKey);
          
          // Extract game time
          const timeMatch = text.match(/\b\d{1,2}:\d{2}\s*(AM|PM)\b/i);
          const gameTime = timeMatch ? timeMatch[0].trim() : '';
          
          results.push({ teamA, teamB, gameTime });
        }
      }
    }
    
    // Strategy 3: Look for any element containing two team abbreviations side by side
    if (results.length === 0) {
      const allElements = Array.from(document.querySelectorAll<HTMLElement>('*'));
      for (const el of allElements) {
        const text = (el.innerText || el.textContent || '').trim();
        // Look for two team abbreviations separated by space, vs, @, or other separators
        const match = text.match(/\b([A-Z]{2,4})\s+(?:vs|@|v\.?|\s)\s*([A-Z]{2,4})\b/i);
        if (match) {
          const teamA = match[1].toUpperCase();
          const teamB = match[2].toUpperCase();
          
          // Validate these look like team abbreviations (common NHL teams)
          const nhlTeams = ['ANA', 'ARI', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'LA', 'MIN', 'MTL', 'NSH', 'NJ', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SJ', 'SEA', 'STL', 'TB', 'TOR', 'VAN', 'VGK', 'WSH', 'WPG'];
          if (nhlTeams.includes(teamA) && nhlTeams.includes(teamB)) {
            const gameKey = `${teamA}-${teamB}`;
            if (seenGames.has(gameKey)) continue;
            seenGames.add(gameKey);
            
            const timeMatch = text.match(/\b\d{1,2}:\d{2}\s*(AM|PM)\b/i);
            const gameTime = timeMatch ? timeMatch[0].trim() : '';
            
            results.push({ teamA, teamB, gameTime });
          }
        }
      }
    }
    
    return results;
  });
  
  console.log(`✅ Found ${games.length} games for today.`);
  if (games.length > 0) {
    games.forEach((game, i) => {
      console.log(`   ${i + 1}. ${game.teamA} vs ${game.teamB} @ ${game.gameTime || 'TBD'}`);
    });
  }
  return games;
}

interface PlayerLink {
  name: string;
  url: string;
  team?: string;
  stat?: string;
  line?: string;
}

interface DefenseData {
  team: string;
  opponent: string;
  gameTime: string;
  stat: string; // e.g., "Shots on Goal", "Assists", "Goals", etc.
  rank: string; // e.g., "25th", "7th", etc.
}

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'service_account.json');

/**
 * Get all player links from the NHL projections page
 */
async function getPlayerLinksFromProjections(page: Page): Promise<PlayerLink[]> {
  console.log('🔍 Extracting player links from projections page...');
  
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(5000);
  
  // Scroll to load more content if needed
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(2000);
  
  const playerLinks = await page.evaluate(() => {
    const links: PlayerLink[] = [];
    const seenUrls = new Set<string>();
    
    // Strategy 1: Find all links that point to player pages
    const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/players/"]'));
    
    for (const link of allLinks) {
      const href = link.getAttribute('href');
      if (!href || !href.includes('/players/nhl/')) continue;
      
      // Normalize URL
      const fullUrl = href.startsWith('http') ? href : `https://www.pickfinder.app${href}`;
      const baseUrl = fullUrl.split('?')[0];
      
      // Skip duplicates
      if (seenUrls.has(baseUrl)) continue;
      seenUrls.add(baseUrl);
      
      // Extract player name - try multiple strategies
      let playerName = '';
      
      // Strategy 1: Link text itself
      const linkText = (link.textContent || '').trim();
      const nameMatch = linkText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
      if (nameMatch) {
        playerName = nameMatch[1];
      }
      
      // Strategy 2: Look in parent container
      if (!playerName || playerName.length < 3) {
        const parent = link.closest('div, tr, li, [class*="player"], [class*="card"], [class*="row"]');
        if (parent) {
          const parentText = (parent.textContent || '').trim();
          const parentNameMatch = parentText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
          if (parentNameMatch) {
            playerName = parentNameMatch[1];
          }
        }
      }
      
      // Strategy 3: Look for h1, h2, h3, h4, h5, h6 in parent
      if (!playerName || playerName.length < 3) {
        const parent = link.closest('div, tr, li, article, section');
        if (parent) {
          const heading = parent.querySelector('h1, h2, h3, h4, h5, h6, [class*="name"], [class*="player-name"]');
          if (heading) {
            playerName = (heading.textContent || '').trim();
          }
        }
      }
      
      // Extract stat and line from URL
      const urlParams = new URLSearchParams(href.split('?')[1] || '');
      const stat = urlParams.get('stat') || '';
      const line = urlParams.get('line') || '';
      
      // Extract team abbreviation from nearby text
      const parent = link.closest('div, tr, li, [class*="player"], [class*="card"]');
      const parentText = parent ? (parent.textContent || '').trim() : '';
      const teamMatches = parentText.match(/\b([A-Z]{2,4})\b/g);
      const team = teamMatches && teamMatches.length > 0 ? teamMatches[0] : '';
      
      // Only add if we have a valid player name
      if (playerName && playerName.length >= 3 && playerName.length < 50) {
        links.push({
          name: playerName,
          url: fullUrl,
          team: team || undefined,
          stat: stat || undefined,
          line: line || undefined,
        });
      }
    }
    
    // Remove duplicates based on player name (case-insensitive)
    const uniqueLinks = new Map<string, PlayerLink>();
    for (const link of links) {
      const key = link.name.toLowerCase();
      if (!uniqueLinks.has(key)) {
        uniqueLinks.set(key, link);
      }
    }
    
    return Array.from(uniqueLinks.values());
  });
  
  console.log(`✅ Found ${playerLinks.length} unique player links`);
  
  // Log first few for debugging
  if (playerLinks.length > 0) {
    console.log('   Sample players:', playerLinks.slice(0, 5).map(p => p.name).join(', '));
  }
  
  return playerLinks;
}

/**
 * Check if a rank is between 24 and 32
 */
function isRankInRange(rank: string): boolean {
  // Extract number from rank string (e.g., "24th", "25th", "32nd")
  const match = rank.match(/(\d+)/);
  if (match) {
    const num = parseInt(match[1], 10);
    return num >= 24 && num <= 32;
  }
  return false;
}

/**
 * Extract defense data from the current page state
 */
async function extractDefenseDataFromPage(page: Page): Promise<Array<{ position: string; rank: string }>> {
  return await page.evaluate(() => {
    const results: Array<{ position: string; rank: string }> = [];
    
    // Strategy 1: Find the active Defense tab panel content
    let container: HTMLElement | null = null;
    
    // Find the Defense tab button to locate its associated content
    const defenseTab = Array.from(document.querySelectorAll<HTMLElement>('button, [role="tab"]')).find(
      el => (el.innerText || el.textContent || '').trim().toLowerCase() === 'defense'
    );
    
    if (defenseTab) {
      // Try to find associated tabpanel
      const tabId = defenseTab.getAttribute('aria-controls') || defenseTab.id;
      if (tabId) {
        container = document.getElementById(tabId) || document.querySelector(`[id="${tabId}"]`) as HTMLElement;
      }
      
      // If no ID match, look for tabpanel with matching aria-labelledby
      if (!container) {
        const tabLabelId = defenseTab.getAttribute('aria-labelledby') || defenseTab.getAttribute('id');
        if (tabLabelId) {
          container = document.querySelector(`[aria-labelledby="${tabLabelId}"], [aria-labelledby*="${tabLabelId}"]`) as HTMLElement;
        }
      }
      
      // If still not found, look for next sibling or parent's next sibling
      if (!container) {
        let nextSibling = defenseTab.nextElementSibling as HTMLElement;
        while (nextSibling && !container) {
          if (nextSibling.getAttribute('role') === 'tabpanel' || 
              nextSibling.classList.toString().toLowerCase().includes('panel') ||
              nextSibling.classList.toString().toLowerCase().includes('content')) {
            container = nextSibling;
            break;
          }
          nextSibling = nextSibling.nextElementSibling as HTMLElement;
        }
      }
      
      // Look for parent container that might hold the tab content
      if (!container) {
        let parent = defenseTab.parentElement;
        while (parent && !container) {
          const tabpanel = parent.querySelector('[role="tabpanel"]') as HTMLElement;
          if (tabpanel) {
            container = tabpanel;
            break;
          }
          parent = parent.parentElement;
        }
      }
    }
    
    // Strategy 2: Find active tabpanel (most likely Defense tab content)
    if (!container) {
      const activeTabpanel = document.querySelector('[role="tabpanel"][aria-hidden="false"], [role="tabpanel"]:not([aria-hidden="true"])') as HTMLElement;
      if (activeTabpanel) {
        container = activeTabpanel;
      }
    }
    
    if (!container) {
      // Try to find any container with defense data
      const allDivs = Array.from(document.querySelectorAll<HTMLElement>('div'));
      for (const div of allDivs) {
        const text = (div.innerText || div.textContent || '').trim();
        if (/(Shots|Hits|Points|Faceoffs|Saves|Goals Allowed)\s+\d+(?:th|st|nd|rd)/i.test(text)) {
          const style = window.getComputedStyle(div);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            container = div;
            break;
          }
        }
      }
    }
    
    if (!container) {
      return results;
    }
    
    // Extract data from container
    const statCategories = [
      'Shots on Goal', 'Shots', 'SOG',
      'Faceoffs Won', 'FOW', 'Face Off Wins',
      'Hits',
      'Points', 'Pts',
      'Goals Allowed', 'GA',
      'Goalie Saves', 'Saves', 'SV',
      'Blocked Shots', 'Blocks',
      'Time On Ice', 'TOI',
      'Faceoffs Lost', 'FOL',
      'Faceoffs', 'FO'
    ];
    
    // Strategy 1: Parse table structure (most reliable)
    const table = container.tagName === 'TABLE' 
      ? (container as HTMLTableElement)
      : (container.querySelector('table') as HTMLTableElement | null);
    
    if (table) {
      const trs = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr, tr'));
      for (const tr of trs) {
        const cells = Array.from(tr.querySelectorAll<HTMLElement>('td, th'));
        if (cells.length >= 2) {
          const statName = (cells[0]?.innerText || cells[0]?.textContent || '').trim();
          const rankText = (cells[1]?.innerText || cells[1]?.textContent || '').trim();
          
          // Check if statName matches any of our stat categories (case-insensitive)
          const matchedStat = statCategories.find(s => 
            statName.toLowerCase().includes(s.toLowerCase()) || 
            s.toLowerCase().includes(statName.toLowerCase())
          );
          
          const isValidStat = matchedStat || statName.length > 0;
          const isValidRank = rankText.length > 0 && 
                             (/\d/.test(rankText) || /rank|th|st|nd|rd/i.test(rankText));
          
          if (isValidStat && isValidRank) {
            let rank = rankText;
            if (!/th|st|nd|rd/i.test(rank) && /\d+/.test(rank)) {
              rank = rank.replace(/\d+/, (m) => m + 'th');
            }
            const position = matchedStat || statName;
            results.push({ position, rank });
          }
        }
      }
    }
    
    // Strategy 2: Text matching if no table
    if (results.length === 0) {
      const containerText = (container.innerText || container.textContent || '').trim();
      for (const stat of statCategories) {
        const pattern = new RegExp(`(${stat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s+(\\d+(?:th|st|nd|rd))`, 'gi');
        let match;
        while ((match = pattern.exec(containerText)) !== null) {
          const position = match[1].trim();
          const rank = match[2].trim();
          if (position && rank) {
            results.push({ position, rank });
          }
        }
      }
    }
    
    // Remove duplicates
    const uniqueResults = new Map<string, { position: string; rank: string }>();
    for (const result of results) {
      const key = `${result.position}-${result.rank}`;
      if (!uniqueResults.has(key)) {
        uniqueResults.set(key, result);
      }
    }
    
    return Array.from(uniqueResults.values());
  });
}

/**
 * Get a player URL for a given team (any player from that team works as a doorway)
 */
async function getPlayerUrlForTeam(page: Page, team: string): Promise<string | null> {
  try {
    // Navigate to NHL projections page
    await page.goto('https://www.pickfinder.app/projections/nhl', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await page.waitForTimeout(3000);
    
    // Find any player link for the given team
    const playerUrl = await page.evaluate((teamAbbr) => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/players/nhl/"]'));
      for (const link of links) {
        const parent = link.closest('div, tr, li, [class*="player"], [class*="card"]');
        const parentText = parent ? (parent.textContent || '').trim() : '';
        // Check if this link is associated with the team
        if (parentText.includes(teamAbbr)) {
          const href = link.getAttribute('href');
          if (href) {
            return href.startsWith('http') ? href : `https://www.pickfinder.app${href}`;
          }
        }
      }
      return null;
    }, team);
    
    return playerUrl;
  } catch (error: any) {
    console.error(`❌ Error finding player for team ${team}:`, error.message);
    return null;
  }
}

/**
 * Scrape defense data from a player page (Defense tab) - team-based data
 */
async function scrapeDefenseData(page: Page, playerUrl: string, team: string, opponent: string, gameTime: string): Promise<DefenseData[]> {
  try {
    console.log(`📄 Scraping defense data for team ${team} (vs ${opponent}) from: ${playerUrl.substring(0, 80)}...`);
    
    await page.goto(playerUrl, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    
    // Fix viewport and layout issues
    console.log('   🔧 Fixing viewport and layout...');
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    // Apply CSS fixes to correct zoom, overflow, and centering
    await page.evaluate(() => {
      // Fix zoom and overflow
      document.body.style.zoom = '0.8';
      document.documentElement.style.overflow = 'visible';
      document.body.style.overflowX = 'scroll';
      document.documentElement.style.overflowX = 'scroll';
      
      // Remove overflow: hidden from all containers
      document.querySelectorAll('*').forEach((el: Element) => {
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        if (style.overflow.includes('hidden')) {
          htmlEl.style.overflow = 'visible';
        }
        if (style.overflowX === 'hidden') {
          htmlEl.style.overflowX = 'scroll';
        }
        if (style.overflowY === 'hidden') {
          htmlEl.style.overflowY = 'visible';
        }
      });
      
      // Reset scroll position to top-left and ensure page is centered
      window.scrollTo(0, 0);
      
      // Force page to be centered
      const bodyWidth = document.body.scrollWidth;
      const viewportWidth = window.innerWidth;
      if (bodyWidth > viewportWidth) {
        // If content is wider than viewport, scroll to center
        window.scrollTo((bodyWidth - viewportWidth) / 2, 0);
      }
    });
    
    await page.waitForTimeout(2000);
    
    // Verify page is properly loaded and centered
    const pageState = await page.evaluate(() => {
      return {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        bodyWidth: document.body.scrollWidth,
        bodyHeight: document.body.scrollHeight,
        zoom: parseFloat((document.body.style.zoom || '1').replace('%', '')) / 100 || 1,
      };
    });
    console.log(`   📐 Page state: scroll(${pageState.scrollX}, ${pageState.scrollY}), viewport(${pageState.innerWidth}x${pageState.innerHeight}), body(${pageState.bodyWidth}x${pageState.bodyHeight}), zoom(${pageState.zoom})`);
    
    // Wait for left-sidebar menu to be fully visible before continuing
    console.log('   ⏳ Waiting for left-sidebar menu to load...');
    try {
      await page.waitForSelector('nav, [class*="sidebar"], [class*="menu"], aside', { 
        timeout: 10000,
        state: 'visible'
      }).catch(() => {
        // Continue even if sidebar selector doesn't match
      });
      await page.waitForTimeout(2000); // Additional wait for layout to stabilize
    } catch {
      // Continue anyway
    }
    
    // Debug: List available tabs with detailed info
    const tabDebugInfo = await page.evaluate(() => {
      const info: Array<{text: string, tag: string, visible: boolean, scrollLeft: number, offsetLeft: number, parentScrollWidth: number, parentClientWidth: number}> = [];
      const elements = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="tab"], [role="button"], [class*="tab"], div, span'));
      
      for (const el of elements) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text && text.length < 20) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const parent = el.parentElement;
          
          info.push({
            text: text,
            tag: el.tagName,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            scrollLeft: parent ? parent.scrollLeft : 0,
            offsetLeft: el.offsetLeft,
            parentScrollWidth: parent ? parent.scrollWidth : 0,
            parentClientWidth: parent ? parent.clientWidth : 0,
          });
        }
      }
      return info;
    });
    
    console.log(`   📑 Found ${tabDebugInfo.length} potential tab elements:`);
    tabDebugInfo.forEach(tab => {
      console.log(`      - "${tab.text}" (${tab.tag}) - visible: ${tab.visible}, scrollLeft: ${tab.scrollLeft}, offsetLeft: ${tab.offsetLeft}, parent scroll: ${tab.parentScrollWidth}/${tab.parentClientWidth}`);
    });
    
    // Check if Defense tab exists
    const hasDefense = tabDebugInfo.some(t => t.text.toLowerCase() === 'defense');
    console.log(`   🛡️ Defense tab found: ${hasDefense}`);
    
    // Check for scrollable containers
    const scrollableInfo = await page.evaluate(() => {
      const containers: Array<{selector: string, scrollWidth: number, clientWidth: number, scrollLeft: number, hasTabs: boolean}> = [];
      const allElements = Array.from(document.querySelectorAll<HTMLElement>('*'));
      
      for (const el of allElements) {
        if (el.scrollWidth > el.clientWidth) {
          const hasTabs = el.querySelectorAll('button, [role="tab"]').length > 0;
          let firstClass = '';
          if (typeof el.className === 'string') {
            firstClass = el.className.split(' ')[0] || '';
          } else if (el.className && typeof el.className === 'object') {
            firstClass = el.className[0] || '';
          }
          containers.push({
            selector: el.tagName + (firstClass ? '.' + firstClass : ''),
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            scrollLeft: el.scrollLeft,
            hasTabs: hasTabs,
          });
        }
      }
      return containers;
    });
    
    if (scrollableInfo.length > 0) {
      console.log(`   📜 Found ${scrollableInfo.length} scrollable containers:`);
      scrollableInfo.forEach(container => {
        if (container.hasTabs) {
          console.log(`      - ${container.selector}: scrollWidth=${container.scrollWidth}, clientWidth=${container.clientWidth}, scrollLeft=${container.scrollLeft}`);
        }
      });
    }
    
    // Opponent and game time are passed in, no need to extract from page
    
    // Click Defense tab - ensure it's visible and clickable
    console.log('   🛡️ Clicking Defense tab...');
    let defenseTabClicked = false;
    
    // Wait a bit for page to fully render
    await page.waitForTimeout(2000);
    
    // Strategy 1: Use evaluate to find and scroll to Defense tab, then click with Playwright
    try {
      const defenseTabInfo = await page.evaluate(() => {
        // Find all possible tab elements - prioritize buttons
        const allElements = Array.from(document.querySelectorAll<HTMLElement>(
          'button, [role="tab"], [role="button"], a, [class*="tab"]'
        ));
        
        for (const el of allElements) {
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          
          // Check if this is the Defense tab
          if (text === 'defense') {
            // Get element position
            const rect = el.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            // Check if element is outside viewport horizontally
            if (rect.left < 0 || rect.right > viewportWidth) {
              // Scroll horizontally to center the element
              const scrollX = rect.left + (rect.width / 2) - (viewportWidth / 2);
              window.scrollTo(scrollX, window.scrollY);
            }
            
            // Scroll into view vertically if needed
            if (rect.top < 0 || rect.bottom > viewportHeight) {
              el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
            } else {
            el.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
            }
            
            return { found: true, tag: el.tagName, id: el.id || '', classes: el.className?.toString() || '' };
          }
        }
        return { found: false, tag: '', id: '', classes: '' };
      });
      
      if (defenseTabInfo.found) {
        await page.waitForTimeout(500); // Wait for scroll to complete
        // Now click using Playwright's click method which is more reliable
        const defenseTab = page.getByText(/^defense$/i).first();
        await defenseTab.scrollIntoViewIfNeeded();
        await defenseTab.click({ timeout: 5000 });
        defenseTabClicked = true;
        console.log('   ✅ Clicked Defense tab using scroll + Playwright click');
      }
    } catch (err: any) {
      console.log(`   ⚠️ Evaluate method failed: ${err.message}`);
    }
    
    // Strategy 2: Use Playwright's text locator
    if (!defenseTabClicked) {
      try {
        const defenseTab = page.getByText(/^defense$/i).first();
        await defenseTab.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await defenseTab.click({ timeout: 5000 });
        defenseTabClicked = true;
        console.log('   ✅ Clicked Defense tab using text locator');
      } catch (err) {
        // Continue
      }
    }
    
    // Strategy 3: Use role selector
    if (!defenseTabClicked) {
      try {
        const defenseTab = page.getByRole('tab', { name: /defense/i }).first();
        await defenseTab.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await defenseTab.click({ timeout: 5000 });
        defenseTabClicked = true;
        console.log('   ✅ Clicked Defense tab using role selector');
      } catch (err) {
        // Continue
      }
    }
    
    if (!defenseTabClicked) {
      console.log('   ⚠️ Could not find or click Defense tab');
      console.log('   ℹ️ Attempting to extract data anyway...');
    } else {
      // Wait a bit for the click to register
      await page.waitForTimeout(1000);
    }
    
    // Wait for Defense tab content to load - give it more time
    await page.waitForTimeout(5000);
    
    // Wait for Defense tab content to load
    await page.waitForTimeout(3000);
    
    // Find and interact with position dropdown (LW, RW, C, D, G)
    console.log('   🔍 Looking for position dropdown...');
    const positions = ['LW', 'RW', 'C', 'D', 'G'];
    const allDefenseRows: Array<{ position: string; rank: string }> = [];
    
    // First, try to find the position dropdown element
    const dropdownInfo = await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll<HTMLElement>(
        'select, button, [role="button"], [role="combobox"], [class*="select"], [class*="dropdown"], [class*="position"]'
      ));
      
      for (const el of allElements) {
        const text = (el.innerText || el.textContent || '').trim().toUpperCase();
        // Check if this element contains position options
        if ((text.includes('LW') || text.includes('RW') || text.includes(' C ') || text.includes(' D ') || text.includes(' G ')) &&
            (text.includes('LW') && text.includes('RW') && text.includes('C'))) {
          return {
            found: true,
            tag: el.tagName,
            id: el.id || '',
            text: text.substring(0, 100)
          };
        }
      }
      return { found: false, tag: '', id: '', text: '' };
    });
    
    console.log(`   📋 Position dropdown found: ${dropdownInfo.found ? 'Yes' : 'No'}`);
    if (dropdownInfo.found) {
      console.log(`      Dropdown info: ${dropdownInfo.tag}, text: ${dropdownInfo.text.substring(0, 50)}...`);
    }
    
    for (const position of positions) {
      console.log(`   📍 Processing position: ${position}`);
      
      try {
        // Try multiple strategies to select the position
        let positionSelected = false;
        
        // Strategy 1: Use Playwright's text locator to find and click position
        try {
          const positionElement = page.getByText(new RegExp(`^${position}$`, 'i')).first();
          await positionElement.scrollIntoViewIfNeeded();
          await positionElement.click({ timeout: 3000 });
          positionSelected = true;
          console.log(`   ✅ Clicked position ${position} using text locator`);
        } catch {
          // Strategy 2: Use evaluate to find and click
          positionSelected = await page.evaluate((pos) => {
            // Look for buttons/options that match the position
            const allElements = Array.from(document.querySelectorAll<HTMLElement>(
              'button, [role="button"], [role="option"], option, div, span'
            ));
            
            for (const el of allElements) {
              const text = (el.innerText || el.textContent || '').trim().toUpperCase();
              // Exact match or contains the position
              if (text === pos || (text.length <= 5 && text.includes(pos))) {
                // Make sure it's visible
                const style = window.getComputedStyle(el);
                if (style.display !== 'none' && style.visibility !== 'hidden') {
                  el.click();
                  return true;
                }
              }
            }
            
            // Try select dropdown
            const selects = Array.from(document.querySelectorAll<HTMLSelectElement>('select'));
            for (const select of selects) {
              for (let i = 0; i < select.options.length; i++) {
                const optionText = select.options[i].text.toUpperCase().trim();
                if (optionText === pos || optionText.includes(pos)) {
                  select.selectedIndex = i;
                  select.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                }
              }
            }
            
            return false;
          }, position);
          
          if (positionSelected) {
            console.log(`   ✅ Selected position ${position} using evaluate`);
          }
        }
        
        // Wait for content to update after position selection
        if (positionSelected) {
          await page.waitForTimeout(2000);
        }
        
        // Scroll to ensure content is visible
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight / 2);
        });
        await page.waitForTimeout(1000);
        
        // Extract defense data for this position
        const positionDefenseRows = await extractDefenseDataFromPage(page);
        
        // Filter to only include ranks between 24-32
        const filteredRows = positionDefenseRows.filter(row => isRankInRange(row.rank));
        
        // Add position context to each row
        for (const row of filteredRows) {
          // Prepend position to stat name
          const statWithPosition = `${position} - ${row.position}`;
          allDefenseRows.push({
            position: statWithPosition,
            rank: row.rank
          });
        }
        
        console.log(`   ✅ Found ${filteredRows.length} stat entries for position ${position} (filtered from ${positionDefenseRows.length} total, keeping only ranks 24-32)`);
        
      } catch (error: any) {
        console.log(`   ⚠️ Error processing position ${position}: ${error.message}`);
        // Continue with next position
      }
    }
    
    // If no position-specific data found, try extracting without position filter
    if (allDefenseRows.length === 0) {
      console.log('   ⚠️ No position-specific data found, trying to extract all defense data...');
      const allRows = await extractDefenseDataFromPage(page);
      // Filter to only include ranks between 24-32
      const filteredRows = allRows.filter(row => isRankInRange(row.rank));
      for (const row of filteredRows) {
        allDefenseRows.push({
          position: row.position,
          rank: row.rank
        });
      }
      console.log(`   ✅ Found ${filteredRows.length} stat entries (filtered from ${allRows.length} total, keeping only ranks 24-32)`);
    }
    
    // Wait for Defense tab to become active and content to load
    try {
      // Wait for tabpanel or any content to appear
      await page.waitForSelector('[role="tabpanel"], [class*="tab-content"], [class*="panel"], [class*="defense"]', { timeout: 10000 }).catch(() => {});
    } catch {
      // Continue anyway
    }
    
    // Additional wait for dynamic content
    await page.waitForTimeout(3000);
    
    // Check if Defense tab is actually active by looking for Defense-specific content
    const defenseTabActive = await page.evaluate(() => {
      // Check if Defense tab button has active/selected state
      const defenseTab = Array.from(document.querySelectorAll<HTMLElement>('button, [role="tab"]')).find(
        el => (el.innerText || el.textContent || '').trim().toLowerCase() === 'defense'
      );
      if (defenseTab) {
        const ariaSelected = defenseTab.getAttribute('aria-selected');
        const hasActiveClass = defenseTab.className.includes('active') || defenseTab.className.includes('selected');
        return ariaSelected === 'true' || hasActiveClass;
      }
      return false;
    });
    
    if (!defenseTabActive) {
      console.log('   ⚠️ Defense tab may not be active, trying to click again...');
      // Try clicking again
      try {
        const defenseTab = page.getByText(/^defense$/i).first();
        await defenseTab.click({ timeout: 5000 });
        await page.waitForTimeout(3000);
      } catch {
        // Continue anyway
      }
    }
    
    // Check if page is still open
    if (page.isClosed()) {
      console.log('   ⚠️ Page was closed, cannot extract data');
      return [];
    }
    
    // If we still don't have data, try the original extraction method
    if (allDefenseRows.length === 0) {
      console.log('   🔍 Looking for Opponent Positional Strength data (fallback)...');
      const fallbackRows = await page.evaluate(() => {
      const results: Array<{ position: string; rank: string }> = [];
      
      // Strategy 1: Find the active Defense tab panel content
      let container: HTMLElement | null = null;
      
      // Find the Defense tab button to locate its associated content
      const defenseTab = Array.from(document.querySelectorAll<HTMLElement>('button, [role="tab"]')).find(
        el => (el.innerText || el.textContent || '').trim().toLowerCase() === 'defense'
      );
      
      if (defenseTab) {
        // Try to find associated tabpanel
        const tabId = defenseTab.getAttribute('aria-controls') || defenseTab.id;
        if (tabId) {
          container = document.getElementById(tabId) || document.querySelector(`[id="${tabId}"]`) as HTMLElement;
        }
        
        // If no ID match, look for tabpanel with matching aria-labelledby
        if (!container) {
          const tabLabelId = defenseTab.getAttribute('aria-labelledby') || defenseTab.getAttribute('id');
          if (tabLabelId) {
            container = document.querySelector(`[aria-labelledby="${tabLabelId}"], [aria-labelledby*="${tabLabelId}"]`) as HTMLElement;
          }
        }
        
        // If still not found, look for next sibling or parent's next sibling
        if (!container) {
          let nextSibling = defenseTab.nextElementSibling as HTMLElement;
          while (nextSibling && !container) {
            if (nextSibling.getAttribute('role') === 'tabpanel' || 
                nextSibling.classList.toString().toLowerCase().includes('panel') ||
                nextSibling.classList.toString().toLowerCase().includes('content')) {
              container = nextSibling;
              break;
            }
            nextSibling = nextSibling.nextElementSibling as HTMLElement;
          }
        }
        
        // Look for parent container that might hold the tab content
        if (!container) {
          let parent = defenseTab.parentElement;
          while (parent && !container) {
            const tabpanel = parent.querySelector('[role="tabpanel"]') as HTMLElement;
            if (tabpanel) {
              container = tabpanel;
              break;
            }
            parent = parent.parentElement;
          }
        }
      }
      
      // Strategy 2: Find by heading text "Opponent Positional Strength" or similar
      if (!container) {
        const headings = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, strong, span, div, p, label'));
      for (const h of headings) {
          const txt = (h.innerText || h.textContent || '').trim().toLowerCase();
          // Look for various forms of "opponent positional strength"
          if ((txt.includes('opponent') && (txt.includes('positional') || txt.includes('strength') || txt.includes('rank'))) ||
              txt.includes('positional strength') ||
              txt.includes('opponent rank') ||
              (txt.includes('vs') && txt.includes('position'))) {
            // Find the closest meaningful container
            let parent = h.parentElement;
            let depth = 0;
            while (parent && depth < 5) {
              const parentText = (parent.innerText || parent.textContent || '').trim();
              // Make sure this container has position data
              if (/(RW|LW|C|D|G)\s+\d+/i.test(parentText)) {
                container = parent;
                break;
              }
              parent = parent.parentElement;
              depth++;
            }
            if (!container) {
          container = h.closest('section') || 
                     h.closest('div') || 
                     h.closest('article') ||
                     (h.parentElement as HTMLElement | null);
            }
            if (container) break;
          }
        }
      }
      
      // Strategy 3: Find active tabpanel (most likely Defense tab content)
      if (!container) {
        const activeTabpanel = document.querySelector('[role="tabpanel"][aria-hidden="false"], [role="tabpanel"]:not([aria-hidden="true"])') as HTMLElement;
        if (activeTabpanel) {
          container = activeTabpanel;
        }
      }
      
      // Strategy 4: Look for div-based structures with position data anywhere in Defense tab area
      if (!container) {
        const allDivs = Array.from(document.querySelectorAll<HTMLElement>('div'));
        for (const div of allDivs) {
          const text = (div.innerText || div.textContent || '').trim();
          // Look for patterns like "RW 25th", "C 12th", "LW 7th", or just "RW 25", "C 12"
          if (/(RW|LW|C|D|G|Center|Left|Right|Defense|Wing|Goalie)\s+\d+(?:th|st|nd|rd|\s*rank)?/i.test(text)) {
            // Make sure this div is visible and not hidden
            const style = window.getComputedStyle(div);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
            container = div;
            break;
            }
          }
        }
      }
      
      // Strategy 5: Find by table text
      if (!container) {
        const tables = Array.from(document.querySelectorAll<HTMLTableElement>('table'));
        for (const t of tables) {
          const tableText = (t.innerText || '').toLowerCase();
          if (tableText.includes('opponent') && 
              (tableText.includes('positional') || tableText.includes('strength') || tableText.includes('rank'))) {
            container = t;
            break;
          }
        }
      }
      
      // Strategy 6: Look for grid/flex containers that might hold position cards
      if (!container) {
        const gridContainers = Array.from(document.querySelectorAll<HTMLElement>('[class*="grid"], [class*="flex"], [class*="card"], [class*="grid-cols"]'));
        for (const grid of gridContainers) {
          const text = (grid.innerText || grid.textContent || '').trim();
          // Look for multiple position-rank pairs (at least 2) to ensure it's the right section
          const matches = text.match(/\b(RW|LW|C|D|G)\s+\d+/gi);
          if (matches && matches.length >= 2) {
            const style = window.getComputedStyle(grid);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              container = grid;
              break;
            }
          }
        }
      }
      
      // Strategy 7: Look for any section that contains multiple position abbreviations with numbers
      // This might be the actual data even if not in a labeled container
      if (!container) {
        const allSections = Array.from(document.querySelectorAll<HTMLElement>('section, div, article'));
        for (const section of allSections) {
          const text = (section.innerText || section.textContent || '').trim();
          // Look for at least 3 position-rank pairs to ensure it's the positional strength data
          const matches = text.match(/\b(RW|LW|C|D|G)\s+\d+(?:th|st|nd|rd)?/gi);
          if (matches && matches.length >= 3) {
            const style = window.getComputedStyle(section);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              // Make sure it's not just the player's own position info
              if (!text.includes('6\'') && !text.includes('height') && !text.includes('weight')) {
              container = section;
              break;
              }
            }
          }
        }
      }
      
      if (!container) {
        console.warn('No container found for defense data');
        return results;
      }
      
      // Extract data from container - handle both table and div structures
      // Look for stat categories with ranks (e.g., "Shots on Goal 25th", etc.)
      const statCategories = [
        'Shots on Goal', 'Shots', 'SOG',
        'Faceoffs Won', 'FOW', 'Face Off Wins',
        'Hits',
        'Points', 'Pts',
        'Goals Allowed', 'GA',
        'Goalie Saves', 'Saves', 'SV',
        'Blocked Shots', 'Blocks',
        'Time On Ice', 'TOI',
        'Faceoffs Lost', 'FOL',
        'Faceoffs', 'FO'
      ];
      
      // Strategy 1: Check if table exists first (most reliable source)
        const table = container.tagName === 'TABLE' 
          ? (container as HTMLTableElement)
          : (container.querySelector('table') as HTMLTableElement | null);
        
      // Strategy 2: Look for structured data in table rows (most common format) - prioritize if table exists
        if (table) {
          const trs = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr, tr'));
          for (const tr of trs) {
            const cells = Array.from(tr.querySelectorAll<HTMLElement>('td, th'));
            if (cells.length >= 2) {
            const statName = (cells[0]?.innerText || cells[0]?.textContent || '').trim();
              const rankText = (cells[1]?.innerText || cells[1]?.textContent || '').trim();
              
            // Check if statName matches any of our stat categories (case-insensitive)
            const matchedStat = statCategories.find(s => 
              statName.toLowerCase().includes(s.toLowerCase()) || 
              s.toLowerCase().includes(statName.toLowerCase())
            );
            
            // Also check for position abbreviations as fallback
            const isPosition = /^(RW|LW|C|D|G|Center|Left|Right|Defense|Wing|Goalie)$/i.test(statName);
            
            const isValidStat = matchedStat || isPosition || statName.length > 0;
              const isValidRank = rankText.length > 0 && 
                                 (/\d/.test(rankText) || /rank|th|st|nd|rd/i.test(rankText));
              
            if (isValidStat && isValidRank) {
              let rank = rankText;
              if (!/th|st|nd|rd/i.test(rank) && /\d+/.test(rank)) {
                rank = rank.replace(/\d+/, (m) => m + 'th');
              }
              const position = matchedStat || statName;
              results.push({ position, rank });
            }
          }
        }
      }
      
      // Strategy 3: If no table or no results from table, try text matching
      if (results.length === 0) {
        const containerText = (container.innerText || container.textContent || '').trim();
        
        // Look for stat category names followed by ranks in text
        for (const stat of statCategories) {
          // Pattern: "Stat Name" followed by rank (e.g., "Shots on Goal 25th", "Assists 12th")
          const pattern = new RegExp(`(${stat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s+(\\d+(?:th|st|nd|rd))`, 'gi');
          let match;
          while ((match = pattern.exec(containerText)) !== null) {
            const position = match[1].trim();
            const rank = match[2].trim();
            if (position && rank) {
              results.push({ position, rank });
            }
          }
        }
      }
      
      // Strategy 4: Look for structured data in div/grid layouts (card-based UI) - only if still no results
      if (results.length === 0) {
        const childElements = Array.from(container.querySelectorAll<HTMLElement>('div, span, p, li, [class*="card"], [class*="item"]'));
        for (const el of childElements) {
          const text = (el.innerText || el.textContent || '').trim();
          
          // Try to match stat categories
          for (const stat of statCategories) {
            const pattern = new RegExp(`(${stat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s+(\\d+(?:th|st|nd|rd|\\s*rank)?)`, 'gi');
            const match = text.match(pattern);
            if (match) {
              const fullMatch = match[0];
              const parts = fullMatch.split(/\s+/);
              const rankPart = parts[parts.length - 1];
              const statPart = parts.slice(0, -1).join(' ');
              
              if (statPart && rankPart) {
                let rank = rankPart.trim();
                if (!/th|st|nd|rd/i.test(rank) && /\d+/.test(rank)) {
                  rank = rank + 'th';
                }
                results.push({ position: statPart.trim(), rank });
              }
            }
          }
          
          // Fallback: Look for position abbreviations
          const positionMatch = text.match(/\b(RW|LW|C|D|G)\s+(\d+(?:th|st|nd|rd)|\d+)\b/i);
          if (positionMatch) {
            const position = positionMatch[1].trim();
            let rank = positionMatch[2].trim();
            if (!/th|st|nd|rd/i.test(rank)) {
              rank = rank + 'th';
            }
            results.push({ position, rank });
          }
        }
      }
      
      // Strategy 5: Additional fallback - parse any remaining div-based structures
      if (results.length === 0) {
        const rows = Array.from(container.querySelectorAll<HTMLElement>('div, span, p'));
        for (const row of rows) {
          const text = (row.innerText || row.textContent || '').trim();
          
          // Try stat categories first
          for (const stat of statCategories) {
            const pattern = new RegExp(`(${stat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s+(\\d+(?:th|st|nd|rd))`, 'gi');
            const match = text.match(pattern);
          if (match) {
              const fullMatch = match[0];
              const parts = fullMatch.split(/\s+(?=\d)/);
              if (parts.length >= 2) {
                const statPart = parts.slice(0, -1).join(' ').trim();
                let rank = parts[parts.length - 1].trim();
                if (!/th|st|nd|rd/i.test(rank) && /\d+/.test(rank)) {
                  rank = rank + 'th';
                }
                results.push({ position: statPart, rank });
              }
            }
          }
          
          // Fallback: position abbreviations
          const positionMatch = text.match(/\b(RW|LW|C|D|G|Center|Left|Right|Defense|Wing|Goalie)\s+(\d+(?:th|st|nd|rd)|\d+)\b/i);
          if (positionMatch) {
            let rank = positionMatch[2].trim();
            if (!/th|st|nd|rd/i.test(rank)) {
              rank = rank + 'th';
            }
            results.push({ position: positionMatch[1].trim(), rank });
          }
        }
      }
      
      // Remove duplicates
      const uniqueResults = new Map<string, { position: string; rank: string }>();
      for (const result of results) {
        const key = `${result.position}-${result.rank}`;
        if (!uniqueResults.has(key)) {
          uniqueResults.set(key, result);
        }
      }
      
      return Array.from(uniqueResults.values());
    });
    
    allDefenseRows.push(...fallbackRows);
    }
    
    if (allDefenseRows.length === 0) {
      console.log('   ⚠️ No defense positional strength data found');
      
      // Debug: Show what's actually on the page - look more broadly
      const pageContent = await page.evaluate(() => {
        // Try multiple selectors for Defense tab content
        let defenseTabContent = document.querySelector('[role="tabpanel"]') as HTMLElement;
        if (!defenseTabContent) {
          defenseTabContent = document.querySelector('[class*="tab-content"]') as HTMLElement;
        }
        if (!defenseTabContent) {
          defenseTabContent = document.querySelector('[class*="panel"]') as HTMLElement;
        }
        if (!defenseTabContent) {
          // Look for content that appears after clicking Defense tab
          const allDivs = Array.from(document.querySelectorAll<HTMLElement>('div'));
          for (const div of allDivs) {
            const text = (div.innerText || div.textContent || '').toLowerCase();
            if (text.includes('opponent') && text.includes('positional')) {
              defenseTabContent = div;
              break;
            }
          }
        }
        
        // Get all text content that might contain position data
        const allText = document.body.innerText || document.body.textContent || '';
        const positionMatches = allText.match(/\b(RW|LW|C|D|G)\s+\d+/gi);
        const rankMatches = allText.match(/\d+(?:th|st|nd|rd)\b/gi);
        
        // Find elements containing position abbreviations
        const positionElements: Array<{text: string, tag: string, classes: string}> = [];
        const allElements = Array.from(document.querySelectorAll<HTMLElement>('*'));
        for (const el of allElements) {
          const text = (el.innerText || el.textContent || '').trim();
          if (/\b(RW|LW|C|D|G)\s*\d+/i.test(text) && text.length < 100) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              positionElements.push({
                text: text.substring(0, 50),
                tag: el.tagName,
                classes: el.className?.toString() || ''
              });
            }
          }
        }
        
        if (defenseTabContent) {
          return {
            text: (defenseTabContent.innerText || defenseTabContent.textContent || '').substring(0, 1500),
            html: defenseTabContent.innerHTML?.substring(0, 3000) || '',
            tables: Array.from(defenseTabContent.querySelectorAll('table')).length,
            divs: Array.from(defenseTabContent.querySelectorAll('div')).length,
            positionMatches: positionMatches?.slice(0, 20) || [],
            rankMatches: rankMatches?.slice(0, 20) || [],
            positionElements: positionElements.slice(0, 20)
          };
        }
        
        // If no specific tab content found, check entire body
        return {
          text: allText.substring(0, 1500),
          html: document.body.innerHTML?.substring(0, 3000) || '',
          tables: Array.from(document.querySelectorAll('table')).length,
          divs: Array.from(document.querySelectorAll('div')).length,
          positionMatches: positionMatches?.slice(0, 20) || [],
          rankMatches: rankMatches?.slice(0, 20) || [],
          positionElements: positionElements.slice(0, 20)
        };
      });
      
      if (pageContent) {
        console.log(`   📄 Defense tab content preview: ${pageContent.text.substring(0, 800)}...`);
        console.log(`   📊 Tables found: ${pageContent.tables}, Divs found: ${pageContent.divs}`);
        
        if (pageContent.positionMatches && pageContent.positionMatches.length > 0) {
          console.log(`   🔍 Found position-number patterns: ${pageContent.positionMatches.slice(0, 10).join(', ')}`);
        }
        
        if (pageContent.rankMatches && pageContent.rankMatches.length > 0) {
          console.log(`   🔍 Found rank patterns: ${pageContent.rankMatches.slice(0, 10).join(', ')}`);
        }
        
        if (pageContent.positionElements && pageContent.positionElements.length > 0) {
          console.log(`   🔍 Found ${pageContent.positionElements.length} elements with position data:`);
          pageContent.positionElements.slice(0, 5).forEach((el, i) => {
            console.log(`      ${i + 1}. [${el.tag}] "${el.text}" (classes: ${el.classes.substring(0, 50)})`);
          });
        }
      }
      
      return [];
    }
    
    // Transform to DefenseData format (team-based, not player-based)
    const defenseData: DefenseData[] = allDefenseRows.map(row => ({
      team: team,
      opponent: opponent,
      gameTime: gameTime,
      stat: row.position, // The "position" field actually contains stat names like "Shots on Goal", "Assists", etc.
      rank: row.rank,
    }));
    
    console.log(`   ✅ Found ${defenseData.length} defense position entries`);
    return defenseData;
  } catch (error: any) {
    console.error(`❌ Error scraping defense data from ${playerUrl}:`, error.message);
    return [];
  }
}

/**
 * Upload defense data to Google Sheets
 */
async function uploadDefenseDataToSheets(defenseData: DefenseData[]): Promise<void> {
  if (!defenseData.length) {
    console.log('ℹ️ No defense data to upload.');
    return;
  }

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`❌ service_account.json not found at ${SERVICE_ACCOUNT_PATH}`);
    return;
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.error('❌ SPREADSHEET_ID env var is not set');
    return;
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

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const sheetTitle = `Defense_${yyyy}-${mm}-${dd}`;

  // Create sheet if needed
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = meta.data.sheets?.find(s => s.properties?.title === sheetTitle);
    if (!existing) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetTitle,
                },
              },
            },
          ],
        },
      });
      console.log(`📝 Created new sheet tab: ${sheetTitle}`);
    }
  } catch (err: any) {
    console.error('⚠️ Failed to ensure sheet exists:', err.message || err);
  }

  // Prepare header
  const header = [
    'Team',
    'Opponent',
    'Game Time',
    'Position',
    'Rank',
  ];

  // Ensure header exists
  try {
    const headerRange = `${sheetTitle}!A1:E1`;
    const existingHeader = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: headerRange,
    });
    const hasHeader =
      existingHeader.data.values && existingHeader.data.values.length > 0;
    if (!hasHeader) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: headerRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [header],
        },
      });
    }
  } catch (err: any) {
    console.error('⚠️ Failed to ensure header:', err.message || err);
  }

  // Prepare rows with properly formatted game times
  const values: any[][] = [];
  
  for (const data of defenseData) {
    // Format game time for Google Sheets (convert to time value if possible)
    const formattedGameTime = formatGameTimeForSheets(data.gameTime);
    
    values.push([
      data.team,
      data.opponent,
      formattedGameTime,
      data.stat,
      data.rank,
    ]);
  }

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetTitle}!A2`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values,
      },
    });
    console.log(`✅ Uploaded ${values.length} defense rows to Google Sheets (${sheetTitle})`);
  } catch (err: any) {
    console.error('❌ Failed to upload to Google Sheets:', err.message || err);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 PickFinder Today\'s Teams Defense Scraper\n');
  console.log('='.repeat(60));

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // Launch browser with larger window
    browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--start-maximized', // Maximize the window
      ],
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }, // Fixed viewport to prevent zoom issues
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      deviceScaleFactor: 1, // Disable automatic zoom/device emulation
    });

    await loadCookies(context);
    page = await context.newPage();

    // Navigate to PickFinder
    console.log('🌐 Opening PickFinder...');
    await page.goto('https://www.pickfinder.app/', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    // Handle login if needed
    if (await isSignedOut(page)) {
      console.log('🔐 Login required...');
      await handleGoogleLogin(page, process.env.GOOGLE_EMAIL, process.env.GOOGLE_PASSWORD);
      await saveCookies(context);
    }

    // Navigate to NHL projections page to get today's games
    console.log('🧭 Navigating to NHL projections...');
    await page.goto('https://www.pickfinder.app/projections/nhl', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await page.waitForTimeout(5000);

    // Get today's NHL games
    const todayGames = await scrapeTodayGames(page);
    
    if (todayGames.length === 0) {
      console.log('⚠️ No games found for today');
      return;
    }

    console.log(`\n📊 Found ${todayGames.length} games for today\n`);

    // Collect all unique teams from today's games
    const teamsToProcess = new Set<string>();
    const teamGameInfo = new Map<string, { opponent: string; gameTime: string }>();
    
    for (const game of todayGames) {
      teamsToProcess.add(game.teamA);
      teamsToProcess.add(game.teamB);
      // Store opponent and game time for each team
      teamGameInfo.set(game.teamA, { opponent: game.teamB, gameTime: game.gameTime });
      teamGameInfo.set(game.teamB, { opponent: game.teamA, gameTime: game.gameTime });
    }

    console.log(`🏒 Processing ${teamsToProcess.size} teams from today's games\n`);

    // Scrape defense data for each team
    const allDefenseData: DefenseData[] = [];
    const teamsArray = Array.from(teamsToProcess);

    for (let i = 0; i < teamsArray.length; i++) {
      const team = teamsArray[i];
      const gameInfo = teamGameInfo.get(team);
      if (!gameInfo) continue;
      
      console.log(`\n[${i + 1}/${teamsArray.length}] Processing team: ${team} (vs ${gameInfo.opponent})`);
      
      try {
        // Check if page/context is still valid
        if (page.isClosed()) {
          console.error(`   ❌ Page was closed, cannot continue`);
          break;
        }
        
        // Find any player URL for this team (just as a doorway)
        const playerUrl = await getPlayerUrlForTeam(page, team);
        if (!playerUrl) {
          console.log(`   ⚠️ Could not find a player page for team ${team}, skipping...`);
          continue;
        }
        
        console.log(`   🔗 Using player page as doorway: ${playerUrl.substring(0, 80)}...`);
        
        // Scrape defense data (team-based, not player-based)
        const defenseData = await scrapeDefenseData(page, playerUrl, team, gameInfo.opponent, gameInfo.gameTime);
        if (defenseData && defenseData.length > 0) {
          allDefenseData.push(...defenseData);
          console.log(`   ✅ Collected ${defenseData.length} defense stat entries for ${team}`);
        } else {
          console.log(`   ⚠️ No defense data found for ${team}`);
        }
        
        // Return to projections page for next team
        if (i < teamsArray.length - 1) {
          try {
            await page.goto('https://www.pickfinder.app/projections/nhl', {
              waitUntil: 'networkidle',
              timeout: 60000,
            });
            await page.waitForTimeout(2000);
          } catch (navError: any) {
            console.error(`   ⚠️ Error navigating back to projections: ${navError.message}`);
            // Try to continue with next team
            continue;
          }
        }
      } catch (error: any) {
        console.error(`   ❌ Error processing team ${team}:`, error.message);
        // Don't break - continue with next team
        if (!page.isClosed() && i < teamsArray.length - 1) {
          try {
            await page.goto('https://www.pickfinder.app/projections/nhl', {
              waitUntil: 'networkidle',
              timeout: 60000,
            }).catch(() => {});
          } catch {
            // Ignore navigation errors
          }
        }
      }
    }

    console.log(`\n📊 Total defense entries collected: ${allDefenseData.length}`);

    // Upload to Google Sheets
    if (allDefenseData.length > 0) {
      console.log('\n📤 Uploading defense data to Google Sheets...');
      await uploadDefenseDataToSheets(allDefenseData);
    }

    // Save to local JSON
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputFile = path.join(outputDir, `defense_${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(allDefenseData, null, 2));
    console.log(`\n💾 Data saved to: ${outputFile}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Scraping completed successfully!');
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error?.message || error);
    console.error(error?.stack);
    process.exit(1);
  } finally {
    if (browser) {
      console.log('\n⏳ Keeping browser open for 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      await browser.close();
    }
  }
}

main();

