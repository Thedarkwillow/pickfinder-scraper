# PickFinder Full Automation Scraper

A complete TypeScript automation workflow that scrapes PickFinder player data with Google OAuth login automation and exports to Google Sheets.

## Features

- ✅ **Full Browser Automation** - Uses Playwright for robust web scraping
- ✅ **Google OAuth Login** - Automatically handles Google sign-in popup and iframe navigation
- ✅ **Cookie Persistence** - Saves cookies to avoid re-login on subsequent runs
- ✅ **Comprehensive Data Extraction** - Extracts all player info, line movements, defense rankings, matchup notes, and tab content
- ✅ **Google Sheets Integration** - Automatically creates new sheet tabs and exports structured data
- ✅ **Error Handling** - Screenshot capture on errors, retry logic, and comprehensive logging
- ✅ **TypeScript** - Fully typed codebase for better development experience

## Project Structure

```
pickfinder-scraper/
├── src/
│   ├── index.ts          # Main entry point
│   ├── scrape.ts         # Core scraping logic
│   ├── googleAuth.ts     # Google OAuth automation
│   ├── sheets.ts         # Google Sheets export
│   └── types.ts          # TypeScript type definitions
├── package.json
├── tsconfig.json
├── playwright.config.ts
├── env.example           # Environment variables template
└── README.md
```

## Prerequisites

- Node.js 18+ installed
- Google account for PickFinder authentication
- Google Cloud project with Sheets API enabled
- Chrome/Chromium browser (installed automatically)

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
npm run install-browsers
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp env.example .env
```

Edit `.env` and set:

```env
# PickFinder URL (optional, has default)
PICKFINDER_URL=https://www.pickfinder.app/players/nhl/...

# Google Sheets Configuration (required for Sheets export)
SPREADSHEET_ID=your_spreadsheet_id_here
SERVICE_ACCOUNT_PATH=service_account.json

