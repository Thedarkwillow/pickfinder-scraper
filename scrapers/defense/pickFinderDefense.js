/**
 * Wrapper for PickFinder Defense scraper
 * This module provides a wrapper for the defense scraping functionality
 */
import { chromium } from "playwright";
import { isSignedOut, handleGoogleLogin, saveCookies, loadCookies } from "../../src/googleAuth.js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load environment variables
dotenv.config();

/**
 * Run PickFinder Defense scraper
 * This is a simplified wrapper - for full functionality, use npm run scrape-today
 * @returns {Promise<Array>} Array of defense data
 */
export async function runPickFinderDefense() {
  console.log("PickFinder Defense...");
  
  // For GitHub Actions, we'll run a simplified version
  // The full scraper is in scrape-today-players.ts
  // This wrapper returns empty array - you can enhance it to call the actual scraper
  // or extract the defense scraping logic into a reusable module
  
  try {
    // Try to read from the output directory if defense data was recently scraped
    const outputDir = path.join(process.cwd(), 'output');
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir)
        .filter(f => f.startsWith('defense_') && f.endsWith('.json'))
        .sort()
        .reverse(); // Most recent first
      
      if (files.length > 0) {
        const mostRecent = path.join(outputDir, files[0]);
        const data = JSON.parse(fs.readFileSync(mostRecent, 'utf-8'));
        console.log(`✅ Loaded defense data from ${files[0]}`);
        return data;
      }
    }
    
    console.log("⚠️ No recent defense data found. Returning empty array.");
    console.log("💡 Run 'npm run scrape-today' to generate defense data.");
    return [];
  } catch (error) {
    console.error("❌ Error in defense scraper wrapper:", error.message);
    return [];
  }
}

