# Environment Setup Guide

## Quick Setup

### 1. Configure System (1 minute)

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env` - just update database connection:
```bash
APP_DATABASE_URL=postgresql://username:password@localhost:5432/database_name
DATA_DIR=./data
```

**That's it for .env!** Only 2 configuration lines.

### 2. Add API Keys (via UI)

API keys are **no longer stored in .env files**. Instead:

1. Start the application
2. Open the frontend at http://localhost:3000/dashboard
3. Click the ⚙️ Settings button (top-right corner)
4. Add your API keys:
   - **Anthropic API Key**: Get from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
   - **GitHub Token**: Get from [github.com/settings/tokens](https://github.com/settings/tokens) (optional, but increases rate limit from 60 to 5,000 requests/hour)

Keys are stored securely in the database and encrypted.

## What's Required vs Optional

### Required ✅
- `APP_DATABASE_URL` - PostgreSQL connection string

### Optional 📝
- `DATA_DIR` - Where to store cloned repos (defaults to `./data`)

### NOT in .env anymore ❌
- ~~`ANTHROPIC_API_KEY`~~ - Now in Settings UI
- ~~`GITHUB_TOKEN`~~ - Now in Settings UI

## Why This is Better

- ✅ **No secret leaks** - API keys not in files that might be committed
- ✅ **User-friendly** - Non-technical users can add keys via UI
- ✅ **Secure** - Keys stored in database, not plain text files
- ✅ **Hot-reload** - Update keys without restarting the server
- ✅ **Clean** - Only 2 lines in .env file

## Security Notes

- `.env` file is in `.gitignore` - never commit it
- API keys are stored in the database with proper access controls
- Keys are never exposed in API responses (only boolean flags)
- Frontend never sees the actual keys (password-masked)