# Optional: Google credentials for automated login
GOOGLE_EMAIL=your_email@gmail.com
GOOGLE_PASSWORD=your_password_here
```

### 3. Set Up Google Sheets Service Account

#### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable **Google Sheets API**:
   - Navigate to "APIs & Services" → "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

#### Step 2: Create Service Account

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "Service Account"
3. Fill in details:
   - Name: `pickfinder-scraper`
   - Description: `Service account for PickFinder scraper`
4. Click "Create and Continue"
5. Skip role assignment (or assign "Editor")
6. Click "Done"

#### Step 3: Generate Service Account Key

1. Click on the newly created service account
2. Go to "Keys" tab
3. Click "Add Key" → "Create new key"
4. Choose "JSON" format
5. Download the JSON file
6. Rename it to `service_account.json` and place in project root

#### Step 4: Share Google Sheet with Service Account

1. Create a new Google Sheet (or use existing)
2. Get the Sheet ID from URL:
   - URL: `https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit`
3. Copy the **Service Account Email** from `service_account.json` (field: `client_email`)
4. Share the Google Sheet with the service account email:
   - Click "Share" button
   - Paste the service account email
   - Give "Editor" permissions
   - Click "Send"

5. Set `SPREADSHEET_ID` in your `.env` file

## Usage

### Run the Scraper

```bash
npm run scrape
```

This will:
1. Launch a non-headless browser
2. Navigate to PickFinder
3. Check if signed out
4. Automate Google login if needed
5. Extract all data from the player page
6. Save data to `output/scrape_[timestamp].json`
7. Upload to Google Sheets (if configured)

### Development Mode

```bash
npm run dev
```

Runs the scraper in watch mode with auto-reload.

## Data Extraction

The scraper extracts the following structured data:

### Player Info
- Player name
- Team
- Position
- Height
- Opponent
- Game time
- Stat being viewed (SOG, Blocks, etc.)
- Line value (2.5, 1.5, etc.)

### Line Movement
- Line value
- App name
- Emoji indicator
- Timestamp

### Defense Rankings
- Category name (Shots on Goal, Assists, etc.)
- Opponent rank (25th, 7th, 12th)
- Allowed value (8.3, 1.4, etc.)

### Matchup Notes
Parsed structured format:
```json
[
  {
    "matchup": "Tb vs fla",
    "stats": [
      {
        "position": "RW",
        "opponent": "fla",
        "p": 25,
        "sog": 25
      }
    ]
  }
]
```

### Tabs Content
- Matchup tab
- Defense tab
- Similar tab
- Injuries tab

## Google Sheets Output

Data is written to a new sheet tab with timestamp:
- Tab name: `Scrape_2024-01-01T12-00-00`

Sections written:
1. Player Info (header row + data)
2. Line Movements (table)
3. Defense Rankings (table)
4. Matchup Notes (structured)
5. Tab Content (text/json)
6. Metadata (timestamp, raw data)

## Cookie Management

Cookies are automatically saved to `.cookies/pickfinder-cookies.json` after successful login. On subsequent runs, cookies are loaded first to avoid re-authentication.

If cookies expire or login fails:
1. The scraper will attempt fresh login
2. New cookies will be saved
3. Error screenshots are captured for debugging

## Error Handling

The scraper includes comprehensive error handling:

- **Screenshot on Error** - Full page screenshot saved as `error-screenshot-[timestamp].png`
- **Retry Logic** - Multiple selector attempts for resilient scraping
- **Comprehensive Logging** - Detailed console output for debugging
- **Graceful Failures** - Continues extraction even if some sections fail

## Troubleshooting

### Login Issues

**Problem:** Google login popup doesn't open or fails

**Solutions:**
- Check if credentials are provided in `.env` (optional)
- Verify browser is not blocked by popup blocker
- Check saved cookies in `.cookies/` directory
- Manual login: Let the browser window open and manually log in, then cookies will be saved

### Element Not Found Errors

**Problem:** Selectors not finding elements

**Solutions:**
- PickFinder may have updated their UI
- Check error screenshots for current page structure
- Update selectors in `src/scrape.ts` if needed
- The scraper tries multiple selectors, so partial data may still be extracted

### Google Sheets Upload Fails

**Problem:** Cannot write to Google Sheet

**Solutions:**
1. Verify `SPREADSHEET_ID` is correct in `.env`
2. Ensure service account file exists and is valid JSON
3. Check that service account email has Editor access to the sheet
4. Verify Google Sheets API is enabled in Google Cloud Console

### Page Load Timeouts

**Problem:** Page takes too long to load

**Solutions:**
- Increase timeout values in `src/scrape.ts`
- Check network connectivity
- Try running again (may be temporary)

## Development

### Building TypeScript

```bash
npm run build
```

Outputs compiled JavaScript to `dist/` directory.

### Code Structure

- **`src/index.ts`** - Main orchestration, reads env vars, calls scraper and sheets
- **`src/scrape.ts`** - Browser automation, data extraction functions
- **`src/googleAuth.ts`** - Google OAuth popup handling, cookie management
- **`src/sheets.ts`** - Google Sheets API integration, data formatting
- **`src/types.ts`** - TypeScript interfaces for all data structures

### Adding New Data Extraction

1. Add type definition to `src/types.ts`
2. Create extraction function in `src/scrape.ts`
3. Call function in `scrapePickFinderPage()`
4. Add export logic to `src/sheets.ts` if needed

## Security Notes

⚠️ **Important Security Considerations:**

- Never commit `.env` file to version control
- Never commit `service_account.json` to version control
- Never commit `.cookies/` directory
- Rotate service account keys periodically
- Use environment variables in production
- Consider using secret management services for production

## License

MIT

## Support

For issues:
1. Check the troubleshooting section
2. Review error logs and screenshots
3. Verify all setup steps completed
4. Check that PickFinder hasn't changed their UI structure

