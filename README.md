# Snorlax

AI-powered GitHub issue triage assistant using Claude and semantic code search.

## What It Does

Automatically categorizes GitHub issues, detects duplicates, finds related code, and generates response suggestions.

## Setup

**Prerequisites:**
- Docker Desktop
- Python 3.9+
- Node.js 18+
- Anthropic API key

**Install:**

```bash
git clone <your-repo-url>
cd snorlax
make setup
make dev
```

**Configure:**

1. Open <http://localhost:3000>
2. Add Anthropic API key in Settings
3. Add repository and import issues
4. Start triaging

## Commands

```bash
make setup      # Initial setup
make dev        # Start all services
make db-reset   # Reset database
make clean      # Stop all services
```

## Tech Stack

- Frontend: Next.js 15, React 19, TypeScript
- Backend: FastAPI, Python
- Database: PostgreSQL with pgvector
- AI: Claude Sonnet 4.5

## Configuration

**Backend** (`backend/.env`):

```bash
APP_DATABASE_URL=postgresql://snorlax:snorlax_password@localhost:5432/snorlax
```

**Frontend** (`frontend/.env.local`):

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Troubleshooting

**Stop services:**

```bash
lsof -ti:8000 | xargs kill -9  # Backend
lsof -ti:3000 | xargs kill -9  # Frontend
make db-down                    # Database
```

**Reset database:**

```bash
make db-reset
```
