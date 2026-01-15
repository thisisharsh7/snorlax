# Snorlax - GitHub Issue Triage Assistant

AI-powered GitHub issue management platform with semantic code search and real-time synchronization.

## Overview

Snorlax automates GitHub issue triage for open-source maintainers using Claude AI and semantic search. It categorizes issues, detects duplicates, finds implemented features, and generates response suggestions.

## Features

### Core Capabilities
- AI-powered issue categorization using Claude Sonnet 4.5 with 200K context window
- Semantic code search with vector embeddings (pgvector)
- Automatic duplicate detection and related issue linking
- Real-time GitHub webhook synchronization
- One-click comment posting to GitHub issues
- Batch processing of uncategorized issues with progress tracking
- Dark mode support

### Issue Analysis
- Category classification: critical, bug, feature_request, question, low_priority
- Confidence scoring (0-100%)
- Detailed reasoning explanation
- Duplicate detection with similarity scores
- Related pull request identification
- Code file references with line numbers
- Three suggested responses per issue

## Quick Start

### Prerequisites
- Docker Desktop (required for PostgreSQL)
- Python 3.9+
- Node.js 18+
- Anthropic API key ([get here](https://console.anthropic.com/settings/keys))
- GitHub token (optional, increases rate limit from 60 to 5,000/hour)

### Installation

```bash
# Clone repository
git clone <your-repo-url>
cd snorlax

# Run setup (initializes database and installs dependencies)
make setup

# Start development servers
make dev
```

### Configuration

1. Access the dashboard at http://localhost:3000
2. Click Settings and add:
   - Anthropic API Key (required)
   - GitHub Token (optional)
3. Add a repository using the "+" button
4. Import issues from the repository
5. Start triaging in Triage Mode

**Access Points:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/docs
- Database: `postgresql://snorlax:snorlax_password@localhost:5432/snorlax`

## Available Commands

```bash
make validate          # Check system requirements (Docker, Python, Node.js)
make setup             # Initial setup (run once)
make dev               # Start all services
make dev-bg            # Start all services in background

make db-up             # Start PostgreSQL with pgvector
make db-down           # Stop database
make db-migrate        # Run database migrations
make db-reset          # Reset database (deletes all data)

make backend           # Start backend only (port 8000)
make frontend          # Start frontend only (port 3000)

make clean             # Stop all services
make help              # Show all commands
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Backend | FastAPI (Python), Pydantic, Uvicorn |
| Database | PostgreSQL 15 with pgvector extension |
| AI | Claude Sonnet 4.5 (Anthropic) |
| Code Search | CocoIndex with sentence-transformers |
| GitHub | PyGithub with webhook support |
| Infrastructure | Docker, Docker Compose |

## Project Structure

```
snorlax/
├── frontend/                    # Next.js 15 Application
│   ├── app/
│   │   └── dashboard/          # Main dashboard page
│   ├── components/             # React components
│   │   ├── TriageModeModal.tsx
│   │   ├── SettingsModal.tsx
│   │   ├── IssuesPRsPanel.tsx
│   │   ├── CategorizedIssuesPanel.tsx
│   │   └── ...
│   └── lib/
│       └── config.ts           # API configuration
│
├── backend/                    # FastAPI Backend
│   ├── main.py                 # Application entry point
│   ├── api/                    # API Routes
│   │   ├── repositories.py
│   │   ├── github.py
│   │   ├── triage.py
│   │   ├── webhooks.py
│   │   ├── categorization.py
│   │   └── settings.py
│   ├── services/
│   │   ├── ai/
│   │   │   └── categorization.py  # Claude AI integration
│   │   └── github/
│   │       └── api.py          # GitHub API wrapper
│   ├── utils/
│   │   └── database.py
│   └── database/
│       └── migrations/
│
├── infra/
│   └── docker-compose.yml      # PostgreSQL + pgvector
│
├── data/                       # Cloned repositories (gitignored)
├── Makefile
└── README.md
```

## Configuration

### Environment Variables

**Backend** (`backend/.env`):
```bash
APP_DATABASE_URL=postgresql://snorlax:snorlax_password@localhost:5432/snorlax
ALLOWED_ORIGINS=https://yourdomain.com  # Production only
GITHUB_WEBHOOK_SECRET=<generate with: openssl rand -hex 32>
WEBHOOK_URL=https://api.yourdomain.com/api/webhooks/github
DATA_DIR=./data
```

**Frontend** (`frontend/.env.local`):
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000  # Production: https://api.yourdomain.com
```

### GitHub Webhook Setup (Optional)

For real-time issue/PR synchronization:

1. Navigate to repository Settings → Webhooks → Add webhook
2. Set Payload URL from Settings modal in dashboard
3. Set Content type to `application/json`
4. Set Secret to match `GITHUB_WEBHOOK_SECRET` in backend `.env`
5. Select "Issues" and "Pull requests" events
6. Activate the webhook

Test by checking the delivery logs in GitHub webhook settings.

## API Documentation

### Key Endpoints

**Repository Management**
- `POST /api/index` - Index new repository
- `GET /api/repositories` - List repositories
- `DELETE /api/repositories/{project_id}` - Delete repository

**GitHub Integration**
- `POST /api/github/import-issues/{project_id}` - Import issues
- `POST /api/github/import-prs/{project_id}` - Import PRs
- `POST /api/github/post-comment/{project_id}/{issue_num}` - Post comment

**Issue Triage**
- `POST /api/triage/analyze/{project_id}/{issue_num}` - Analyze issue
- `POST /api/triage/batch-triage/{project_id}` - Batch triage
- `GET /api/triage/batch-status/{project_id}` - Check progress

**Webhooks**
- `POST /api/webhooks/github` - GitHub event receiver

**Settings**
- `POST /api/settings` - Save API keys
- `GET /api/settings` - Check configuration

Interactive API documentation: http://localhost:8000/docs

## Security

- Webhook signature verification (HMAC SHA-256)
- API key encryption in database
- CORS protection with configurable origins
- Request size limits (1MB max)
- Database connection pooling
- Automatic resource cleanup with context managers

## Production Deployment

### Checklist

1. Set strong `GITHUB_WEBHOOK_SECRET`: `openssl rand -hex 32`
2. Configure `ALLOWED_ORIGINS` with production domains
3. Set `WEBHOOK_URL` to public API endpoint
4. Use production database with SSL (`sslmode=require`)
5. Set `NEXT_PUBLIC_API_URL` to production backend
6. Configure API keys via Settings UI
7. Set up GitHub webhook in repository settings
8. Test webhook delivery
9. Enable monitoring and logging
10. Configure database backups

### Production Environment Variables

**Backend:**
```bash
APP_DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
ALLOWED_ORIGINS=https://app.com,https://www.app.com
GITHUB_WEBHOOK_SECRET=<strong-random-secret>
WEBHOOK_URL=https://api.yourdomain.com/api/webhooks/github
```

**Frontend:**
```bash
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

## Troubleshooting

### Stop All Services
```bash
lsof -ti:8000 | xargs kill -9  # Backend
lsof -ti:3000 | xargs kill -9  # Frontend
make db-down                    # Database
```

### Reset Database
```bash
make db-reset  # Deletes all data
```

### Fix Module Import Errors
```bash
cd backend
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Webhook Issues
1. Verify `GITHUB_WEBHOOK_SECRET` is set in `backend/.env`
2. Ensure secret matches GitHub webhook configuration
3. Check webhook delivery logs in GitHub settings
4. For local testing, use ngrok to expose backend

### Database Connection Issues
```bash
# Check PostgreSQL status
docker ps | grep postgres

# View logs
docker logs snorlax-postgres-1

# Restart database
make db-down && make db-up
```
