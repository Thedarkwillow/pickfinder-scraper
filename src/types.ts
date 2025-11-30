/**
 * Type definitions for PickFinder scraper
 * Defines all data structures extracted from the PickFinder player page
 */

/**
 * Player basic information
 */
export interface PlayerInfo {
  name: string | null;
  team: string | null;
  position: string | null;
  height: string | null;
  opponent: string | null;
  gameTime: string | null;
  stat: string | null; // The stat being viewed (SOG, Blocks, etc.)
  line: number | null; // The line value (2.5, 1.5, etc.)
}

/**
 * Line movement entry from the line movement section
 */
export interface LineMovement {
  line: string | null;
  app: string | null;
  emoji: string | null;
  timestamp: string | null;
}

/**
 * Defense ranking category entry
 */
export interface DefenseRanking {
  categoryName: string | null; // e.g., "Shots on Goal", "Assists", "Blocked Shots"
  opponentRank: string | null; // e.g., "25th", "7th", "12th"
  allowedValue: string | null; // e.g., "8.3", "1.4", "8.3"
}

/**
 * Matchup stats entry
 */
export interface MatchupStat {
  position: string | null; // e.g., "RW", "LW", "D"
  opponent: string | null;
  p?: number; // Points
  sog?: number; // Shots on goal
  fow?: number; // Faceoff wins
  bs?: number; // Blocked shots
  g?: number; // Goals
  a?: number; // Assists
  [key: string]: string | number | null | undefined; // Allow additional stat fields
}

/**
 * Matchup notes structure
 */
export interface MatchupNotes {
  matchup: string; // e.g., "Tb vs fla"
  stats: MatchupStat[];
}

/**
 * Tab content structure (Matchup, Defense, Similar, Injuries)
 */
export interface TabContent {
  tabName: string;
  content: Record<string, any>; // Flexible structure for different tab types
  rawText?: string;
}

/**
 * Complete scraped data structure
 */
export interface ScrapedData {
  playerInfo: PlayerInfo;
  lineMovements: LineMovement[];
  tabs: TabContent[];
  defenseRankings: DefenseRanking[];
  matchupNotes: MatchupNotes[];
  timestamp: string;
  rawData?: Record<string, any>; // Store any additional raw data
}

/**
 * Google Sheets configuration
 */
export interface SheetsConfig {
  spreadsheetId: string;
  serviceAccountPath: string;
}

/**
 * Scraper configuration
 */
export interface ScraperConfig {
  url: string;
  headless: boolean;
  timeout: number;
  retries: number;
  screenshotOnError: boolean;
  cookiesPath?: string;
}

