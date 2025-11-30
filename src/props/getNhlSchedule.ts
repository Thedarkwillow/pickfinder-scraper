/**
 * Get today's NHL schedule to help match opponents for props
 */
import { scrapeTodayGames, openBrowserWithSchedule } from '../schedule';
import { normalizeTeamName } from './underdog';

export interface GameMatchup {
  teamA: string;
  teamB: string;
  gameTime: string;
}

/**
 * Get today's NHL schedule
 * Returns a map of team -> opponent for easy lookup
 */
export async function getTodayNhlSchedule(): Promise<Map<string, string>> {
  console.log('📅 Fetching today\'s NHL schedule...');
  
  try {
    // Set a timeout for the entire schedule fetch operation
    const schedulePromise = (async () => {
      const { browser, page } = await openBrowserWithSchedule();
      
      try {
        const games = await scrapeTodayGames(page);
        
        // Create a map: team -> opponent
        const matchupMap = new Map<string, string>();
        
        for (const game of games) {
          const teamA = normalizeTeamName(game.teamA);
          const teamB = normalizeTeamName(game.teamB);
          
          if (teamA && teamB) {
            // Map both directions: teamA -> teamB and teamB -> teamA
            matchupMap.set(teamA, teamB);
            matchupMap.set(teamB, teamA);
          }
        }
        
        console.log(`✅ Found ${games.length} NHL games today`);
        if (games.length > 0) {
          console.log(`📊 Sample matchups:`);
          games.slice(0, 5).forEach(game => {
            console.log(`   ${normalizeTeamName(game.teamA)} vs ${normalizeTeamName(game.teamB)}`);
          });
        }
        
        await browser.close();
        return matchupMap;
      } catch (error: any) {
        await browser.close();
        throw error;
      }
    })();
    
    // Wait max 30 seconds for schedule fetch
    const timeoutPromise = new Promise<Map<string, string>>((resolve) => {
      setTimeout(() => {
        console.log('⏱️ Schedule fetch taking too long, continuing without it...');
        resolve(new Map<string, string>());
      }, 30000);
    });
    
    return await Promise.race([schedulePromise, timeoutPromise]);
  } catch (error: any) {
    console.error(`⚠️ Failed to fetch NHL schedule: ${error.message}`);
    console.log('💡 Continuing without schedule - opponent matching may be incomplete');
    return new Map<string, string>();
  }
}

/**
 * Get opponent for a team based on today's schedule
 */
export function getOpponentFromSchedule(
  team: string,
  schedule: Map<string, string>
): string | null {
  if (!team || !schedule) {
    return null;
  }
  
  const normalizedTeam = normalizeTeamName(team);
  return schedule.get(normalizedTeam) || null;
}

