import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runUnderdogScraper } from "../scrapers/underdog/underdogPuppeteerScraper.js";
import { scrapePrizePicks } from "../scrapers/prizepicks/prizePicks.js";
import { runPickFinderDefense } from "../scrapers/defense/pickFinderDefense.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function saveResults(name, data) {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const folder = path.join(__dirname, "..", "scraper-results", date);

  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  const filePath = path.join(folder, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Saved → ${filePath}`);
}

(async () => {
  try {
    console.log("Running ALL scrapers...");

    console.log("PrizePicks...");
    const prizepicks = await scrapePrizePicks();
    await saveResults("prizepicks", prizepicks);

    console.log("PickFinder Defense...");
    const defense = await runPickFinderDefense();
    await saveResults("defense", defense);

    console.log("Underdog...");
    const underdog = await runUnderdogScraper();
    await saveResults("underdog", underdog);

    console.log("All scrapers completed.");
  } catch (err) {
    console.error("Scraping failed:", err);
    process.exit(1);
  }
})();

