/**
 * Map props to defense strength data
 */
import { DefenseData, PrizePicksProp, UnderdogProp, MergedProp } from './types';

/**
 * Extract player position from stat category or use a default mapping
 * This is a helper to determine if we should match by position or stat
 */
function extractPositionFromStat(stat: string): string | null {
  // Some stats are position-specific
  // For now, we'll try to match by stat category directly
  // The defense data uses stat categories in the "position" field
  return null; // We'll match by stat category, not player position
}

/**
 * Normalize stat names for matching
 */
function normalizeStatForMatching(stat: string): string {
  return stat
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '') // Remove special characters
    .trim();
}

/**
 * Normalize team names for matching - handle common variations
 */
function normalizeTeamForMatching(team: string): string {
  const teamVariations: Record<string, string> = {
    'LAK': 'LAK',
    'LA': 'LAK',
    'NJD': 'NJD',
    'NJ': 'NJD',
    'NYI': 'NYI',
    'NYR': 'NYR',
    'SJS': 'SJS',
    'SJ': 'SJS',
    'TBL': 'TBL',
    'TB': 'TBL',
    'VGK': 'VGK',
    'VEG': 'VGK',
    'WSH': 'WSH',
    'WAS': 'WSH',
    'WPG': 'WPG',
    'WIN': 'WPG',
  };
  
  const upper = team.toUpperCase().trim();
  return teamVariations[upper] || upper;
}

/**
 * Find matching defense strength for a prop
 * Matches by: opponent team + stat category
 */
function findDefenseStrength(
  defenseData: DefenseData[],
  team: string,
  opponent: string,
  statCategory: string
): string | null {
  if (!opponent || !statCategory) {
    return null;
  }

  const normalizedOpponent = normalizeTeamForMatching(opponent);
  const normalizedStat = normalizeStatForMatching(statCategory);

  // First, filter defense data to only entries matching the opponent
  const opponentMatches = defenseData.filter(
    (d) => normalizeTeamForMatching(d.opponent) === normalizedOpponent
  );

  if (opponentMatches.length === 0) {
    return null;
  }

  // Try exact match first: opponent team + stat category
  const exactMatch = opponentMatches.find(
    (d) => normalizeStatForMatching(d.position) === normalizedStat
  );

  if (exactMatch) {
    return exactMatch.rank;
  }

  // Try partial match on stat category (e.g., "Shots on Goal" matches "Shots")
  const partialMatch = opponentMatches.find(
    (d) => {
      const defenseStat = normalizeStatForMatching(d.position);
      return (
        defenseStat.includes(normalizedStat) ||
        normalizedStat.includes(defenseStat) ||
        defenseStat === normalizedStat
      );
    }
  );

  if (partialMatch) {
    return partialMatch.rank;
  }

  // Try matching with common stat aliases - improved mapping
  const statAliases: Record<string, string[]> = {
    'points': ['pts', 'point', 'points'],
    'goals': ['goal', 'goals'],
    'assists': ['asts', 'assist', 'assists'],
    'shots on goal': ['sog', 'shots', 'shot', 'shots on goal', 'shot on goal'],
    'hits': ['hit', 'hits'],
    'blocked shots': ['blocks', 'blocked', 'blocked shots', 'block'],
    'time on ice': ['toi', 'time', 'time on ice'],
    'faceoffs won': ['fow', 'faceoff won', 'faceoffs won', 'face off won'],
    'faceoffs lost': ['fol', 'faceoff lost', 'faceoffs lost', 'face off lost'],
    'faceoffs': ['fo', 'faceoff', 'faceoffs', 'face off'],
    'goals allowed': ['ga', 'goals allowed', 'goal allowed'],
    'goalie saves': ['saves', 'sv', 'save', 'goalie saves', 'goalie save'],
  };

  // Check if the prop stat matches any alias key
  for (const [key, aliases] of Object.entries(statAliases)) {
    const propMatchesAlias = aliases.some(
      (alias) => normalizedStat === alias || normalizedStat.includes(alias) || alias.includes(normalizedStat)
    );
    
    if (propMatchesAlias) {
      // Now find defense data that matches this key
      const aliasMatch = opponentMatches.find(
        (d) => {
          const defenseStat = normalizeStatForMatching(d.position);
          return (
            defenseStat === key ||
            defenseStat.includes(key) ||
            key.includes(defenseStat) ||
            aliases.some(alias => defenseStat === alias || defenseStat.includes(alias))
          );
        }
      );
      
      if (aliasMatch) {
        return aliasMatch.rank;
      }
    }
  }

  // Reverse check: see if any defense stat matches the prop stat's aliases
  for (const [key, aliases] of Object.entries(statAliases)) {
    const defenseStatMatches = opponentMatches.find(
      (d) => {
        const defenseStat = normalizeStatForMatching(d.position);
        return (
          defenseStat === key ||
          defenseStat.includes(key) ||
          key.includes(defenseStat)
        );
      }
    );
    
    if (defenseStatMatches) {
      // Check if prop stat matches any alias for this key
      const propMatches = aliases.some(
        (alias) => normalizedStat === alias || normalizedStat.includes(alias) || alias.includes(normalizedStat)
      );
      
      if (propMatches) {
        return defenseStatMatches.rank;
      }
    }
  }

  return null;
}

