/**
 * Type definitions for props collection module
 */

export interface DefenseData {
  team: string;
  opponent: string;
  gameTime: string;
  position: string; // Stat category like "Shots on Goal", "Assists", etc.
  rank: string; // e.g., "24th", "25th", "32nd"
}

export interface PrizePicksProp {
  playerName: string;
  team: string;
  opponent: string;
  statCategory: string;
  line: number;
  projectionId: string;
}

export interface UnderdogProp {
  playerName: string;
  team: string;
  opponent: string;
  position?: string; // Player position (LW, RW, C, D, G)
  stat: string;
  line: number;
  gameTime?: string; // Game start time (e.g., "7:00 PM", "2025-11-30T19:00:00")
}

export interface MergedProp {
  player: string;
  team: string;
  opponent: string;
  position: string; // Player position (LW, RW, C, D, G) or stat category
  stat: string;
  line: number;
  defenseStrength: string | null; // Rank from defense data or "NA"
  projectionId?: string; // Only for PrizePicks
  gameTime?: string; // Game start time for sorting
}

