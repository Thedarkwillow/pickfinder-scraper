# Setup Checklist

Use this checklist to ensure everything is configured correctly before running the scraper.

## ✅ Prerequisites

- [ ] Node.js 18+ installed (`node --version`)
- [ ] npm installed (`npm --version`)

## ✅ Installation

- [ ] Run `npm install`
- [ ] Run `npx playwright install chromium`
- [ ] Verify `node_modules/` folder exists

## ✅ Cookie Setup

- [ ] Exported cookies from Chrome while logged into PickFinder
- [ ] Created `cookies.json` file in project root
- [ ] Verified cookies.json format is correct (array of cookie objects)
- [ ] Included cookies from both `.pickfinder.app` and `.google.com` domains

**Cookie File Format:**
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

## ✅ Google Sheets Setup (Optional)

- [ ] Created Google Cloud project
- [ ] Enabled Google Sheets API
- [ ] Created Service Account
- [ ] Downloaded service account JSON key
- [ ] Saved as `service_account.json` in project root
- [ ] Created Google Sheet
- [ ] Shared sheet with service account email (from JSON file)
- [ ] Copied Sheet ID from URL
- [ ] Set `SPREADSHEET_ID` environment variable

**Service Account Email:**
- Found in `service_account.json` → `client_email` field
- Format: `your-service-account@project-id.iam.gserviceaccount.com`

**Environment Variable:**
```bash
# Windows PowerShell
$env:SPREADSHEET_ID="your_sheet_id_here"

# Windows CMD  
set SPREADSHEET_ID=your_sheet_id_here

# Mac/Linux
export SPREADSHEET_ID="your_sheet_id_here"
```

## ✅ File Structure

Verify these files exist:

- [ ] `index.js` - Main scraper script
- [ ] `package.json` - Dependencies
- [ ] `cookies.json` - Your exported cookies ⚠️ Don't commit!
- [ ] `service_account.json` - Google service account ⚠️ Don't commit!
- [ ] `.gitignore` - Git ignore file
- [ ] `README.md` - Full documentation
- [ ] `QUICKSTART.md` - Quick start guide
- [ ] `cookie-extractor.js` - Helper script for cookie export

## ✅ Test Run

- [ ] Run `npm start`
- [ ] Browser opens successfully
- [ ] Page loads without login prompt
- [ ] Scraping completes without errors
- [ ] JSON file created in project root
- [ ] Data appears in Google Sheet (if configured)

## 🔧 Common Issues

**Cookies expired:**
- Solution: Re-export cookies from Chrome

**Login required:**
- Solution: Include Google authentication cookies, not just PickFinder cookies

**Selectors not found:**
- Solution: Website structure changed, update selectors in `index.js`

**Sheets upload fails:**
- Solution: Verify service account has access to sheet, check Sheet ID

## 📝 Next Steps

1. Run scraper: `npm start`
2. Check output JSON file for scraped data
3. Verify Google Sheet has new row (if configured)
4. Set up scheduled runs (GitHub Actions, cron, etc.)

## 🚀 Ready to Run?

Once all items are checked, you're ready to run:

```bash
npm start
```

Happy scraping! 🎉

