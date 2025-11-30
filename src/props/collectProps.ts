/**
 * Main script to collect props from PrizePicks and Underdog,
 * merge with defense data, and write to Google Sheets
 */
import 'dotenv/config';
import { readDefenseDataFromSheets } from './readDefenseData';
import { scrapePrizePicksProps } from './prizePicks';
import { scrapeUnderdogProps } from './underdog';
import { mergePrizePicksProps, mergeUnderdogProps } from './mergePropsWithDefense';
import { writePrizePicksPropsToSheets, writeUnderdogPropsToSheets } from './writePropsToSheets';
import { getTodayNhlSchedule, getOpponentFromSchedule } from './getNhlSchedule';

async function main() {
  console.log('🚀 Starting props collection workflow...\n');

  try {
    // Step A: Read defense data from Google Sheets
    console.log('📖 Step A: Reading defense data from Google Sheets...');
    const defenseData = await readDefenseDataFromSheets();
    
    if (defenseData.length === 0) {
      console.warn('⚠️ No defense data found. Props will be written with "NA" for defense strength.');
      console.warn('💡 Tip: Run the defense scraper first with: npm run scrape-today');
    } else {
      console.log(`✅ Loaded ${defenseData.length} defense data entries`);
      
      // Check if data is recent
      // Note: Defense data is organized by date in sheet names (Defense_YYYY-MM-DD)
      // The sheet name itself indicates the date of the data
      console.log('');
    }

    // Step B: Get today's NHL schedule (before scraping props so we can fill in opponents)
    console.log('📅 Step B: Fetching today\'s NHL schedule...');
    const nhlSchedule = await getTodayNhlSchedule();
    console.log(`✅ Loaded schedule with ${nhlSchedule.size / 2} games\n`);

    // Step C: Scrape PrizePicks
    console.log('🎯 Step C: Scraping PrizePicks props...');
    let prizePicksProps = await scrapePrizePicksProps();
    
    // Fill in missing opponents for PrizePicks using schedule
    if (nhlSchedule.size > 0) {
      let filledCount = 0;
      prizePicksProps = prizePicksProps.map(prop => {
        if (!prop.opponent && prop.team) {
          const opponent = getOpponentFromSchedule(prop.team, nhlSchedule);
          if (opponent) {
            filledCount++;
            return { ...prop, opponent };
          }
        }
        return prop;
      });
      if (filledCount > 0) {
        console.log(`   ✅ Filled in ${filledCount} missing opponents for PrizePicks using schedule`);
      }
    }
    
    console.log(`✅ Found ${prizePicksProps.length} PrizePicks props\n`);

    // Step D: Scrape Underdog Fantasy
    console.log('🐕 Step D: Scraping Underdog Fantasy props...');
    let underdogProps = await scrapeUnderdogProps();
    
    // Fill in missing opponents using schedule
    if (nhlSchedule.size > 0) {
      let filledCount = 0;
      underdogProps = underdogProps.map(prop => {
        if (!prop.opponent && prop.team) {
          const opponent = getOpponentFromSchedule(prop.team, nhlSchedule);
          if (opponent) {
            filledCount++;
            return { ...prop, opponent };
          }
        }
        return prop;
      });
      if (filledCount > 0) {
        console.log(`   ✅ Filled in ${filledCount} missing opponents using schedule`);
      }
    }
    
    console.log(`✅ Found ${underdogProps.length} Underdog props\n`);

    // Step E: Map props to defense strength
    console.log('🔗 Step E: Merging props with defense data...');
    const mergedPrizePicks = mergePrizePicksProps(prizePicksProps, defenseData);
    const mergedUnderdog = mergeUnderdogProps(underdogProps, defenseData);
    console.log('✅ Merging complete\n');

    // Step F: Write to Google Sheets
    console.log('📤 Step F: Writing props to Google Sheets...');
    await writePrizePicksPropsToSheets(mergedPrizePicks);
    await writeUnderdogPropsToSheets(mergedUnderdog);
    console.log('✅ All props written to sheets\n');

    console.log('============================================================');
    console.log('✅ Props collection completed successfully!');
    console.log(`   PrizePicks: ${mergedPrizePicks.length} props`);
    console.log(`   Underdog: ${mergedUnderdog.length} props`);
    console.log('============================================================');
  } catch (error: any) {
    console.error('❌ Error in props collection workflow:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

export { main };