/**
 * Merge PrizePicks props with defense data
 */
export function mergePrizePicksProps(
  props: PrizePicksProp[],
  defenseData: DefenseData[]
): MergedProp[] {
  console.log(`🔗 Merging ${props.length} PrizePicks props with defense data...`);
  
  if (defenseData.length === 0) {
    console.warn('⚠️ No defense data available for matching');
  } else {
    // Debug: Show summary statistics
    const uniqueOpponents = new Set(defenseData.map(d => normalizeTeamForMatching(d.opponent)));
    const uniqueStats = new Set(defenseData.map(d => d.position));
    console.log(`📊 Defense data: ${defenseData.length} entries, ${uniqueOpponents.size} opponents, ${uniqueStats.size} stat types`);
    if (uniqueOpponents.size <= 10) {
      console.log(`   Defense opponents: ${Array.from(uniqueOpponents).join(', ')}`);
    }
    
    // Debug: Show unique opponents and stats in props (limited)
    const uniquePropOpponents = new Set(props.map(p => normalizeTeamForMatching(p.opponent)).filter(o => o));
    const uniquePropStats = new Set(props.map(p => p.statCategory));
    console.log(`📊 Props: ${props.length} entries, ${uniquePropOpponents.size} opponents, ${uniquePropStats.size} stat types`);
    if (uniquePropOpponents.size <= 10 && uniquePropOpponents.size > 0) {
      console.log(`   Prop opponents: ${Array.from(uniquePropOpponents).join(', ')}`);
    } else if (uniquePropOpponents.size === 0) {
      console.warn(`   ⚠️ No opponents found in props! This is the main issue.`);
      // Show sample props to debug
      const sampleProps = props.slice(0, 3);
      sampleProps.forEach((p, i) => {
        console.log(`   Sample prop ${i + 1}: ${p.playerName} (${p.team}) vs "${p.opponent || '(empty)'}" - ${p.statCategory}`);
      });
    }
    
    // Show overlap
    const opponentOverlap = Array.from(uniquePropOpponents).filter(o => uniqueOpponents.has(o));
    console.log(`📊 Opponent overlap: ${opponentOverlap.length} of ${uniquePropOpponents.size} props opponents found in defense data`);
    if (opponentOverlap.length > 0 && opponentOverlap.length <= 10) {
      console.log(`   Overlapping opponents: ${opponentOverlap.join(', ')}`);
    }
  }

  const merged: MergedProp[] = props.map((prop) => {
    const defenseStrength = findDefenseStrength(
      defenseData,
      prop.team,
      prop.opponent,
      prop.statCategory
    );

    return {
      player: prop.playerName,
      team: prop.team,
      opponent: prop.opponent,
      position: prop.statCategory, // Using stat category as position for now
      stat: prop.statCategory,
      line: prop.line,
      defenseStrength: defenseStrength || 'NA',
      projectionId: prop.projectionId,
    };
  });

  const matchedCount = merged.filter((m) => m.defenseStrength !== 'NA').length;
  console.log(`✅ Matched ${matchedCount} of ${merged.length} props with defense data`);
  
  // Debug: Show why some props didn't match
  if (matchedCount < merged.length * 0.5 && props.length > 0 && defenseData.length > 0) {
    console.log('🔍 Debugging match failures...');
    const unmatched = merged.filter((m) => m.defenseStrength === 'NA').slice(0, 5);
    unmatched.forEach((prop, i) => {
      const normalizedOpponent = normalizeTeamForMatching(prop.opponent);
      const normalizedStat = normalizeStatForMatching(prop.stat);
      console.log(`   Unmatched prop ${i + 1}: ${prop.player} (${prop.team}) vs ${prop.opponent} (norm: ${normalizedOpponent}), stat: ${prop.stat} (norm: ${normalizedStat})`);
      
      // Check what defense data exists for this opponent
      const matchingDefense = defenseData.filter(d => 
        normalizeTeamForMatching(d.opponent) === normalizedOpponent
      );
      if (matchingDefense.length > 0) {
        console.log(`      Found ${matchingDefense.length} defense entries for opponent ${normalizedOpponent}:`);
        const uniqueStats = [...new Set(matchingDefense.map(d => d.position))];
        uniqueStats.slice(0, 5).forEach(stat => {
          console.log(`        - Stat: ${stat}`);
        });
      } else {
        console.log(`      No defense data found for opponent ${normalizedOpponent}`);
        const availableOpponents = [...new Set(defenseData.map(d => normalizeTeamForMatching(d.opponent)))];
        console.log(`      Available opponents: ${availableOpponents.slice(0, 10).join(', ')}`);
      }
    });
  }
  
  if (matchedCount === 0 && props.length > 0 && defenseData.length > 0) {
    console.warn('⚠️ No matches found. Possible reasons:');
    console.warn('   - Defense data is from a different date (run defense scraper first)');
    console.warn('   - Team name mismatches between props and defense data');
    console.warn('   - Stat category name differences');
    console.warn('   - Missing opponent information in props');
  }

  return merged;
}

