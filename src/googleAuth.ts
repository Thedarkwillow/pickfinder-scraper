import { Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Google OAuth Authentication Module
 * Handles Google login popup automation with nested iframe support
 */

const COOKIES_FILE = path.join(process.cwd(), '.cookies', 'pickfinder-cookies.json');
const COOKIES_DIR = path.join(process.cwd(), '.cookies');

/**
 * Check if user is signed out on PickFinder
 */
export async function isSignedOut(page: Page): Promise<boolean> {
  try {
    console.log('🔍 Checking authentication status...');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    
    // Check for common sign-out indicators
    const signInButton = await page.$('text="Sign in with Google"').catch(() => null);
    const signInButton2 = await page.$('button:has-text("Sign in")').catch(() => null);
    const signInButton3 = await page.$('[class*="sign-in"], [class*="login"]').catch(() => null);
    
    // Check URL for login redirects
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('/login')) {
      console.log('⚠️ Redirected to login page');
      return true;
    }
    
    // Check page content for sign-in prompts
    const pageText = (await page.textContent('body').catch(() => '')) || '';
    const hasSignInText = pageText.includes('Sign in') || pageText.includes('Sign in with Google');
    
    const isSignedOut = !!(signInButton || signInButton2 || signInButton3 || hasSignInText);
    
    if (isSignedOut) {
      console.log('❌ User is signed out');
    } else {
      console.log('✅ User appears to be authenticated');
    }
    
    return isSignedOut;
  } catch (error) {
    console.log('⚠️ Could not determine auth status, assuming signed out');
    return true;
  }
}

/**
 * Wait for Google OAuth popup and handle login
 */
