/**
 * Combined script to run both defense scraper and props collection
 * Runs: npm run scrape-today → npm run props
 */
import 'dotenv/config';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runCommand(command: string, description: string): Promise<boolean> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 ${description}`);
  console.log(`${'='.repeat(60)}\n`);
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      env: { ...process.env },
    });
    
    if (stdout) {
      console.log(stdout);
    }
    
    if (stderr) {
      console.error(stderr);
    }
    
    console.log(`\n✅ ${description} completed successfully\n`);
    return true;
  } catch (error: any) {
    console.error(`\n❌ ${description} failed:`);
    console.error(error.message);
    if (error.stdout) console.error('STDOUT:', error.stdout);
    if (error.stderr) console.error('STDERR:', error.stderr);
    return false;
  }
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 Starting Complete Scraping Workflow');
  console.log('   Step 1: Scrape Defense Data (PickFinder)');
  console.log('   Step 2: Scrape Props (PrizePicks + Underdog)');
  console.log('='.repeat(60) + '\n');

  // Step 1: Run defense scraper
  const defenseSuccess = await runCommand(
    'node --max-old-space-size=4096 --import tsx scrape-today-players.ts',
    'Defense Data Scraper (PickFinder)'
  );

  // If defense scraper failed, stop here
  if (!defenseSuccess) {
    console.log('\n' + '='.repeat(60));
    console.log('❌ Defense scraper failed - stopping workflow');
    console.log('💡 Props collection requires fresh defense data to run');
    console.log('='.repeat(60) + '\n');
    process.exit(1);
  }

  // Step 2: Run props collection (only if defense scraper succeeded)
  const propsSuccess = await runCommand(
    'node --max-old-space-size=4096 --import tsx src/props/collectProps.ts',
    'Props Collection (PrizePicks + Underdog)'
  );

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Workflow Summary');
  console.log('='.repeat(60));
  console.log(`   Defense Scraper: ${defenseSuccess ? '✅ Success' : '❌ Failed'}`);
  console.log(`   Props Collection: ${propsSuccess ? '✅ Success' : '❌ Failed'}`);
  console.log('='.repeat(60) + '\n');

  if (defenseSuccess && propsSuccess) {
    console.log('🎉 Complete workflow finished successfully!');
    process.exit(0);
  } else {
    console.log('❌ Workflow completed with errors.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});