/**
 * Merge Underdog props with defense data
 */
export function mergeUnderdogProps(
  props: UnderdogProp[],
  defenseData: DefenseData[]
): MergedProp[] {
  console.log(`🔗 Merging ${props.length} Underdog props with defense data...`);

  const merged: MergedProp[] = props.map((prop) => {
    const defenseStrength = findDefenseStrength(
      defenseData,
      prop.team,
      prop.opponent,
      prop.stat
    );

    return {
      player: prop.playerName,
      team: prop.team,
      opponent: prop.opponent,
      position: prop.position || '', // Use actual player position if available
      stat: prop.stat,
      line: prop.line,
      defenseStrength: defenseStrength || 'NA',
      gameTime: prop.gameTime,
    };
  });

  const matchedCount = merged.filter((m) => m.defenseStrength !== 'NA').length;
  console.log(`✅ Matched ${matchedCount} of ${merged.length} props with defense data`);

  // Debug: Show why some props didn't match
  if (matchedCount < merged.length * 0.5 && props.length > 0 && defenseData.length > 0) {
    console.log('🔍 Debugging match failures...');
    const unmatched = merged.filter((m) => m.defenseStrength === 'NA').slice(0, 5);
    unmatched.forEach((prop, i) => {
      const normalizedOpponent = normalizeTeamForMatching(prop.opponent);
      const normalizedStat = normalizeStatForMatching(prop.stat);
      console.log(`   Unmatched prop ${i + 1}: ${prop.player} (${prop.team}) vs ${prop.opponent} (norm: ${normalizedOpponent}), stat: ${prop.stat} (norm: ${normalizedStat})`);
      
      // Check what defense data exists for this opponent
      const matchingDefense = defenseData.filter(d => 
        normalizeTeamForMatching(d.opponent) === normalizedOpponent
      );
      if (matchingDefense.length > 0) {
        console.log(`      Found ${matchingDefense.length} defense entries for opponent ${normalizedOpponent}:`);
        const uniqueStats = [...new Set(matchingDefense.map(d => d.position))];
        uniqueStats.slice(0, 5).forEach(stat => {
          console.log(`        - Stat: ${stat}`);
        });
      } else {
        console.log(`      No defense data found for opponent ${normalizedOpponent}`);
        const availableOpponents = [...new Set(defenseData.map(d => normalizeTeamForMatching(d.opponent)))];
        console.log(`      Available opponents: ${availableOpponents.slice(0, 10).join(', ')}`);
      }
    });
  }

  return merged;
}

