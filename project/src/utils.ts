import * as path from 'path';

export interface DefenseRow {
  team: string;
  opponent: string;
  gameTime: string;
  position: string;
  value: number | string;
  playerPageUrl: string;
  scrapedAt: string;
}

export interface GameInfo {
  homeTeam: string;
  awayTeam: string;
  gameTime: string;
  homePlayerUrl: string;
  awayPlayerUrl: string;
}

export const PICKFINDER_SCHEDULE_URL = 'https://www.pickfinder.app/nhl';

export function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveProjectPath(...segments: string[]): string {
  return path.join(process.cwd(), 'project', ...segments);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


