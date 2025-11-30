# Quick Setup Guide

## Installation Steps

1. **Install dependencies:**
   ```bash
   npm install
   npm run install-browsers
   ```

2. **Set up environment variables:**
   ```bash
   cp env.example .env
   # Edit .env and add your SPREADSHEET_ID
   ```

3. **Set up Google Sheets (if using):**
   - Create service account in Google Cloud Console
   - Download JSON key as `service_account.json`
   - Share your Google Sheet with the service account email
   - Add `SPREADSHEET_ID` to `.env`

4. **Run the scraper:**
   ```bash
   npm run scrape
   ```

## First Run

On first run:
- The browser will open (non-headless)
- If you're signed out, it will click "Sign in with Google"
- You may need to manually complete the Google login
- Cookies will be saved for future runs
- Data will be scraped and exported

## File Structure

```
src/
├── index.ts          # Entry point - orchestrates everything
├── scrape.ts         # Main scraping logic
├── googleAuth.ts     # Google OAuth automation
├── sheets.ts         # Google Sheets export
└── types.ts          # TypeScript definitions
```

## Environment Variables

Required:
- `SPREADSHEET_ID` - Your Google Sheet ID (if using Sheets export)

Optional:
- `PICKFINDER_URL` - URL to scrape (has default)
- `GOOGLE_EMAIL` - For automated login
- `GOOGLE_PASSWORD` - For automated login
- `SERVICE_ACCOUNT_PATH` - Path to service account JSON (default: `service_account.json`)

## Output

- **JSON files:** Saved to `output/scrape_[timestamp].json`
- **Google Sheets:** New tab created with timestamp name
- **Error screenshots:** Saved to `error-screenshot-[timestamp].png` on errors
- **Cookies:** Saved to `.cookies/pickfinder-cookies.json`

## Troubleshooting

See `README_NEW.md` for detailed troubleshooting guide.

