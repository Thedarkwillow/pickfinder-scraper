## PickFinder Scraper

Automated PickFinder player scraper using **Puppeteer Extra + Stealth plugin** for Google login and **Google Sheets** export.

This script:

- **Launches Puppeteer Extra with Stealth** (headless: false, hardened args).
- **Uses a persistent Google session** via `cookies.json` to avoid repeated logins.
- **Automates Google login** (no manual steps).
- **Opens the PickFinder player page**, waits for network activity to settle.
- **Scrapes player/stat data and table rows** into a JS object.
- **Appends a row to Google Sheets** using a Service Account.

---

### Requirements

- Node.js 18+ recommended.
- A **Google account** (email/password) for login.
- A **Google Cloud Service Account** with access to your target Google Sheet.

---

### Installation

From the project root:

```bash
npm install
```

This installs:

- `puppeteer`
- `puppeteer-extra`
- `puppeteer-extra-plugin-stealth`
- `@google-cloud/google-auth-library`
- `googleapis`

---

### Environment Variables

Set the following environment variables before running:

- **Google login (only needed for first run, then cookies are reused)**
  - `GOOGLE_EMAIL` – your Google account email (for the automated login step).
  - `GOOGLE_PASSWORD` – your Google account password.

- **Google Sheets (Service Account)**
  - `GOOGLE_SHEETS_ID` – ID of the Google Sheets document (from its URL).
  - `GOOGLE_SERVICE_ACCOUNT_EMAIL` – service account email.
  - `GOOGLE_PRIVATE_KEY` – private key for the service account.
    - If you paste this into an `.env` or shell, you usually need to replace newlines with `\n`.  
      The script converts `\\n` back to real newlines automatically.

Tip (PowerShell example):

```powershell
$env:GOOGLE_EMAIL="your_email@gmail.com"
$env:GOOGLE_PASSWORD="your_password"
$env:GOOGLE_SHEETS_ID="your_sheet_id_here"
$env:GOOGLE_SERVICE_ACCOUNT_EMAIL="service-account@project.iam.gserviceaccount.com"
$env:GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...key...\n-----END PRIVATE KEY-----\n"
```

> Make sure the **service account email is shared on the Sheet** with at least edit access.

---

### Running the scraper

From the project root:

```bash
node index.js
```

Workflow:

1. **Load cookies** from `cookies.json` (if present and valid).
   - If cookies exist, it **skips Google login** and proceeds.
2. If no cookies:
   - Opens `https://accounts.google.com`.
   - Automatically fills **email** and **password** from env vars.
   - Waits for a successful login.
   - Saves cookies into `cookies.json` for next runs.
3. Opens the PickFinder player URL:
   - `https://www.pickfinder.app/players/nhl/xk4sew4et1xgr8j?from=projections&stat=5&line=2.5&game=ztfgeq5fx67nerq`
   - Waits for `networkidle2` + an additional network-idle wait.
4. **Scrapes**:
   - Player name
   - Stat name
   - Line
   - Projection number
   - Over %
   - Under %
   - Opponent team
   - Game date
   - Any chart/table rows it can detect
   - Some additional key/value style info when available
5. Builds a JS object like:

```js
{
  player: "",
  stat: "",
  line: "",
  projection: "",
  over: "",
  under: "",
  opponent: "",
  game: "",
  rows: [],
  extra: {}
}
```

6. Appends a row to **Google Sheets** (`Sheet1` by default) containing:
   - Timestamp
   - Player, stat, line, projection
   - Over %, under %
   - Opponent, game
   - JSON of `rows`
   - JSON of `extra`

---

### Puppeteer / Stealth configuration

- **Stealth plugin** is enabled via `puppeteer-extra-plugin-stealth`.
- Browser is started with:
  - `headless: false`
  - Args:
    - `--no-sandbox`
    - `--disable-setuid-sandbox`
    - `--disable-blink-features=AutomationControlled`
- A modern **Chrome user-agent** string is set to help bypass:
  - *“This browser is not secure”*.
  - Some automated / bot detections.

The script attempts to avoid reCAPTCHA and “browser not secure” issues by:

- Using Puppeteer Extra + Stealth.
- Using a realistic user-agent and viewport.
- Relying on a persistent session via cookies after the first login.

> Note: As with any automation, Google may still present captchas or challenges depending on your environment, IP, and account risk profile. The provided setup minimizes this but cannot guarantee 100% bypass in all conditions.

---

### Customization

- **Sheet name**: currently hard-coded as `Sheet1` in `index.js` (`sheetName` variable).  
  Change it there or adapt the script to read a `GOOGLE_SHEETS_TAB` env var.

