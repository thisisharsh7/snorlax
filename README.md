# Snorlax

## What this project does

Snorlax indexes your GitHub repository's source code and issues into a vector database, then uses semantic search and Claude AI to analyze incoming issues. When you analyze an issue, it runs four parallel searches (similar issues, related PRs, matching code, documentation), sends the results to Claude, and returns a categorization with draft response text you can copy or post directly to GitHub. The system optimizes costs by applying rule-based filters first (70% cost reduction) and caching AI responses for 7 days (90% reduction on cache hits), bringing the average cost to $0.003 per issue instead of $0.03.

## When you should use this

- You maintain an open-source project with 20+ issues per month and struggle to keep up
- You spend significant time finding duplicate issues or related PRs manually
- You want semantic search across your codebase to answer "where is this implemented?"
- You need draft responses to common issue types (duplicates, already-implemented, answered in docs)
- You're willing to review AI suggestions before posting (this is not autonomous)
- You have an Anthropic API key and are comfortable with ~$0.003-0.01 per analyzed issue

## When you should NOT use this

- Your project receives fewer than 10 issues per month (manual triage is faster)
- You need fully autonomous issue handling (this requires human review before posting)
- You cannot tolerate occasional AI mistakes in categorization (confidence scores are shown but not perfect)
- Your repository is private and you cannot share code with external APIs (embeddings are sent to sentence-transformers, issue text to Claude)
- You need multi-language support beyond English (AI responses are English-only currently)
- You want real-time GitHub integration (webhook support exists but requires manual setup; default is manual import)
- Your codebase is primarily non-code (images, binaries, datasets) - indexing focuses on source code

## How it works (high level)

When you add a repository, Snorlax clones it (shallow, depth=1), splits source files into 1000-byte chunks with 300-byte overlap, generates 384-dimensional embeddings using `sentence-transformers/all-MiniLM-L6-v2`, and stores them in PostgreSQL with pgvector indexes. It then imports issues and PRs from GitHub, generating embeddings for those as well using the same model to ensure comparability.

When you analyze an issue, the system:
1. Checks cache for similar analysis (7-day TTL)
2. Applies smart rules: 95%+ similarity = duplicate, exact code match = already exists (no Claude call)
3. If rules don't match, runs 4 parallel vector similarity searches against stored embeddings
4. Sends issue text + search results to Claude Sonnet 4.5
5. Claude returns structured JSON with category, confidence, reasoning, evidence bullets, and draft response
6. Results are displayed with copy/post buttons and stored in database for audit

The frontend is a Next.js dashboard with a sidebar showing repositories, main panel showing issues, and a triage modal for analyzing individual issues. Everything updates via polling (no websockets).

![Main dashboard showing repository sidebar (left), issue list (center), and search bar (top)](./Main-screen.png)

## Core components

**Backend (FastAPI):**
- `routers/` - API endpoints for repos, GitHub, settings, triage
- `services/repo_cloner.py` - Git operations, shallow cloning
- `services/github/api.py` - GitHub API client with retry logic and rate limit handling
- `services/github/background_jobs.py` - Progressive issue/PR sync with priority queue
- `services/ai/embeddings.py` - Embedding generation for issues using sentence-transformers
- `services/ai/categorization.py` - Multi-search analysis and Claude integration
- `services/ai/triage_optimizer.py` - Rule-based filtering and caching layer
- `flows.py` - CocoIndex semantic indexing pipeline for source code
- `database.py` - PostgreSQL connection with pgvector support

**Frontend (Next.js):**
- `app/dashboard/page.tsx` - Main dashboard layout
- `components/RepoSidebar.tsx` - Repository list and management
- `components/IssuesPRsPanel.tsx` - Issue list with search and filtering
- `components/TriageModeModal.tsx` - Individual issue analysis interface
- `components/IndexModal.tsx` - Repository import dialog
- `components/SettingsModal.tsx` - API key configuration

