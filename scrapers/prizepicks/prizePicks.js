/**
 * Wrapper for PrizePicks scraper
 * This module wraps the existing scrapePrizePicksProps function
 */
import { scrapePrizePicksProps } from "../../src/props/prizePicks.js";

/**
 * Scrape PrizePicks props
 * @returns {Promise<Array>} Array of PrizePicks props
 */
export async function scrapePrizePicks() {
  return await scrapePrizePicksProps();
}