export async function handleGoogleLogin(
  page: Page,
  email?: string,
  password?: string
): Promise<void> {
  console.log('🔐 Starting Google OAuth login flow...');
  
  // Wait for page to stabilize
  await page.waitForTimeout(3000);
  
  const currentUrl = page.url();
  console.log('📍 Current URL:', currentUrl);
  
  // Check if we're already on Google's login page (direct redirect)
  if (currentUrl.includes('accounts.google.com')) {
    console.log('✅ Already redirected to Google login page');
    
    // Check if we hit the "browser not secure" error
    const pageText = (await page.textContent('body').catch(() => '')) || '';
    if (pageText.includes("Couldn't sign you in") || pageText.includes("browser or app may not be secure")) {
      console.log('⚠️ Google detected automated browser. Manual login required.');
      console.log('📋 Please manually log in to Google in the browser window that opened.');
      console.log('⏳ Waiting 60 seconds for manual login...');
      
      // Wait for user to manually log in
      let loggedIn = false;
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(1000);
        const currentUrl = page.url();
        
        if (currentUrl.includes('pickfinder.app') && !currentUrl.includes('accounts.google.com')) {
          console.log('✅ Manual login successful!');
          loggedIn = true;
          break;
        }
        
        // Show progress every 10 seconds
        if (i % 10 === 0 && i > 0) {
          console.log(`⏳ Still waiting... ${60 - i} seconds remaining`);
        }
      }
      
      if (!loggedIn) {
        throw new Error('Manual login timeout. Please try again and log in faster, or use saved cookies.');
      }
      
      return;
    }
    
    await handleGoogleLoginPage(page, email, password);
    
    // Wait for redirect back
    await page.waitForTimeout(3000);
    return;
  }
  
  // Click "Sign in with Google" button
  console.log('👆 Clicking "Sign in with Google" button...');
  
  // Try multiple selectors for the sign-in button
  const signInSelectors = [
    'text="Sign in with Google"',
    'text=/Sign in.*Google/i',
    'button:has-text("Sign in with Google")',
    'button:has-text("Sign in")',
    'a:has-text("Sign in with Google")',
    'a:has-text("Sign in")',
    '[class*="google-sign-in"]',
    '[class*="google"] button',
    '[class*="sign-in"]',
    '[class*="signin"]',
    'button[aria-label*="Sign in"]',
    'button[aria-label*="Google"]',
    'button:has([class*="google"])',
    '[data-testid*="signin"]',
    '[data-testid*="google"]',
  ];
  
  let signInClicked = false;
  for (const selector of signInSelectors) {
    try {
      // Wait a bit for element to appear
      const button = await page.waitForSelector(selector, { timeout: 2000 }).catch(() => null);
      if (button) {
        const isVisible = await button.isVisible().catch(() => false);
        if (isVisible) {
          await button.scrollIntoViewIfNeeded();
          await button.click({ timeout: 5000 });
          console.log(`✅ Clicked sign-in button with selector: ${selector}`);
          signInClicked = true;
          
          // Wait for navigation
          await page.waitForTimeout(2000);
          break;
        }
      }
    } catch (error) {
      // Continue to next selector
    }
  }
  
  // Check if we were redirected after clicking
  if (signInClicked) {
    await page.waitForTimeout(2000);
    const newUrl = page.url();
    if (newUrl.includes('accounts.google.com')) {
      console.log('✅ Redirected to Google login page');
      await handleGoogleLoginPage(page, email, password);
      await page.waitForTimeout(3000);
      return;
    }
  }
  
  if (!signInClicked) {
    // Get page content for debugging
    const pageText = (await page.textContent('body').catch(() => '')) || '';
    const hasSignInText = pageText.includes('Sign in') || pageText.includes('Google');
    console.log('⚠️ Page contains sign-in text:', hasSignInText);
    console.log('⚠️ Current URL:', page.url());
    
    // Try to find any button with "sign" or "google" in text
    const allButtons = await page.$$('button, a').catch(() => []);
    console.log(`⚠️ Found ${allButtons.length} buttons/links on page`);
    
    for (const btn of allButtons.slice(0, 10)) {
      const text = await btn.textContent().catch(() => '');
      if (text && (text.toLowerCase().includes('sign') || text.toLowerCase().includes('google'))) {
        console.log(`⚠️ Found potential button: "${text}"`);
      }
    }
    
    throw new Error('Could not find "Sign in with Google" button. Check error screenshot for page state.');
  }
  
  // Wait for Google OAuth popup to appear
  console.log('⏳ Waiting for Google OAuth popup...');
  
  // Listen for new popup/page
  const popupPromise = page.context().waitForEvent('page', { timeout: 10000 });
  
  // Wait a bit for popup to open
  await page.waitForTimeout(2000);
  
  // Get all pages in context
  const pages = page.context().pages();
  let googlePage: Page | null = pages.find((p: Page) => p.url().includes('accounts.google.com')) || null;
  
  // If no popup yet, try waiting for it
  if (!googlePage) {
    try {
      googlePage = await popupPromise as Page;
    } catch (error) {
      // Check again in existing pages
      await page.waitForTimeout(3000);
      const newPages = page.context().pages();
      googlePage = newPages.find((p: Page) => p.url().includes('accounts.google.com')) || null;
    }
  }
  
  if (!googlePage) {
    throw new Error('Google OAuth popup did not open');
  }
  
  console.log('✅ Google OAuth popup detected');
  
  // Handle Google login page
  await handleGoogleLoginPage(googlePage, email, password);
  
  // Wait for redirect back to PickFinder
  console.log('⏳ Waiting for redirect to PickFinder...');
  
  // If popup was detected, wait for it to close or redirect
  if (googlePage && googlePage !== page) {
    try {
      // Wait for popup to close (user completed login)
      await googlePage.waitForEvent('close', { timeout: 30000 });
      console.log('✅ Google popup closed');
    } catch (error) {
      // Popup might still be open, check if we're redirected
      console.log('⚠️ Popup did not close, checking for redirect...');
    }
  }
  
  // Check main page for redirect
  try {
    await page.waitForNavigation({ 
      url: (url) => url.hostname.includes('pickfinder.app'),
      timeout: 30000 
    });
    console.log('✅ Redirected to PickFinder');
  } catch (error) {
    // Check current URL
    const currentUrl = page.url();
    if (currentUrl.includes('pickfinder.app')) {
      console.log('✅ Already on PickFinder');
    } else {
      console.log('⚠️ Waiting for redirect, current URL:', currentUrl);
      // Wait a bit more
      await page.waitForTimeout(5000);
    }
  }
  
  // Give it more time for redirect to complete
  await page.waitForTimeout(3000);
  
  // Final check
  const finalUrl = page.url();
  if (finalUrl.includes('pickfinder.app') && !finalUrl.includes('accounts.google.com')) {
    console.log('✅ Successfully authenticated and redirected to PickFinder');
  } else {
    console.log('⚠️ Final URL check:', finalUrl);
    // Still proceed - might be authenticated via cookies
  }
  
  // Wait for page to fully load
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

/**
 * Handle the Google login page (email/password entry) - Fully Automated
 */
