# Snorlax

**AI-Powered GitHub Issue Management Platform**

Snorlax helps open-source maintainers intelligently manage, categorize, and respond to GitHub issues using AI and semantic search.

## Features

- **Semantic Code Search** - Index and query codebases using vector embeddings
- **AI-Powered Issue Categorization** - Automatically detect duplicates, implemented features, and related issues
- **GitHub Integration** - Import and sync issues, PRs, and comments
- **Intelligent Responses** - Generate contextual responses using code context
- **Modern Dashboard** - Clean UI with dark mode support

## Prerequisites

- Docker Desktop (must be running)
- Python 3.9+
- Node.js 18+

## Quick Start

```bash
# Clone and navigate
git clone <your-repo-url>
cd snorlax

# One-command setup
make setup

# Start the application
make dev
```

**Access:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/docs

**First-time setup:**
- Open http://localhost:3000 → Settings → Add your Anthropic API key

## Available Commands

```bash
make validate      # Check if system is ready
make setup         # Complete initial setup (run once)
make dev           # Start development servers
make db-up         # Start database only
make db-down       # Stop database
make db-migrate    # Run database migrations
make db-reset      # Reset database (deletes all data)
make clean         # Clean up everything
make help          # Show all commands
```

## Troubleshooting

**Stop all services:**
```bash
lsof -ti:8000 | xargs kill -9  # Kill backend
lsof -ti:3000 | xargs kill -9  # Kill frontend
make db-down                    # Stop database
```

**Reset database after configuration changes:**
```bash
make db-reset
```

**Restart database:**
```bash
make db-down && make db-up
```

**Module import errors:**
```bash
cd backend && rm -rf venv && python3 -m venv venv
source venv/bin/activate && pip install -r requirements.txt
```

## Tech Stack

**Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS
**Backend:** FastAPI (Python), CocoIndex, PostgreSQL + pgvector
**AI:** Claude/OpenAI/OpenRouter integration

## Documentation

- [Full Documentation](docs/README.md) - Complete project overview
- [Setup Guide](docs/SETUP_GUIDE.md) - Detailed installation instructions
- [Development Tracking](docs/TRACKING.md) - Implementation roadmap and progress

## Project Structure

```
snorlax/
├── frontend/          # Next.js frontend application
├── backend/          # FastAPI backend
│   ├── api/          # API route modules
│   ├── models/       # Pydantic data models
│   ├── services/     # Business logic
│   │   ├── github/   # GitHub integration
│   │   └── ai/       # AI services
│   ├── database/     # Migrations and DB utilities
│   └── utils/        # Helper functions
├── infra/            # Docker and infrastructure
├── docs/             # Documentation
└── data/             # Cloned repositories
```

## Configuration

Environment variables are in `backend/.env` (created automatically by `make setup`).

**API Keys:** Configure via Settings UI after starting the app
- Anthropic (Claude) - Recommended
- OpenAI - Alternative
- OpenRouter - Alternative

## Contributing

This is a personal/educational project. Feel free to fork and modify for your own use!

## License

MIT License - see LICENSE file for details
