/**
 * Scrape PrizePicks player props from their public API
 */
import { PrizePicksProp } from './types';

const PRIZEPICKS_API_URL = 'https://api.prizepicks.com/projections';

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
 * Map PrizePicks stat type to our stat categories
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
  };

  return statMap[statType] || statType;
}

/**
 * Map PrizePicks team abbreviation to standard format
 */
function normalizeTeamName(teamName: string): string {
  // PrizePicks might use different team abbreviations
  // Map common variations to standard NHL abbreviations
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
    'NYI': 'NYI',
    'NYR': 'NYR',
    'OTT': 'OTT',
    'PHI': 'PHI',
    'PIT': 'PIT',
    'SJS': 'SJS',
    'SEA': 'SEA',
    'STL': 'STL',
    'TBL': 'TBL',
    'TOR': 'TOR',
    'UTA': 'UTA',
    'VAN': 'VAN',
    'VGK': 'VGK',
    'WSH': 'WSH',
    'WPG': 'WPG',
  };

  const upper = teamName.toUpperCase().trim();
  return teamMap[upper] || upper;
}

/**
 * Scrape PrizePicks player props for today's games
 */
export async function scrapePrizePicksProps(): Promise<PrizePicksProp[]> {
  console.log('🎯 Scraping PrizePicks props...');

  try {
    // Try with different query parameters for NHL
    const urls = [
      PRIZEPICKS_API_URL,
      `${PRIZEPICKS_API_URL}?league=NHL`,
      `${PRIZEPICKS_API_URL}?sport=NHL`,
      `${PRIZEPICKS_API_URL}?league_id=7`, // Common NHL league ID
    ];

    let data: any = null;
    let lastError: Error | null = null;

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        
        if (!response.ok) {
          lastError = new Error(`PrizePicks API returned ${response.status}: ${response.statusText}`);
          continue;
        }

        data = await response.json();
        
        // Log API response structure for debugging
        console.log(`🔍 PrizePicks API response keys: ${Object.keys(data).join(', ')}`);
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          console.log(`🔍 Sample projection structure:`, JSON.stringify(Object.keys(data.data[0]), null, 2));
        }
        break;
      } catch (err: any) {
        lastError = err;
        continue;
      }
    }

    if (!data) {
      throw lastError || new Error('Failed to fetch from PrizePicks API');
    }
    
    // PrizePicks API structure may vary, so we need to handle different response formats
    // Common structure: { data: [...] } or direct array
    const projections = data.data || data.included || data || [];

    if (!Array.isArray(projections)) {
      console.warn('⚠️ PrizePicks API returned unexpected format:', typeof data);
      console.warn('⚠️ Response structure:', JSON.stringify(data, null, 2).substring(0, 500));
      return [];
    }

    // PrizePicks uses JSON:API format with relationships
    // The `included` array contains related resources (players, teams, leagues, etc.)
    const included = data.included || [];
    const playerMap = new Map();
    const teamMap = new Map();
    const leagueMap = new Map();

    // NHL team abbreviations for validation (complete list, no NBA teams)
    const nhlTeams = new Set([
      'ARI', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ', 'DAL', 'DET',
      'EDM', 'FLA', 'LAK', 'LA', 'MIN', 'MTL', 'NSH', 'NJD', 'NJ', 'NYI', 'NYR',
      'OTT', 'PHI', 'PIT', 'SJS', 'SJ', 'SEA', 'STL', 'TBL', 'TB', 'TOR',
      'VAN', 'VGK', 'VEG', 'WSH', 'WAS', 'WPG', 'WIN', 'ANA'
    ]);

    // Build maps from included resources
    const gameMap = new Map(); // Map game IDs to game objects
    
    for (const item of included) {
      if (item.type === 'new_player' || item.type === 'player') {
        const attrs = item.attributes || {};
        playerMap.set(item.id, {
          name: attrs.name || attrs.display_name || attrs.full_name || '',
          team: attrs.team || attrs.team_abbreviation || '',
        });
      }
      if (item.type === 'new_team' || item.type === 'team') {
        const attrs = item.attributes || {};
        teamMap.set(item.id, attrs.abbreviation || attrs.name || '');
      }
      // Map games for opponent lookup
      if (item.type === 'new_game' || item.type === 'game') {
        gameMap.set(item.id, item);
      }
      // Map leagues to check if they're NHL
      if (item.type === 'new_league' || item.type === 'league' || item.type === 'sport') {
        const attrs = item.attributes || {};
        const leagueName = (attrs.name || attrs.display_name || '').toUpperCase();
        const isNHL = leagueName === 'NHL' || 
                      String(attrs.id || attrs.league_id || '') === '7' ||
                      leagueName.includes('HOCKEY');
        leagueMap.set(item.id, { isNHL, name: leagueName });
      }
    }

    const today = getTodayDateString();
    const props: PrizePicksProp[] = [];
    
    console.log(`📅 Looking for props dated: ${today}`);
    console.log(`📊 Processing ${projections.length} projections`);

    for (const projection of projections) {
      // Log projection type for debugging
      if (projections.length > 0 && props.length === 0 && projection === projections[0]) {
        console.log(`🔍 First projection type: ${projection.type}`);
        console.log(`🔍 First projection attributes keys: ${Object.keys(projection.attributes || {}).join(', ')}`);
      }
      
      // Skip if not a projection type
      if (projection.type !== 'new_projection' && projection.type !== 'projection') {
        continue;
      }

      const attrs = projection.attributes || {};
      const relationships = projection.relationships || {};

      // Check sport/league first - filter out non-NHL early
      let isNHL = false;
      
      // Check league relationship
      const leagueRel = relationships.league || relationships.sport || relationships.new_league;
      const leagueId = leagueRel?.data?.id;
      if (leagueId) {
        const leagueInfo = leagueMap.get(leagueId);
        if (leagueInfo && leagueInfo.isNHL) {
          isNHL = true;
        } else if (String(leagueId) === '7') {
          isNHL = true;
        }
      }
      
      // Also check attributes for league
      if (!isNHL) {
        const league = attrs.league || attrs.sport || attrs.league_id || '';
        if (String(league) === '7' || league.toUpperCase() === 'NHL') {
          isNHL = true;
        }
      }
      
      // If we still don't know, skip it (be conservative)
      if (!isNHL) {
        continue;
      }

      // Extract stat and line from attributes
      const statType = attrs.stat_type || attrs.stat_display_name || attrs.stat || '';
      const statCategory = normalizeStatType(statType);
      
      // Filter to only allowed stats (same as Underdog)
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
      
      const statLower = statCategory.toLowerCase();
      const isAllowedStat = allowedStats.some(allowed => 
        statLower === allowed.toLowerCase() ||
        statLower.includes(allowed.toLowerCase()) ||
        allowed.toLowerCase().includes(statLower)
      );
      
      if (!isAllowedStat) {
        continue; // Skip props with non-allowed stats
      }
      
      // Line might be in different fields - log first NHL projection to debug
      if (props.length === 0 && statCategory && statCategory !== statType) {
        console.log(`🔍 Sample NHL projection - stat_type: ${statType}, statCategory: ${statCategory}`);
        console.log(`🔍 Line fields - line: ${attrs.line}, line_score: ${attrs.line_score}, over_under: ${attrs.over_under}, flash_sale: ${attrs.flash_sale_line_score}`);
      }
      
      // Line might be in different fields
      const line = parseFloat(
        attrs.line || 
        attrs.line_score || 
        attrs.over_under || 
        attrs.flash_sale_line_score ||
        0
      );
      const projectionId = projection.id || '';

      // Get player from relationships
      const playerRel = relationships.new_player || relationships.player;
      const playerId = playerRel?.data?.id;
      const player = playerId ? playerMap.get(playerId) : null;

      if (!player) continue;

      const playerName = player.name || '';
      const team = normalizeTeamName(player.team || '');

      // Validate team is NHL team
      if (!nhlTeams.has(team)) {
        continue;
      }

      // Get opponent team - might be in relationships or attributes
      let opponent = '';
      
      // Try relationships first - check all possible opponent relationship keys
      const opponentTeamRel = relationships.opponent_team || relationships.opponent || relationships.away_team || relationships.home_team;
      if (opponentTeamRel?.data?.id) {
        opponent = normalizeTeamName(teamMap.get(opponentTeamRel.data.id) || '');
      }
      
      // Try attributes
      if (!opponent) {
        opponent = normalizeTeamName(attrs.opponent || attrs.opponent_team || attrs.away_team || attrs.home_team || '');
      }
      
      // Try to get from game relationship - enhanced version
      if (!opponent) {
        const gameRel = relationships.game || relationships.new_game;
        if (gameRel?.data?.id) {
          const game = gameMap.get(gameRel.data.id);
          if (game) {
            const gameAttrs = game.attributes || {};
            const gameRels = game.relationships || {};
            
            // Try to get teams from game relationships
            // PrizePicks uses away_team_data and home_team_data
            const homeTeamRel = gameRels.home_team || gameRels.home_team_id || gameRels.home_team_data;
            const awayTeamRel = gameRels.away_team || gameRels.away_team_id || gameRels.away_team_data;
            
            let homeTeam = '';
            let awayTeam = '';
            
            // Extract from relationships (could be data.id or direct data)
            if (homeTeamRel?.data?.id) {
              homeTeam = normalizeTeamName(teamMap.get(homeTeamRel.data.id) || '');
            } else if (homeTeamRel?.data) {
              // Sometimes the data is directly in the relationship
              const teamId = typeof homeTeamRel.data === 'string' ? homeTeamRel.data : homeTeamRel.data.id;
              homeTeam = normalizeTeamName(teamMap.get(teamId) || '');
            }
            
            if (awayTeamRel?.data?.id) {
              awayTeam = normalizeTeamName(teamMap.get(awayTeamRel.data.id) || '');
            } else if (awayTeamRel?.data) {
              // Sometimes the data is directly in the relationship
              const teamId = typeof awayTeamRel.data === 'string' ? awayTeamRel.data : awayTeamRel.data.id;
              awayTeam = normalizeTeamName(teamMap.get(teamId) || '');
            }
            
            // If we still don't have teams, try to find them in included resources
            // Look for teams that are referenced by this game
            if ((!homeTeam || !awayTeam) && gameRels.home_team_data?.data || gameRels.away_team_data?.data) {
              // The team data might be in included resources with type 'team' or 'new_team'
              // and they might be linked via the game relationship
              const homeTeamDataId = gameRels.home_team_data?.data?.id;
              const awayTeamDataId = gameRels.away_team_data?.data?.id;
              
              if (homeTeamDataId && !homeTeam) {
                const homeTeamItem = included.find((item: any) => 
                  (item.type === 'team' || item.type === 'new_team') && item.id === homeTeamDataId
                );
                if (homeTeamItem) {
                  const homeAttrs = homeTeamItem.attributes || {};
                  homeTeam = normalizeTeamName(homeAttrs.abbreviation || homeAttrs.name || '');
                }
              }
              
              if (awayTeamDataId && !awayTeam) {
                const awayTeamItem = included.find((item: any) => 
                  (item.type === 'team' || item.type === 'new_team') && item.id === awayTeamDataId
                );
                if (awayTeamItem) {
                  const awayAttrs = awayTeamItem.attributes || {};
                  awayTeam = normalizeTeamName(awayAttrs.abbreviation || awayAttrs.name || '');
                }
              }
            }
            
            // Also check if teams are in the included resources with the game relationship
            if (!homeTeam || !awayTeam) {
              // Look for team resources that reference this game
              const gameTeams = included.filter((item: any) => 
                (item.type === 'team' || item.type === 'new_team') &&
                item.relationships?.game?.data?.id === gameRel.data.id
              );
              
              for (const teamItem of gameTeams) {
                const teamAttrs = teamItem.attributes || {};
                const teamAbbr = normalizeTeamName(teamAttrs.abbreviation || teamAttrs.name || '');
                // Check if it's home or away based on relationship or attributes
                const isHome = teamItem.relationships?.home_game || teamAttrs.is_home;
                if (isHome && !homeTeam) {
                  homeTeam = teamAbbr;
                } else if (!isHome && !awayTeam) {
                  awayTeam = teamAbbr;
                }
              }
            }
            
            // Fallback to attributes
            if (!homeTeam) {
              homeTeam = normalizeTeamName(
                gameAttrs.home_team || 
                gameAttrs.home_team_abbreviation || 
                gameAttrs.home_team_name ||
                gameAttrs.home_team_id ||
                ''
              );
            }
            if (!awayTeam) {
              awayTeam = normalizeTeamName(
                gameAttrs.away_team || 
                gameAttrs.away_team_abbreviation || 
                gameAttrs.away_team_name ||
                gameAttrs.away_team_id ||
                ''
              );
            }
            
            // Get the other team (not the player's team)
            if (homeTeam && awayTeam) {
              opponent = team === homeTeam ? awayTeam : homeTeam;
            } else if (homeTeam && team !== homeTeam) {
              opponent = homeTeam;
            } else if (awayTeam && team !== awayTeam) {
              opponent = awayTeam;
            }
            
            // Debug logging for first few games
            if (props.length < 3 && !opponent) {
              console.log(`🔍 Debug - Game teams: home=${homeTeam}, away=${awayTeam}, playerTeam=${team}`);
              console.log(`🔍 Debug - Home team rel: ${JSON.stringify(homeTeamRel?.data || 'none')}`);
              console.log(`🔍 Debug - Away team rel: ${JSON.stringify(awayTeamRel?.data || 'none')}`);
              console.log(`🔍 Debug - TeamMap size: ${teamMap.size}, Sample keys: ${Array.from(teamMap.keys()).slice(0, 5).join(', ')}`);
              if (gameRels.home_team_data?.data?.id) {
                const homeId = gameRels.home_team_data.data.id;
                console.log(`🔍 Debug - Home team ID ${homeId} in teamMap: ${teamMap.has(homeId)}`);
                const homeTeamItem = included.find((item: any) => item.id === homeId);
                if (homeTeamItem) {
                  console.log(`🔍 Debug - Home team item found: type=${homeTeamItem.type}, attrs=${JSON.stringify(Object.keys(homeTeamItem.attributes || {}))}`);
                }
              }
              if (gameRels.away_team_data?.data?.id) {
                const awayId = gameRels.away_team_data.data.id;
                console.log(`🔍 Debug - Away team ID ${awayId} in teamMap: ${teamMap.has(awayId)}`);
                const awayTeamItem = included.find((item: any) => item.id === awayId);
                if (awayTeamItem) {
                  console.log(`🔍 Debug - Away team item found: type=${awayTeamItem.type}, attrs=${JSON.stringify(Object.keys(awayTeamItem.attributes || {}))}`);
                }
              }
            }
          }
        }
      }
      
      // Debug: Log first few props to see what we're getting
      if (props.length < 3 && !opponent) {
        console.log(`🔍 Debug - Player: ${playerName}, Team: ${team}`);
        console.log(`🔍 Debug - Relationships keys: ${Object.keys(relationships).join(', ')}`);
        const gameRel = relationships.game || relationships.new_game;
        if (gameRel?.data?.id) {
          const game = gameMap.get(gameRel.data.id);
          if (game) {
            console.log(`🔍 Debug - Game found: ${game.id}, type: ${game.type}`);
            console.log(`🔍 Debug - Game attributes keys: ${Object.keys(game.attributes || {}).join(', ')}`);
            console.log(`🔍 Debug - Game relationships keys: ${Object.keys(game.relationships || {}).join(', ')}`);
          } else {
            console.log(`🔍 Debug - Game ID ${gameRel.data.id} not found in gameMap`);
          }
        }
        console.log(`🔍 Debug - Attributes keys with 'opponent' or 'team': ${Object.keys(attrs).filter(k => k.toLowerCase().includes('opponent') || k.toLowerCase().includes('team')).join(', ')}`);
      }
      
      // Validate opponent is NHL team if we have it - STRICT FILTERING
      if (opponent && !nhlTeams.has(opponent)) {
        // Skip props with non-NHL opponents (e.g., HOU = Houston Rockets NBA)
        continue;
      }

      // Check date - might be in attributes or relationships
      // Be more lenient with date checking - if date is missing, still include it
      // (some props might not have explicit dates but are still for today)
      const projectionDate = attrs.date || attrs.game_date || attrs.start_time || attrs.starts_at || attrs.board_time || '';
      if (projectionDate) {
        try {
          const dateStr = new Date(projectionDate).toISOString().split('T')[0];
          // Only skip if date is explicitly in the past or future (more than 1 day)
          const dateDiff = Math.abs((new Date(dateStr).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
          if (dateDiff > 1) {
            continue;
          }
        } catch (e) {
          // If date parsing fails, continue anyway (might still be today's prop)
        }
      }
      // If no date, continue anyway - might still be today's prop

      if (playerName && team && statCategory && line > 0) {
        props.push({
          playerName,
          team,
          opponent,
          statCategory,
          line,
          projectionId: String(projectionId),
        });
      } else {
        // Log why prop was skipped
        if (props.length === 0 && projections.indexOf(projection) < 3) {
          console.log(`⏭️ Skipping prop - player: ${playerName}, team: ${team}, stat: ${statCategory}, line: ${line}`);
        }
      }
    }
    
    console.log(`📊 Processed ${projections.length} projections, found ${props.length} valid props`);

    console.log(`✅ Found ${props.length} PrizePicks props for today`);
    return props;
  } catch (error: any) {
    console.error('❌ Error scraping PrizePicks:', error.message);
    return [];
  }
}