async function handleGoogleLoginPage(
  googlePage: Page,
  email?: string,
  password?: string
): Promise<void> {
  console.log('📝 Handling Google login page automatically...');
  
  // Wait for Google login page to load
  await googlePage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await googlePage.waitForTimeout(3000);
  
  const currentUrl = googlePage.url();
  console.log('📍 Current URL:', currentUrl.substring(0, 100));
  
  // Check if we hit the "browser not secure" error - try to proceed anyway
  const pageText = (await googlePage.textContent('body').catch(() => '')) || '';
  const hasSecurityError = pageText.includes("Couldn't sign you in") || 
                           pageText.includes("browser or app may not be secure");
  
  if (hasSecurityError) {
    console.log('⚠️ Google security warning detected, attempting to bypass...');
    // Try to find and click "Try another way" or "Continue" button
    const continueButton = await googlePage.$('button:has-text("Try another way"), button:has-text("Continue"), button:has-text("Advanced")').catch(() => null);
    if (continueButton) {
      await continueButton.click();
      await googlePage.waitForTimeout(2000);
    }
  }
  
  // Handle account selection first if shown
  const accountSelected = await handleAccountSelection(googlePage, email);
  if (accountSelected) {
    await googlePage.waitForTimeout(3000);
  }
  
  // Try to find email input with multiple strategies
  let emailInput: any = null;
  
  // Strategy 1: Try main page first
  const emailSelectors = [
    'input[type="email"]',
    'input[name="identifier"]',
    'input[id="identifierId"]',
    'input[aria-label*="email" i]',
    'input[placeholder*="email" i]',
    '#identifierId',
    'input.autocomplete',
  ];
  
  console.log('🔍 Looking for email input field...');
  for (const selector of emailSelectors) {
    try {
      emailInput = await googlePage.waitForSelector(selector, { timeout: 3000, state: 'visible' }).catch(() => null);
      if (emailInput) {
        console.log(`✅ Found email input with selector: ${selector}`);
        break;
      }
    } catch (error) {
      // Continue to next selector
    }
  }
  
  // Strategy 2: Check iframes if not found
  if (!emailInput) {
    console.log('🔍 Checking iframes for email input...');
    const iframes = await googlePage.$$('iframe');
    console.log(`   Found ${iframes.length} iframe(s)`);
    
    for (const iframe of iframes) {
      try {
        const frame = await iframe.contentFrame();
        if (frame) {
          for (const selector of emailSelectors) {
            emailInput = await frame.waitForSelector(selector, { timeout: 2000, state: 'visible' }).catch(() => null);
            if (emailInput) {
              // Keep using googlePage but reference the frame for input operations
              console.log(`✅ Found email input in iframe with selector: ${selector}`);
              break;
            }
          }
          if (emailInput) break;
        }
      } catch (error) {
        // Continue to next iframe
      }
    }
  }
  
  // Strategy 3: Wait a bit more and try again
  if (!emailInput) {
    console.log('⏳ Waiting a bit longer for page to fully load...');
    await googlePage.waitForTimeout(3000);
    for (const selector of emailSelectors) {
      emailInput = await googlePage.$(selector).catch(() => null);
      if (emailInput && await emailInput.isVisible().catch(() => false)) break;
    }
  }
  
  // Enter email if we found the input and have email
  if (emailInput && email) {
    try {
      console.log('📧 Entering email automatically...');
      
      // Clear and type email with human-like delays
      await emailInput.click({ timeout: 5000 });
      await googlePage.waitForTimeout(500);
      
      // Clear existing content
      await emailInput.clear({ timeout: 2000 }).catch(() => {});
      
      // Type email character by character to appear more human
      await emailInput.type(email, { delay: 100 });
      await googlePage.waitForTimeout(1000);
      
      // Find and click Next button
      const nextSelectors = [
        '#identifierNext',
        'button#identifierNext',
        'button:has-text("Next")',
        'button[type="submit"]',
        'button.primary',
        'div#identifierNext button',
      ];
      
      let nextClicked = false;
      for (const selector of nextSelectors) {
        try {
          const nextButton = await googlePage.waitForSelector(selector, { timeout: 3000, state: 'visible' }).catch(() => null);
          if (nextButton && await nextButton.isVisible().catch(() => false)) {
            await nextButton.click();
            console.log('✅ Clicked Next button');
            nextClicked = true;
            await googlePage.waitForTimeout(3000);
            break;
          }
        } catch (error) {
          // Continue to next selector
        }
      }
      
      // Also check iframes for Next button
      if (!nextClicked) {
        const iframes = await googlePage.$$('iframe');
        for (const iframe of iframes) {
          const frame = await iframe.contentFrame();
          if (frame) {
            for (const selector of nextSelectors) {
              const nextButton = await frame.waitForSelector(selector, { timeout: 2000, state: 'visible' }).catch(() => null);
              if (nextButton && await nextButton.isVisible().catch(() => false)) {
                await nextButton.click();
                console.log('✅ Clicked Next button in iframe');
                nextClicked = true;
                await googlePage.waitForTimeout(3000);
                break;
              }
            }
            if (nextClicked) break;
          }
        }
      }
      
      if (!nextClicked) {
        console.log('⚠️ Next button not found, trying Enter key...');
        await emailInput.press('Enter');
        await googlePage.waitForTimeout(3000);
      }
    } catch (error: any) {
      console.log(`⚠️ Error entering email: ${error.message}`);
    }
  } else if (!emailInput && !email) {
    console.log('⚠️ No email input found and no email provided, checking for account selection...');
    await handleAccountSelection(googlePage, email);
    return;
  } else if (!email) {
    console.log('⚠️ Email input found but no email provided in environment variables');
    throw new Error('GOOGLE_EMAIL environment variable is required for automatic login');
  }
  
  // Wait for password page to load
  await googlePage.waitForTimeout(3000);
  
  // Try to find password input
  console.log('🔍 Looking for password input field...');
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[name="Passwd"]',
    '#password input',
    'input[aria-label*="password" i]',
    'input[placeholder*="password" i]',
  ];
  
  let passwordInput: any = null;
  for (const selector of passwordSelectors) {
    try {
      passwordInput = await googlePage.waitForSelector(selector, { timeout: 5000, state: 'visible' }).catch(() => null);
      if (passwordInput && await passwordInput.isVisible().catch(() => false)) {
        console.log(`✅ Found password input with selector: ${selector}`);
        break;
      }
    } catch (error) {
      // Continue
    }
  }
  
  // If not found, check iframes
  if (!passwordInput) {
    const iframes = await googlePage.$$('iframe');
    for (const iframe of iframes) {
      const frame = await iframe.contentFrame();
      if (frame) {
        for (const selector of passwordSelectors) {
          passwordInput = await frame.waitForSelector(selector, { timeout: 3000, state: 'visible' }).catch(() => null);
          if (passwordInput && await passwordInput.isVisible().catch(() => false)) {
            break;
          }
        }
        if (passwordInput) break;
      }
    }
  }
  
  // Enter password if found
  if (passwordInput && password) {
    try {
      console.log('🔒 Entering password automatically...');
      
      await passwordInput.click({ timeout: 5000 });
      await googlePage.waitForTimeout(500);
      
      // Type password character by character
      await passwordInput.type(password, { delay: 100 });
      await googlePage.waitForTimeout(1000);
      
      // Find and click Submit/Next button
      const submitSelectors = [
        '#passwordNext',
        'button#passwordNext',
        'button:has-text("Next")',
        'button:has-text("Sign in")',
        'button[type="submit"]',
        'div#passwordNext button',
      ];
      
      let submitClicked = false;
      for (const selector of submitSelectors) {
        try {
          const submitButton = await googlePage.waitForSelector(selector, { timeout: 3000, state: 'visible' }).catch(() => null);
          if (submitButton && await submitButton.isVisible().catch(() => false)) {
            await submitButton.click();
            console.log('✅ Clicked Submit/Next button');
            submitClicked = true;
            await googlePage.waitForTimeout(3000);
            break;
          }
        } catch (error) {
          // Continue to next selector
        }
      }
      
      // Also check iframes for Submit button
      if (!submitClicked) {
        const iframes = await googlePage.$$('iframe');
        for (const iframe of iframes) {
          const frame = await iframe.contentFrame();
          if (frame) {
            for (const selector of submitSelectors) {
              const submitButton = await frame.waitForSelector(selector, { timeout: 2000, state: 'visible' }).catch(() => null);
              if (submitButton && await submitButton.isVisible().catch(() => false)) {
                await submitButton.click();
                console.log('✅ Clicked Submit/Next button in iframe');
                submitClicked = true;
                await googlePage.waitForTimeout(3000);
                break;
              }
            }
            if (submitClicked) break;
          }
        }
      }
      
      if (!submitClicked) {
        console.log('⚠️ Submit button not found, trying Enter key...');
        await passwordInput.press('Enter');
        await googlePage.waitForTimeout(3000);
      }
    } catch (error: any) {
      console.log(`⚠️ Error entering password: ${error.message}`);
    }
  } else if (!password) {
    console.log('⚠️ Password input found but no password provided in environment variables');
    throw new Error('GOOGLE_PASSWORD environment variable is required for automatic login');
  }
  
  // Handle 2FA if it appears
  await googlePage.waitForTimeout(3000);
  const currentUrlAfter = googlePage.url();
  const pageTextAfter = await googlePage.textContent('body').catch(() => '') || '';
  
  if (currentUrlAfter.includes('challenge') || 
      pageTextAfter.includes('2-Step Verification') ||
      pageTextAfter.includes("Verify it's you")) {
    console.log('📱 2FA detected. Waiting for manual verification...');
    console.log('⏳ Please complete 2FA in the browser window (you have 60 seconds)...');
    
    let authenticated = false;
    for (let i = 0; i < 60; i++) {
      await googlePage.waitForTimeout(1000);
      const url = googlePage.url();
      
      if (url.includes('pickfinder.app') || 
          (!url.includes('accounts.google.com') && !url.includes('challenge'))) {
        console.log('✅ 2FA completed successfully!');
        authenticated = true;
        break;
      }
      
      if (i % 10 === 0 && i > 0) {
        console.log(`⏳ Still waiting for 2FA... ${60 - i} seconds remaining`);
      }
    }
    
    if (!authenticated) {
      throw new Error('2FA verification timeout. Please complete it faster next time.');
    }
  }
  
  // Wait for authentication to complete
  console.log('⏳ Waiting for authentication to complete...');
  await googlePage.waitForTimeout(5000);
}

