# Quick Start Guide

Get up and running in 5 minutes!

## Step 1: Install Dependencies

```bash
npm install
npx playwright install chromium
```

## Step 2: Export Cookies (One-time setup)

### Easy Method - Using Chrome Extension:

1. Install "Cookie-Editor" extension from Chrome Web Store
2. Go to https://www.pickfinder.app and log in with Google
3. Click the extension icon → Export → Select "Netscape" or "JSON" format
4. Save as `cookies.json` in the project root

### Manual Method:

1. Open Chrome DevTools (F12)
2. Go to **Application** tab → **Cookies**
3. Select the domain (pickfinder.app or google.com)
4. Copy cookies manually using the format in `cookies.json.template`

### Using Console Helper:

1. Open PickFinder in Chrome and log in
2. Open Console (F12 → Console tab)
3. Copy-paste the contents of `cookie-extractor.js` into console
4. Run: `exportPickFinderCookies()`
5. Copy the JSON output and save as `cookies.json`

## Step 3: Set Up Google Sheets (Optional)

If you want to upload to Google Sheets:

1. **Create Service Account:**
   - Go to https://console.cloud.google.com/
   - Create project → Enable Sheets API
   - Create Service Account → Download JSON key
   - Save as `service_account.json`

2. **Create Google Sheet:**
   - Create a new Google Sheet
   - Share it with the service account email (from JSON file)
   - Copy the Sheet ID from URL: `https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit`

3. **Set Environment Variable:**
   ```bash
   # Windows PowerShell
   $env:SPREADSHEET_ID="your_sheet_id_here"
   
   # Windows CMD
   set SPREADSHEET_ID=your_sheet_id_here
   
   # Mac/Linux
   export SPREADSHEET_ID="your_sheet_id_here"
   ```

## Step 4: Run the Scraper!

```bash
npm start
```

The scraper will:
- ✅ Load your cookies
- ✅ Open PickFinder
- ✅ Scrape all data
- ✅ Save to `scrape_[timestamp].json`
- ✅ Upload to Google Sheets (if configured)

## Troubleshooting

**"Cookies expired" error?**
- Re-export cookies from Chrome

**"Login required" message?**
- Make sure you included Google auth cookies, not just PickFinder cookies

**Nothing being scraped?**
- The website structure may have changed
- Check console output for selector warnings
- Update selectors in `index.js` if needed

**Sheets upload failing?**
- Verify service account JSON is correct
- Make sure sheet is shared with service account email
- Check that SPREADSHEET_ID is set correctly

## What Gets Scraped?

- ✅ Player name, position, height, team, opponent
- ✅ Line value and prop type
- ✅ Line movement table
- ✅ Matchup, Defense, Similar, Injuries sections
- ✅ Defense rankings
- ✅ Extra notes section

All data is saved locally as JSON and optionally uploaded to Google Sheets.