- **PickFinder URL**: change the `PICKFINDER_URL` constant in `index.js` if you want to scrape a different player or stat.

- **Selectors / scraping**: the script uses reasonable selectors and fallbacks; if the PickFinder UI changes, you can refine the queries in `scrapePickfinderData` to better match the DOM.

# PickFinder Scraper

Automated scraper for PickFinder player data with Google Sheets integration. This tool extracts comprehensive player information, matchup data, defense rankings, and more, then uploads it to Google Sheets.

## Features

- ✅ Browser automation using Playwright
- ✅ Google OAuth login via cookie injection
- ✅ Comprehensive data extraction from PickFinder pages
- ✅ Automatic Google Sheets upload
- ✅ Error handling and logging
- ✅ Works locally and on free cloud platforms

## Prerequisites

- Node.js 18+ installed
- Google account for authentication
- Google Cloud project with Sheets API enabled
- Chrome/Chromium browser (installed automatically with Playwright)

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Export Google Login Cookies

You need to export your Google login cookies so the script can authenticate with PickFinder.

#### Method 1: Using Chrome DevTools

1. Open Chrome and navigate to https://www.pickfinder.app
2. Log in using your Google account
3. Open DevTools (F12 or Right-click → Inspect)
4. Go to the **Application** tab (Chrome) or **Storage** tab (Firefox)
5. Expand **Cookies** → Select the domain (`.pickfinder.app` or `.google.com`)
6. Copy all cookies

Alternatively, use a browser extension:

#### Method 2: Using a Cookie Exporter Extension

1. Install the "Get cookies.txt LOCALLY" extension or similar
2. Navigate to https://www.pickfinder.app and log in
3. Click the extension icon and export cookies
4. Convert the exported format to JSON

#### Method 3: Manual Cookie Extraction Script

Create a simple script to help export cookies:

```javascript
// Run this in Chrome DevTools Console while logged into PickFinder
const cookies = document.cookie.split(';').reduce((acc, cookie) => {
  const [name, value] = cookie.trim().split('=');
  acc.push({
    name: name,
    value: value,
    domain: '.pickfinder.app',
    path: '/',
    expires: Math.floor(Date.now() / 1000) + 86400,
    httpOnly: false,
    secure: true,
    sameSite: 'Lax'
  });
  return acc;
}, []);

console.log(JSON.stringify(cookies, null, 2));
```

#### Format cookies.json

Create a `cookies.json` file in the project root with this format:

```json
[
  {
    "name": "cookie_name",
    "value": "cookie_value",
    "domain": ".pickfinder.app",
    "path": "/",
    "expires": 1735689600,
    "httpOnly": false,
    "secure": true,
    "sameSite": "Lax"
  }
]
```