/**
 * Handle Google account selection (select first account)
 * Returns true if an account was selected, false otherwise
 */
async function handleAccountSelection(page: Page, targetEmail?: string): Promise<boolean> {
  try {
    await page.waitForTimeout(2000);
    
    // Look for account list - multiple strategies
    const accountSelectors = [
      'div[data-identifier]',
      'div[data-email]',
      '[class*="account"]',
      'div[role="button"]:has-text("@")',
      'li:has-text("@")',
      'div[class*="account-list"] div',
      'ul[class*="account"] li',
    ];
    
    for (const selector of accountSelectors) {
      try {
        const accounts = await page.$$(selector);
        if (accounts.length > 0) {
          // Check if they're visible and clickable
          for (const account of accounts) {
            const isVisible = await account.isVisible().catch(() => false);
            const text = await account.textContent().catch(() => '') || '';
            if (isVisible && (text.includes('@') || (targetEmail && text.includes(targetEmail)))) {
              console.log(`👤 Found account selection, clicking: ${text.substring(0, 50)}...`);
              await account.click();
              await page.waitForTimeout(3000);
              return true;
            }
          }
        }
      } catch (error) {
        // Continue to next selector
      }
    }
    
    // Check if email/password form is already shown (no account selection needed)
    const emailInput = await page.$('input[type="email"], input[id="identifierId"]').catch(() => null);
    if (emailInput) {
      console.log('ℹ️ Email input found - no account selection needed');
      return false;
    }
    
    console.log('ℹ️ No account selection found, proceeding with login form');
    return false;
  } catch (error) {
    console.log('⚠️ Error during account selection:', error);
    return false;
  }
}