**Database:**
- `repositories` - Tracked repos with indexing status
- `github_issues`, `github_pull_requests` - Synced GitHub data
- `issue_embeddings` - 384-dim vectors with pgvector IVFFlat index
- `embeddings_{project_id}` - Per-repo code chunk embeddings (CocoIndex tables)
- `issue_categories` - AI analysis results with reasoning and suggested responses
- `claude_response_cache` - 7-day cache to reduce API costs

## Setup & requirements

**Required:**
- Docker Desktop (for PostgreSQL with pgvector)
- Python 3.9+ with pip
- Node.js 18+ with npm
- Anthropic API key (get from https://console.anthropic.com/settings/keys)

**Optional but recommended:**
- GitHub Personal Access Token (increases rate limit from 60/hr to 5000/hr)

**Environment:**

Backend `.env` (created by `make setup`):
```bash
APP_DATABASE_URL=postgresql://snorlax:snorlax_password@localhost:5432/snorlax
ADMIN_PASSWORD=your-admin-password  # Optional, for production deployments
GITHUB_WEBHOOK_SECRET=your-secret   # Optional, only if using webhooks
```

Frontend `.env.local` (created by `make setup`):
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Install:**
```bash
git clone <your-repo-url>
cd snorlax
make setup  # Installs deps, creates .env files, starts database
make dev    # Starts backend (port 8000) + frontend (port 3000)
```

Open http://localhost:3000, go to Settings, add your Anthropic API key. Optionally add GitHub token for higher rate limits.

_// Screenshot: Settings modal showing Anthropic API key input (required) and GitHub token input (optional)_

**Dependencies:**

Backend requires: `fastapi`, `anthropic`, `pygithub`, `psycopg[binary,pool]`, `pgvector`, `cocoindex>=0.3.20`, `sentence-transformers`, `slowapi` (rate limiting)

Frontend requires: `next@15`, `react@19`, `tailwindcss`, `lucide-react`, `react-markdown`

Database requires: PostgreSQL 15+ with `pgvector` extension enabled

## Typical workflow

1. **Add repository:**
   - Click "Add Repository" in sidebar
   - Paste GitHub URL (e.g., `https://github.com/owner/repo`)
   - Click "Index repository"
   - Wait 30-120 seconds for cloning + embedding generation (progress shown)

2. **Import issues:**
   - Once indexed, click "Sync from GitHub" button
   - System imports issues and PRs in priority order: open issues first, then open PRs, then closed
   - Imports in batches of 100 with rate limit handling
   - Progress indicator shows `imported/total`

3. **Analyze an issue:**
   - Click any issue in the main panel
   - Triage modal opens showing issue details on left
   - Click "Analyze issue" button on right
   - Wait 5-10 seconds for analysis (parallel searches + Claude API call)
   - Review decision card with category, reasoning, and evidence bullets
   - Review draft response in "Draft response" section
   - Click "Copy" to copy response text, or "Post" to post directly to GitHub

   ![Triage modal showing issue details (left pane), analysis results with category badge and reasoning (right pane), and draft response text below](./Triage-screen.png)

4. **Navigate between issues:**
   - Use Previous/Next buttons at bottom of triage modal
   - Or use keyboard: `j`/`↓` for next, `k`/`↑` for previous, `Esc` to close

5. **Search issues:**
   - Use search bar at top of issues panel
   - Enter query (e.g., "authentication bugs", "memory leaks")
   - Semantic search returns ranked results with similarity scores
   - Click result to open in triage modal

6. **Re-index (if code changes):**
   - Hover over repository in sidebar
   - Click circular arrow icon to re-index
   - Useful after major code refactors or when adding new files

## AI usage (explicit and honest)

**Where Claude is used:**

1. **Issue categorization** - Analyzing issue text + search results to determine category (critical, bug, feature_request, question, low_priority). Cost: ~$0.005 per call.

2. **Response generation** - Writing draft comment text based on category and context. Cost: included in above, ~2000 output tokens.

3. **Priority scoring** - Assigning 0-100 priority based on keywords like "security", "crash", "blocking". Cost: part of same API call.

**What Claude does NOT decide:**

- Whether to post the response (you must click "Post" after reviewing)
- Issue closure (you must close manually on GitHub)
- Labels or milestones (not modified)
- Assignment or triage state (not touched)

**Where AI is NOT used:**

1. **Duplicate detection** - Uses vector similarity (cosine distance) with 95% threshold. No LLM needed for mathematical comparison.

2. **Code search** - Semantic search via embeddings, not AI. Finds code chunks with >75% similarity to issue description.

3. **Related issues/PRs** - Vector search with >85% similarity threshold. Deterministic, instant, free.

4. **Rule-based routing** - 70% of issues match smart rules (e.g., FAQ patterns, exact duplicates) and skip Claude entirely.

**Failure handling:**

- If Claude API times out (rare), you see "Analysis failed" with retry button
- If confidence is below 60%, the system shows "Low confidence" warning in UI
- If no similar issues/code found, Claude still provides analysis but notes "limited context"
- All API errors are logged to console for debugging
- Cache misses trigger fresh Claude calls; cache hits return instantly

**Cost transparency:**

- Each analysis displays estimated cost in UI (typically $0.003-0.01)
- Cache hits show "Cost saved: $X" badge
- Dashboard shows cumulative daily costs (if you implement tracking endpoint)
- Smart rules reduce costs by 70% (no Claude call needed)
- 7-day cache reduces remaining calls by 90%

**Model specifics:**

- Embeddings: `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions, MIT license, runs locally)
- LLM: `claude-sonnet-4-5-20250929` (Anthropic API, 200K context window)
- Temperature: 0.3 (focused, consistent outputs)
- Max tokens: 4000 output
- Prompt: Structured JSON schema with strict output format

## Project status & contribution notes

**Current maturity:** Alpha / early production

This project works and is used by maintainers for real triage, but expect rough edges:
- Error messages could be clearer
- No undo for posted comments (you must delete manually on GitHub)
- Search UI is functional but basic
- No bulk operations (analyze one issue at a time)
- No GitHub webhook delivery verification (accepts all POST requests)

**Where contributions are most valuable:**

1. **Cost optimization** - More smart rules to reduce Claude calls further
2. **Better prompts** - Improve categorization accuracy for edge cases
3. **Internationalization** - Support for non-English issues and responses
4. **GitHub integration** - Better webhook handling, auto-label application, issue templates
5. **Search improvements** - Filter by labels, date ranges, author
6. **Analytics** - Cost tracking dashboard, categorization accuracy metrics
7. **Tests** - Unit tests for core services, integration tests for API endpoints
8. **Documentation** - API docs, deployment guides, architecture diagrams

**Known limitations:**

- No support for GitHub Enterprise (only public GitHub.com)
- No incremental code indexing (must reindex entire repo on changes)
- No support for monorepos (indexes entire repo as single project)
- No integration with GitHub Projects, Actions, or other tools
- Response drafts are English-only
- Cannot analyze issues without source code context (works best with code-related issues)

**Contributing:**

Fork, make changes, open PR. No CLA required. Please include:
- Description of what changed and why
- Any new dependencies added (explain necessity)
- How you tested the change
- Screenshots if UI changes

**Questions?** Open an issue. Tag as `question` for setup help, `bug` for errors, `enhancement` for feature requests.

---

## Support the project

If this tool saves you time triaging issues, consider supporting its development:

**[Sponsor this project →](https://github.com/sponsors/YOUR_USERNAME)**

Sponsorships help cover:
- API costs for testing and development
- Infrastructure for running the public demo
- Time spent on maintenance and improvements

All sponsorship tiers are appreciated. Even small contributions help sustain open-source work.

---

**License:** MIT (see LICENSE file)

**Disclaimer:** This tool sends issue text and code snippets to external APIs (Anthropic for Claude, public sentence-transformer models). Do not use with confidential or proprietary code unless you have reviewed and approved these integrations.