**Important Notes:**
- Include cookies from both `.pickfinder.app` and `.google.com` domains
- Make sure to include authentication cookies (usually contain `SESSION`, `AUTH`, `ID`, etc.)
- Cookies expire after some time - you may need to re-export periodically
- Never commit `cookies.json` to version control (it's in `.gitignore`)

### 3. Set Up Google Sheets Service Account

#### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Sheets API**:
   - Navigate to "APIs & Services" → "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

#### Step 2: Create Service Account

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "Service Account"
3. Fill in the service account details:
   - Name: `pickfinder-scraper`
   - Description: `Service account for PickFinder scraper`
4. Click "Create and Continue"
5. Skip role assignment (or assign "Editor" if needed)
6. Click "Done"

#### Step 3: Generate Service Account Key

1. Click on the newly created service account
2. Go to the "Keys" tab
3. Click "Add Key" → "Create new key"
4. Choose "JSON" format
5. Download the JSON file
6. Rename it to `service_account.json` and place it in the project root

**Important:** Never commit `service_account.json` to version control!

#### Step 4: Create Google Sheet and Share with Service Account

1. Create a new Google Sheet
2. Note the Sheet ID from the URL:
   - URL format: `https://docs.google.com/spreadsheets/d/[SHEET_ID]/edit`
3. Copy the **Service Account Email** from `service_account.json` (field: `client_email`)
4. Share the Google Sheet with the service account email:
   - Click "Share" button in Google Sheets
   - Paste the service account email
   - Give "Editor" permissions
   - Click "Send"

#### Step 5: Set Environment Variable

Set the `SPREADSHEET_ID` environment variable:

**Windows (PowerShell):**
```powershell
$env:SPREADSHEET_ID="your_sheet_id_here"
```

**Windows (CMD):**
```cmd
set SPREADSHEET_ID=your_sheet_id_here
```

**Linux/Mac:**
```bash
export SPREADSHEET_ID="your_sheet_id_here"
```

Or create a `.env` file (if you install `dotenv` package):
```
SPREADSHEET_ID=your_sheet_id_here
```

## Usage

### Run Locally

```bash
npm start
```

Or directly:
```bash
node index.js
```

### Configuration

You can modify these constants in `index.js`:

- `PICKFINDER_URL`: The URL to scrape (default provided)
- `COOKIES_FILE`: Path to cookies file (default: `cookies.json`)
- `SERVICE_ACCOUNT_FILE`: Path to service account file (default: `service_account.json`)
- `WORKSHEET_NAME`: Name of the worksheet (default: `Sheet1`)

### Environment Variables

- `SPREADSHEET_ID`: Your Google Sheet ID (required for Sheets upload)

## Data Structure

The scraper extracts the following data:

```javascript
{
  player: "Player Name",
  team: "Team Name",
  opponent: "Opponent Team",
  prop: "Prop Type (e.g., Goals)",
  line: 2.5,
  position: "Position",
  height: "Height",
  matchup: { /* Matchup stats */ },
  defense: { /* Defense stats */ },
  similar: { /* Similar players stats */ },
  injuries: { /* Injury information */ },
  lineMovement: [
    { line: "...", app: "...", time: "..." }
  ],
  defenseRankings: [
    { statName: "...", opponentRank: "...", allowedValue: "..." }
  ],
  notesTextBlock: "Full text block",
  timestamp: "2024-01-01T00:00:00.000Z"
}
```

## Google Sheets Output

Data is appended to Google Sheets with the following columns:

| Column | Description |
|--------|-------------|
| A | Timestamp |
| B | Player Name |
| C | Team |
| D | Opponent |
| E | Line Value |
| F | Prop Type |
| G | Full JSON String |

## Error Handling

The script includes comprehensive error handling:

- ✅ Cookie expiration detection
- ✅ Page load failure handling
- ✅ Selector change warnings
- ✅ Network timeout handling
- ✅ Missing element warnings

If selectors change, you'll see:
```
⚠️ Element changed — update selector for [description]
```

## Running on Free Platforms

### GitHub Actions

Create `.github/workflows/scraper.yml`:

```yaml
name: PickFinder Scraper

on:
  schedule:
    - cron: '0 */6 * * *'  # Run every 6 hours
  workflow_dispatch:

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npx playwright install chromium
      - name: Run scraper
        env:
          SPREADSHEET_ID: ${{ secrets.SPREADSHEET_ID }}
        run: |
          echo "${{ secrets.COOKIES_JSON }}" > cookies.json
          echo "${{ secrets.SERVICE_ACCOUNT_JSON }}" > service_account.json
          npm start
```

Add secrets in GitHub repo settings:
- `SPREADSHEET_ID`
- `COOKIES_JSON` (content of cookies.json)
- `SERVICE_ACCOUNT_JSON` (content of service_account.json)

### Deno Deploy / Cloudflare Workers

For serverless platforms, you'll need to:
1. Adapt the script to their runtime (Deno/Cloudflare Workers)
2. Use their KV storage for cookies instead of files
3. Handle browser automation via their services or external APIs

## Troubleshooting

### "Cookies expired" error

Re-export your cookies from Chrome and update `cookies.json`.

### "Login required" message

Your cookies may not include the right authentication cookies. Make sure to:
- Include cookies from `.google.com` domain
- Include session cookies
- Export cookies while logged in to PickFinder

### Selectors not found

The website structure may have changed. Update selectors in the `scrapePickFinder()` function in `index.js`.

### Google Sheets upload fails

1. Verify `service_account.json` is correct
2. Ensure service account email has access to the sheet
3. Check that Google Sheets API is enabled
4. Verify `SPREADSHEET_ID` is set correctly

### Page takes too long to load

Increase timeout values in `index.js`:
```javascript
await page.waitForLoadState('networkidle', { timeout: 60000 });
```

## File Structure

```
pickfinder-scraper/
├── index.js                 # Main scraper script
├── package.json             # Dependencies
├── cookies.json             # Your exported cookies (not in git)
├── service_account.json     # Google service account (not in git)
├── cookies.json.template    # Template for cookies format
├── .gitignore              # Git ignore file
└── README.md               # This file
```

## Security Notes

- ⚠️ Never commit `cookies.json` or `service_account.json` to version control
- ⚠️ Keep your service account keys secure
- ⚠️ Rotate cookies periodically
- ⚠️ Use environment variables for sensitive data in production

## License

MIT

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review error messages carefully
3. Update selectors if website structure changed
4. Verify all setup steps are completed