/**
 * Save cookies to file for future use
 */
export async function saveCookies(context: BrowserContext): Promise<void> {
  try {
    // Ensure directory exists
    if (!fs.existsSync(COOKIES_DIR)) {
      fs.mkdirSync(COOKIES_DIR, { recursive: true });
    }
    
    // Get cookies
    const cookies = await context.cookies();
    
    // Save to file
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log(`💾 Cookies saved to ${COOKIES_FILE}`);
  } catch (error) {
    console.error('❌ Error saving cookies:', error);
  }
}

/**
 * Load cookies from file
 */
export async function loadCookies(context: BrowserContext): Promise<boolean> {
  try {
    if (!fs.existsSync(COOKIES_FILE)) {
      console.log('⚠️ No saved cookies found');
      return false;
    }
    
    const cookiesData = fs.readFileSync(COOKIES_FILE, 'utf-8');
    const cookies = JSON.parse(cookiesData);
    
    // Validate cookies format
    if (!Array.isArray(cookies) || cookies.length === 0) {
      console.log('⚠️ Invalid cookies format');
      return false;
    }
    
    // Add cookies to context
    await context.addCookies(cookies);
    console.log(`🍪 Loaded ${cookies.length} cookies from file`);
    return true;
  } catch (error) {
    console.error('❌ Error loading cookies:', error);
    return false;
  }
}

