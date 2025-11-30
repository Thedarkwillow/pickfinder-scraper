/**
 * Wrapper for Underdog scraper
 * This module wraps the existing scrapeUnderdogProps function
 */
import { scrapeUnderdogProps } from "../../src/props/underdog.js";

/**
 * Run Underdog scraper
 * @returns {Promise<Array>} Array of Underdog props
 */
export async function runUnderdogScraper() {
  return await scrapeUnderdogProps();
}

