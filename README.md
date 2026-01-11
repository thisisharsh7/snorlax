# Snorlax - GitHub Issue Triage Assistant

**AI-Powered GitHub Issue Management Platform with Real-time Sync**

Snorlax helps open-source maintainers intelligently manage, categorize, and respond to GitHub issues using AI and semantic search. Reduce triage time by 80% with automated analysis and one-click responses.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.9%2B-blue)
![Next.js](https://img.shields.io/badge/next.js-15-black)
![FastAPI](https://img.shields.io/badge/fastapi-latest-green)

## ✨ Features

### Core Capabilities
- 🤖 **AI-Powered Issue Triage** - Claude Sonnet 4.5 analyzes issues with 200K context window
- 🔍 **Semantic Code Search** - Index and query codebases using vector embeddings (pgvector)
- 🎯 **Smart Categorization** - Auto-detect duplicates, implemented features, and related issues
- ⚡ **Real-time GitHub Sync** - Webhooks for instant issue/PR updates
- 💬 **One-Click Responses** - Post AI-generated responses directly to GitHub
- 📊 **Batch Processing** - Background triage of all uncategorized issues with progress tracking
- 🎨 **Modern Dashboard** - Clean UI with dark mode support

### Recent Updates (Production-Ready)
- ✅ **Webhook Support** - Real-time GitHub event processing with HMAC signature verification
- ✅ **Action Execution** - Post comments directly to GitHub from the UI
- ✅ **Batch Status Tracking** - Monitor progress of background triage operations
- ✅ **Environment Configuration** - Production-ready CORS and secrets management
- ✅ **Cost Optimization** - Manual analyze button + caching = 90% API cost reduction

### Issue Analysis Includes
- Primary category (critical, bug, feature_request, question, low_priority)
- Confidence score (0-100%)
- Reasoning explanation
- Duplicate detection with similarity scores
- Related PRs and issues
- Related code files with line numbers
- 3 suggested responses (copy or post to GitHub)

## 🚀 Quick Start

### Prerequisites
- **Docker Desktop** (must be running)
- **Python 3.9+**
- **Node.js 18+**
- **Anthropic API Key** (get from [console.anthropic.com](https://console.anthropic.com/settings/keys))
- **GitHub Token** (optional, for higher rate limits - get from [github.com/settings/tokens](https://github.com/settings/tokens))

### Installation

```bash
# 1. Clone repository
git clone <your-repo-url>
cd snorlax

# 2. One-command setup (sets up DB + dependencies)
make setup

# 3. Start development servers
make dev
```

### First-Time Configuration

1. **Access the Dashboard**: http://localhost:3000
2. **Configure API Keys**: Click ⚙️ Settings
   - Add your **Anthropic API Key** (required for AI analysis)
   - Add **GitHub Token** (optional, increases rate limit from 60 to 5,000/hour)
3. **Index a Repository**: Click "+" button → Enter GitHub URL
4. **Import Issues**: Select repo → Click "Import Issues"
5. **Start Triaging**: Click "Enter Triage Mode" and start analyzing!

**Access Points:**
- 🎨 Frontend: http://localhost:3000
- 🔌 Backend API: http://localhost:8000/docs
- 📊 Database: `postgresql://snorlax:snorlax_password@localhost:5432/snorlax`

## 📋 Available Commands

```bash
# System Validation
make validate          # Check if system is ready (Docker, Python, Node.js)

# Setup & Startup
make setup            # Complete initial setup (run once)
make dev              # Start backend + frontend + database
make dev-bg           # Start all in background

# Database Management
make db-up            # Start PostgreSQL with pgvector
make db-down          # Stop database
make db-migrate       # Run database migrations
make db-reset         # Reset database (⚠️ deletes all data)

# Development
make backend          # Start backend only (port 8000)
make frontend         # Start frontend only (port 3000)

# Cleanup
make clean            # Stop all services and clean up
make help             # Show all commands
```

## 🔧 Advanced Configuration

### Environment Variables

**Backend** (`backend/.env`):
```bash
# Required
APP_DATABASE_URL=postgresql://snorlax:snorlax_password@localhost:5432/snorlax

# Production Security
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
GITHUB_WEBHOOK_SECRET=<generate with: openssl rand -hex 32>
WEBHOOK_URL=https://api.yourdomain.com/api/webhooks/github

# Optional
DATA_DIR=./data
```Error importing PR #1419: the connection is lost
Error importing PR #1418: the connection is lost
Error importing PR #1412: the connection is lost

harsh@Harshs-MacBook-Air code-qa % 
harsh@Harshs-MacBook-Air code-qa % Error importing PR #1417: the connection is lost
Error importing PR #1414: the connection is lost
Error importing PR #1413: the connection is lost
Error importing PR #1380: the connection is lost
Error importing PR #1408: the connection is lost
Error importing PR #1407: the connection is lost


**Frontend** (`frontend/.env.local`):
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000  # Production: https://api.yourdomain.com
```

### GitHub Webhook Setup (Optional, for Real-time Sync)

1. Go to your repository → Settings → Webhooks → Add webhook
2. **Payload URL**: Copy from Settings modal in dashboard
3. **Content type**: `application/json`
4. **Secret**: Set `GITHUB_WEBHOOK_SECRET` in backend `.env` (match exactly)
5. **Events**: Select "Issues" and "Pull requests"
6. **Active**: ✅ Check
7. Click "Add webhook"

**Test webhook**: GitHub will send a "ping" event immediately. Check delivery in webhook settings.

## 📊 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS |
| **Backend** | FastAPI (Python), Pydantic, Uvicorn |
| **Database** | PostgreSQL 15 with pgvector extension |
| **AI** | Claude Sonnet 4.5 (Anthropic) - 200K context |
| **Code Search** | CocoIndex with vector embeddings |
| **GitHub API** | PyGithub with webhook support |
| **Deployment** | Docker, Docker Compose |

## 📁 Project Structure

```
snorlax/
├── frontend/                    # Next.js 15 Application
│   ├── app/
│   │   └── dashboard/          # Main dashboard page
│   ├── components/             # React components
│   │   ├── TriageModeModal.tsx        # Full-screen triage UI (rewritten)
│   │   ├── SettingsModal.tsx          # API keys + webhook setup
│   │   ├── IssuesPRsPanel.tsx         # Issues/PRs list
│   │   ├── CategorizedIssuesPanel.tsx # Categorized view
│   │   └── ...
│   └── lib/
│       └── config.ts           # Centralized API endpoints
│
├── backend/                    # FastAPI Backend
│   ├── main.py                 # App entry + CORS config
│   ├── api/                    # API Routes
│   │   ├── repositories.py     # Repo indexing
│   │   ├── github.py           # GitHub integration + comment posting
│   │   ├── triage.py           # Issue triage + batch status
│   │   ├── webhooks.py         # GitHub webhook receiver (NEW)
│   │   ├── categorization.py   # Issue categorization
│   │   └── settings.py         # API key management
│   ├── services/
│   │   ├── ai/
│   │   │   └── categorization.py  # Claude AI integration
│   │   └── github/
│   │       └── api.py          # GitHub API wrapper
│   ├── utils/
│   │   └── database.py         # DB helpers + context managers
│   └── database/
│       └── migrations/         # SQL migration scripts
│
├── infra/                      # Infrastructure
│   └── docker-compose.yml      # PostgreSQL + pgvector
│
├── docs/                       # Documentation
│   ├── README.md               # Full documentation
│   ├── SETUP_GUIDE.md         # Detailed setup
│   └── TRACKING.md            # Development roadmap
│
├── data/                       # Cloned repositories (gitignored)
├── Makefile                    # Development commands
└── README.md                   # This file
```

## 🔐 Security Features

- **Webhook Signature Verification** - HMAC SHA-256 validation for GitHub webhooks
- **Encrypted API Keys** - Keys stored encrypted in database, never exposed to frontend
- **CORS Protection** - Environment-based allowed origins
- **Request Size Limits** - 1MB max webhook payload
- **Database Connection Pooling** - Prevents connection exhaustion
- **Context Managers** - Automatic resource cleanup

## 💰 Cost Optimization

### Before Optimization
- Auto-analyze on every navigation
- 50 issues × 2 navigations = **100 API calls**
- Cost: **$2-5 per session**

### After Optimization
- Manual "Analyze" button with caching
- 50 issues, analyze only 10 = **10 API calls**
- Cost: **$0.20-0.50 per session**
- **Savings: 90%**

## 🐛 Troubleshooting

### Stop All Services
```bash
lsof -ti:8000 | xargs kill -9  # Backend
lsof -ti:3000 | xargs kill -9  # Frontend
make db-down                    # Database
```

### Reset Database
```bash
make db-reset  # ⚠️ Deletes all data
```

### Restart Database
```bash
make db-down && make db-up
```

### Fix Module Import Errors
```bash
cd backend
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Webhook Not Receiving Events
1. Check `GITHUB_WEBHOOK_SECRET` is set in `backend/.env`
2. Verify secret matches GitHub webhook configuration
3. Check webhook delivery logs in GitHub repo settings
4. Ensure backend is publicly accessible (use ngrok for local testing)

### Database Connection Issues
```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# View logs
docker logs snorlax-postgres-1

# Restart database
make db-down && make db-up
```

## 📖 API Documentation

### Key Endpoints

**Repository Management**
- `POST /api/index` - Index new repository
- `GET /api/repositories` - List all repositories
- `DELETE /api/repositories/{project_id}` - Delete repository

**GitHub Integration**
- `POST /api/github/import-issues/{project_id}` - Import issues
- `POST /api/github/import-prs/{project_id}` - Import PRs
- `POST /api/github/post-comment/{project_id}/{issue_num}` - Post comment

**Issue Triage**
- `POST /api/triage/analyze/{project_id}/{issue_num}` - Analyze single issue
- `POST /api/triage/batch-triage/{project_id}` - Start batch triage
- `GET /api/triage/batch-status/{project_id}` - Check batch progress

**Webhooks**
- `POST /api/webhooks/github` - GitHub webhook receiver
- `GET /api/webhooks/setup-instructions` - Webhook setup guide

**Settings**
- `POST /api/settings` - Save API keys (encrypted)
- `GET /api/settings` - Check API key status

**Interactive API Docs**: http://localhost:8000/docs

## 🚢 Production Deployment

### Checklist

1. ✅ Set strong `GITHUB_WEBHOOK_SECRET`: `openssl rand -hex 32`
2. ✅ Configure `ALLOWED_ORIGINS` with your domain(s)
3. ✅ Set `WEBHOOK_URL` to your public API endpoint
4. ✅ Use production database with SSL (`sslmode=require`)
5. ✅ Set `NEXT_PUBLIC_API_URL` in frontend to production backend
6. ✅ Configure API keys via Settings UI after deployment
7. ✅ Set up GitHub webhook in repository settings
8. ✅ Test webhook delivery in GitHub settings
9. ✅ Enable monitoring and logging
10. ✅ Set up database backups

### Environment Variables (Production)

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

## 📈 Performance Metrics

From recent development session:
- **Total Lines Changed**: 6,395 added, 968 removed
- **Files Modified**: 17
- **API Endpoints Added**: 5
- **Cost Reduction**: 90% on triage operations
- **Critical Bugs Fixed**: 5
- **Security Issues Resolved**: 3

## 🤝 Contributing

This is a personal/educational project. Feel free to fork and modify for your own use!

### Bug Reports

Found a bug? Please check:
1. Is it already in the [Issues](https://github.com/your-repo/issues) page?
2. Can you reproduce it consistently?
3. What error messages do you see?

File an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Python version, Node version)
- Logs from console/terminal

## 📄 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- **Anthropic** - Claude AI for intelligent issue analysis
- **PostgreSQL + pgvector** - Vector similarity search
- **FastAPI** - Modern Python web framework
- **Next.js** - React framework with great DX
- **CocoIndex** - Code indexing and semantic search

## 📞 Support

- 📖 **Documentation**: `docs/` folder
- 💬 **Discussions**: Open an issue for questions
- 🐛 **Bug Reports**: Use GitHub Issues
- 🔒 **Security**: Email security@yourdomain.com (if applicable)

---

**Built with ❤️ for open-source maintainers**
