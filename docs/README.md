# GitHub Issues and PRs Management Platform

A web application for viewing and managing GitHub issues and pull requests from any public repository.

## Overview

This platform allows you to import and browse GitHub issues and pull requests in a clean, organized interface. It provides filtering options by state (open/closed/merged) and supports syncing to keep your local view up to date with the repository.

## Features

- Import issues and pull requests from any public GitHub repository
- Filter by state: open, closed, merged (for PRs)
- View issue and PR details including labels, authors, and timestamps
- Sync button to refresh and import new items
- Dark mode support
- Multiple AI provider options (Anthropic, OpenAI, OpenRouter)

## Technology Stack

**Frontend:**
- Next.js 15
- React 18
- TypeScript
- Tailwind CSS

**Backend:**
- FastAPI
- Python 3.11+
- PostgreSQL with pgvector
- PyGithub for GitHub API integration

**Infrastructure:**
- Docker for PostgreSQL
- CocoIndex for code indexing

## Prerequisites

- Python 3.11 or higher
- Node.js 18 or higher
- Docker and Docker Compose
- Git

## Installation

### 1. Database Setup

Start PostgreSQL with pgvector extension:

```bash
docker-compose up -d
```

Verify the database is running:

```bash
docker ps
```

Run database migrations to create the schema:

```bash
cd backend
source venv/bin/activate  # Create venv first if needed
python scripts/run_migrations.py migrate
```

For detailed migration documentation, see [MIGRATIONS.md](MIGRATIONS.md).

### 2. Backend Setup

Navigate to the backend directory and set up the Python environment:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Start the backend server:

```bash
python main.py
```

The API will be available at http://localhost:8000

API documentation can be accessed at http://localhost:8000/docs

### 3. Frontend Setup

In a new terminal, navigate to the frontend directory:

```bash
cd frontend
npm install
npm run dev
```

The application will be available at http://localhost:3000

## Configuration

### Environment Variables

The `.env` file contains system configuration only. API keys are managed through the Settings UI.

Required in `.env`:
- `APP_DATABASE_URL`: PostgreSQL connection string
- `DATA_DIR`: Directory for storing cloned repositories (optional)

### API Keys

API keys are configured through the Settings UI (gear icon in the sidebar):

1. **AI Provider**: Choose between Anthropic Claude, OpenAI, or OpenRouter
   - Required for code analysis features
   - Each provider has different models and pricing

2. **GitHub Token** (optional but recommended):
   - Increases API rate limit from 60 to 5,000 requests per hour
   - No special permissions required for public repositories
   - Create at: https://github.com/settings/tokens

## Usage

### Indexing a Repository

1. Click "Index New Repo" in the sidebar
2. Enter a GitHub repository URL (e.g., https://github.com/owner/repo)
3. Wait for the indexing process to complete
4. The repository will appear in the sidebar with a checkmark when ready

### Viewing Issues and Pull Requests

1. Select an indexed repository from the sidebar
2. Browse the Issues and Pull Requests tabs
3. Use filters to show only open, closed, or merged items
4. Click on any item to view it on GitHub

### Syncing Updates

Click the "Sync from GitHub" button to import new issues and PRs or update existing ones.

## Project Structure

```
code-qa/
├── .env                    # System configuration
├── docker-compose.yml      # PostgreSQL setup
├── MIGRATIONS.md          # Migration system documentation
├── backend/
│   ├── main.py            # FastAPI application
│   ├── flows.py           # CocoIndex flow definition
│   ├── requirements.txt   # Python dependencies
│   ├── database/          # Database management
│   │   ├── migrate.py     # Migration system
│   │   └── migrations/    # SQL migration files
│   │       ├── meta/
│   │       │   └── _journal.json  # Migration tracking
│   │       ├── 0000_initial_schema.sql
│   │       ├── 0001_github_tables.sql
│   │       ├── 0002_settings_table.sql
│   │       └── 0003_add_last_synced_at.sql
│   ├── scripts/
│   │   ├── run_migrations.py  # Migration runner
│   │   └── clean_db.py        # Database cleanup (dev only)
│   └── services/
│       ├── github_service.py  # GitHub API integration
│       ├── repo_cloner.py     # Repository cloning
│       └── query_service.py   # Search functionality
└── frontend/
    ├── package.json
    ├── app/
    │   ├── layout.tsx          # Root layout
    │   ├── page.tsx            # Landing page
    │   └── dashboard/
    │       └── page.tsx        # Main dashboard
    └── components/
        ├── RepoSidebar.tsx     # Repository list
        ├── IssuesPRsPanel.tsx  # Issues and PRs display
        ├── IndexModal.tsx      # Repository indexing modal
        └── SettingsModal.tsx   # API key configuration
```

## API Endpoints

### Repositories

- `POST /api/index` - Index a new repository
- `GET /api/repositories` - List all indexed repositories
- `GET /api/repository-status/{project_id}` - Check indexing status

### GitHub Integration

- `POST /api/github/import-issues/{project_id}` - Import issues and PRs
- `GET /api/github/issues/{project_id}` - Get issues (optional `state` param)
- `GET /api/github/prs/{project_id}` - Get pull requests (optional `state` param)

### Settings

- `GET /api/settings` - Get current settings status
- `POST /api/settings` - Update API keys and provider settings

## Development

### Running Tests

Backend tests:
```bash
cd backend
source venv/bin/activate
pytest
```

### Database Access

Connect to the PostgreSQL database:
```bash
docker exec -it code-qa-postgres-1 psql -U codeqa -d codeqa
```

View tables:
```sql
\dt
```

### Database Migrations

Check migration status:
```bash
cd backend
python scripts/run_migrations.py status
```

Apply pending migrations:
```bash
python scripts/run_migrations.py migrate
```

Create a new migration:
```bash
python scripts/run_migrations.py create add_new_feature
```

Clean database (development only):
```bash
python scripts/clean_db.py
```

For detailed information, see [MIGRATIONS.md](MIGRATIONS.md).

### Logs

Backend logs are written to stdout. To save logs to a file:
```bash
python main.py > backend.log 2>&1
```

## Troubleshooting

**Issue: "cocoindex: command not found"**

Solution: Activate the virtual environment first:
```bash
cd backend
source venv/bin/activate
```

**Issue: "could not connect to server" (PostgreSQL)**

Solution: Ensure Docker is running and start the database:
```bash
docker-compose up -d
```

**Issue: GitHub API rate limit exceeded**

Solution: Add a GitHub personal access token in the Settings UI to increase the rate limit.

**Issue: Indexing takes too long**

Solution: Try a smaller repository first. Large repositories with thousands of files will take longer to index.

**Issue: Frontend shows compilation errors**

Solution: Clear the Next.js cache:
```bash
cd frontend
rm -rf .next
npm run dev
```

## Security Considerations

- API keys are stored in the database, not in environment files
- Keys are never exposed in frontend code or API responses
- The `.env` file contains only system configuration
- For production deployments, implement proper authentication and rate limiting

## License

MIT
