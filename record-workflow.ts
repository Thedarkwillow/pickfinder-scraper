import 'dotenv/config';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { loadCookies, isSignedOut, handleGoogleLogin, saveCookies } from './src/googleAuth';

interface ActionRecord {
  timestamp: string;
  action: string;
  url?: string;
  details?: {
    tag?: string;
    text?: string;
    id?: string;
    className?: string;
    selector?: string;
    type?: string;
    name?: string;
    valueLength?: number;
    valuePreview?: string;
    [key: string]: any;
  };
}

const actions: ActionRecord[] = [];

async function recordWorkflow() {
  console.log('🎬 Screen Recording Workflow - Please perform your actions after login');
  console.log('📹 This script will record:');
  console.log('   - Full screen video of your workflow');
  console.log('   - Page navigations');
  console.log('   - All user interactions\n');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    recordVideo: {
      dir: path.join(process.cwd(), 'recordings'),
      size: { width: 1920, height: 1080 },
    },
  });

  // Load cookies if available
  await loadCookies(context);

  const page = await context.newPage();

  // Prevent browser from closing on errors
  page.on('crash' as any, () => {
    console.error('⚠️ Page crashed, but browser will stay open...');
  });

  page.on('error' as any, (error: Error) => {
    console.error('⚠️ Page error:', error.message);
    // Don't close browser on errors
  });

  // Start tracing for detailed recording
  await context.tracing.start({ screenshots: true, snapshots: true });

  // Record initial navigation
  actions.push({
    timestamp: new Date().toISOString(),
    action: 'Initial navigation',
    url: 'https://www.pickfinder.app/',
  });

  console.log('🌐 Opening PickFinder...');
  await page.goto('https://www.pickfinder.app/', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  await page.waitForTimeout(2000);

  // Check if signed out and handle login
  if (await isSignedOut(page)) {
    console.log('🔐 You need to log in. The script will wait for you to complete login...');
    await handleGoogleLogin(page, process.env.GOOGLE_EMAIL, process.env.GOOGLE_PASSWORD);
    await saveCookies(context);
    actions.push({
      timestamp: new Date().toISOString(),
      action: 'Login completed',
      url: page.url(),
    });
  }

  // Set up listeners to record actions
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      const url = page.url();
      actions.push({
        timestamp: new Date().toISOString(),
        action: 'Navigation',
        url: url,
      });
      console.log(`📍 Navigated to: ${url.substring(0, 80)}...`);
    }
  });

  // Note: Screen recording will capture all visual interactions
  // Click and input events are captured in the video

  console.log('\n' + '='.repeat(60));
  console.log('✅ Browser is ready!');
  console.log('📹 Recording started...\n');

  // Function to save recording and cleanup
  async function saveRecording() {
    try {
      // Capture page content BEFORE closing context
      const finalUrl = page.url();
      
      // Take final screenshot (before closing context)
      const screenshotPath = path.join(process.cwd(), 'final-page-screenshot.png');
      let screenshotSaved = false;
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshotSaved = fs.existsSync(screenshotPath);
      } catch (err) {
        console.warn('⚠️ Warning: Could not take screenshot:', (err as Error).message);
      }

      // Get final page HTML (before closing context)
      const htmlPath = path.join(process.cwd(), 'final-page.html');
      let htmlSaved = false;
      try {
        const html = await page.content();
        fs.writeFileSync(htmlPath, html);
        htmlSaved = fs.existsSync(htmlPath);
      } catch (err) {
        console.warn('⚠️ Warning: Could not save HTML:', (err as Error).message);
      }

      // Stop tracing
      await context.tracing.stop({
        path: path.join(process.cwd(), 'workflow-trace.zip'),
      });

      // Close context to finalize video recording
      await context.close();

      // Find and move video file
      const recordingsDir = path.join(process.cwd(), 'recordings');
      let videoPath = '';
      if (fs.existsSync(recordingsDir)) {
        const videoFiles = fs.readdirSync(recordingsDir).filter((f) => f.endsWith('.webm'));
        if (videoFiles.length > 0) {
          const sourceVideo = path.join(recordingsDir, videoFiles[0]);
          const destVideo = path.join(process.cwd(), 'workflow-recording.webm');
          fs.renameSync(sourceVideo, destVideo);
          videoPath = destVideo;
          
          // Clean up empty recordings directory
          try {
            fs.rmdirSync(recordingsDir);
          } catch {
            // Ignore if directory not empty
          }
        }
      }

      // Save action log
      const outputFile = path.join(process.cwd(), 'workflow-recording.json');
      const recording = {
        recordedAt: new Date().toISOString(),
        finalUrl: finalUrl,
        actions: actions,
      };

      fs.writeFileSync(outputFile, JSON.stringify(recording, null, 2));
      
      // Verify file was saved
      if (!fs.existsSync(outputFile)) {
        throw new Error('Failed to save recording JSON file');
      }
      const fileSize = fs.statSync(outputFile).size;
      if (fileSize === 0) {
        throw new Error('Recording file is empty');
      }

      // Verify screenshot was saved
      if (!screenshotSaved) {
        console.warn('⚠️ Warning: Screenshot file was not created');
      }

      // Verify HTML was saved
      if (!htmlSaved) {
        console.warn('⚠️ Warning: HTML file was not created');
      }

      console.log('\n' + '='.repeat(60));
      console.log('📹 Screen Recording complete!');
      console.log(`\n📁 Files saved:`);
      if (videoPath && fs.existsSync(videoPath)) {
        const videoSize = fs.statSync(videoPath).size;
        console.log(`   🎥 ${videoPath} (${(videoSize / 1024 / 1024).toFixed(2)} MB - screen recording)`);
      }
      console.log(`   - ${outputFile} (${(fileSize / 1024).toFixed(2)} KB - action log)`);
      console.log(`   - ${screenshotPath} (final screenshot)`);
      console.log(`   - ${htmlPath} (final page HTML)`);
      console.log(`   - workflow-trace.zip (Playwright trace)`);
      console.log(`\n✅ Total actions recorded: ${actions.length}`);
      console.log(`📍 Final URL: ${finalUrl}\n`);
    } catch (err: any) {
      console.error('Error saving recording:', err?.message);
    }
  }

  // Function to wait for user to finish recording
  async function waitForUserToFinish(): Promise<void> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      console.log('\n' + '='.repeat(60));
      console.log('📹 Recording is active!');
      console.log('\n📝 Instructions:');
      console.log('   1. Complete your workflow in the browser window');
      console.log('   2. When done, come back here and press ENTER to save and end recording');
      console.log('   3. Or press Ctrl+C to cancel without saving\n');

      rl.on('line', () => {
        rl.close();
        resolve();
      });

      // Also handle Ctrl+C gracefully
      let isStopping = false;
      const cleanup = async () => {
        if (isStopping) return;
        isStopping = true;
        
        console.log('\n\n🛑 Recording cancelled by user...');
        rl.close();
        
        try {
          // Stop tracing if it's still running
          if (context) {
            await context.tracing.stop({ path: path.join(process.cwd(), 'workflow-trace.zip') }).catch(() => {});
            // Close context to finalize video
            await context.close().catch(() => {});
          }
        } catch (err) {
          // Ignore errors
        }
        
        // Give a moment for cleanup
        await new Promise((resolve) => setTimeout(resolve, 1000));
        
        try {
          if (browser) {
            await browser.close();
          }
        } catch (err) {
          // Browser might already be closed
        }
        
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
    });
  }

  // Wait for user to finish and press Enter
  await waitForUserToFinish();

  // User pressed Enter - save the recording
  console.log('\n💾 Saving recording...\n');
  await saveRecording();

  // Keep browser open briefly so user can see final state
  console.log('⏳ Keeping browser open for 5 seconds so you can review...\n');
  await new Promise((resolve) => setTimeout(resolve, 5000));
  
  // Close browser (context already closed in saveRecording)
  await browser.close();
}

recordWorkflow().catch((error) => {
  console.error('❌ Error:', error);
  console.error('⚠️ Browser will stay open for 30 seconds so you can review...');
  // Don't exit immediately - give user time to see what happened
  setTimeout(() => {
    process.exit(1);
  }, 30000);
});
