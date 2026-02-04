# Snorlax

## Screenshots

![Main Dashboard](./images/Main-screen.png)
*Dashboard showing repository sidebar, issue list, and search*

![Triage Modal](./images/Triage-screen.png)
*Issue analysis with AI categorization and draft responses*

![Settings](./images/Setting-modal.png)
*API key configuration*

---

**AI-powered GitHub issue triage that finds duplicates, searches your codebase, and drafts responses—saving maintainers hours every week.**

---

## What It Does

Snorlax indexes your repository's code and issues, then uses semantic search + Claude AI to analyze incoming issues. For each issue, it:
- Finds similar issues and related PRs
- Searches relevant code and documentation
- Categorizes the issue (bug, feature, duplicate, etc.)
- Drafts a response you can review and post

**Cost:** ~$0.003 per issue (70% saved by smart rules, 90% saved by caching)

## When to Use

**Good fit:**
- You maintain OSS projects with 20+ issues/month
- You spend time finding duplicates or related PRs manually
- You need semantic search across your codebase
- You want draft responses for common issue types
- You're comfortable reviewing AI suggestions before posting (~$0.003-0.01 per issue)

**Not a fit:**
- Fewer than 10 issues/month (manual triage is faster)
- Need fully autonomous handling (this requires human review)
- Private repos you can't share with external APIs
- Non-English support needed (English-only currently)

## Quick Start

**Requirements:**
- Docker Desktop (PostgreSQL + pgvector)
- Python 3.9+, Node.js 18+
- Anthropic API key ([get here](https://console.anthropic.com/settings/keys))

**Install:**
```bash
git clone <your-repo-url>
cd snorlax
make setup  # Installs deps, creates .env files, starts database
make dev    # Starts backend (8000) + frontend (3000)
```

**Configure:**
1. Open http://localhost:3000
2. Go to Settings → add Anthropic API key
3. (Optional) Add GitHub token for higher rate limits

**Use:**
1. Click "Add Repository" → paste GitHub URL → wait for indexing (30-120s)
2. Click "Sync from GitHub" to import issues
3. Click any issue → "Analyze issue" → review results → copy or post response

## How It Works

**Indexing:**
- Clones repo, splits code into chunks, generates embeddings using `sentence-transformers/all-MiniLM-L6-v2`
- Imports issues/PRs from GitHub, generates embeddings
- Stores vectors in PostgreSQL with pgvector

**Analysis:**
1. Check cache (7-day TTL)
2. Apply rules: 95%+ similarity = duplicate, skip Claude (70% cost savings)
3. Run 4 parallel vector searches (similar issues, PRs, code, docs)
4. Send to Claude Sonnet 4.5 for categorization + draft response
5. Display results with copy/post buttons

**Key features:**
- Semantic search across issues and code
- Smart rules filter 70% of issues before AI analysis
- 7-day response cache saves 90% on repeat queries
- Manual review required before posting

## Contributing

**Most valuable contributions:**
- More smart rules to reduce AI calls
- Better prompts for edge case accuracy
- Internationalization support
- GitHub integration improvements (webhooks, auto-labels)
- Tests and documentation

**How to contribute:**
Fork → make changes → open PR. Include:
- What changed and why
- How you tested it
- Screenshots for UI changes

Open issues for questions (tag: `question`), bugs (`bug`), or features (`enhancement`).

## Known Limitations

- GitHub.com only (no Enterprise support)
- Must reindex entire repo on code changes (no incremental indexing)
- No monorepo support (indexes entire repo as one project)
- English responses only
- No bulk operations (analyze one issue at a time)
- No undo for posted comments (delete manually on GitHub)

---

<details>
<summary><strong>Technical Details</strong></summary>

### Architecture

**Backend (FastAPI):**
- `routers/` - API endpoints for repos, GitHub, settings, triage
- `services/repo_cloner.py` - Shallow git cloning (depth=1)
- `services/github/api.py` - GitHub API client with retry + rate limiting
- `services/ai/embeddings.py` - sentence-transformers integration
- `services/ai/categorization.py` - Multi-search analysis + Claude
- `services/ai/triage_optimizer.py` - Rule-based filtering + caching
- `flows.py` - CocoIndex semantic indexing pipeline
- `database.py` - PostgreSQL + pgvector connection

**Frontend (Next.js):**
- `app/dashboard/page.tsx` - Main dashboard
- `components/RepoSidebar.tsx` - Repository management
- `components/IssuesPRsPanel.tsx` - Issue list with search
- `components/TriageModeModal.tsx` - Issue analysis UI
- `components/IndexModal.tsx` - Repository import dialog
- `components/SettingsModal.tsx` - API key config

**Database:**
- `repositories` - Tracked repos with indexing status
- `github_issues`, `github_pull_requests` - Synced GitHub data
- `issue_embeddings` - 384-dim vectors with pgvector IVFFlat index
- `embeddings_{project_id}` - Per-repo code chunk embeddings
- `issue_categories` - AI analysis results
- `claude_response_cache` - 7-day response cache

### AI Models

**Embeddings:**
- Model: `sentence-transformers/all-MiniLM-L6-v2`
- Dimensions: 384
- License: MIT (runs locally)
- Use: Semantic similarity search

**LLM:**
- Model: `claude-sonnet-4-5-20250929`
- Context: 200K tokens
- Temperature: 0.3 (focused outputs)
- Max output: 4000 tokens
- Cost: ~$0.005 per analysis (before optimizations)

### Cost Optimization

**Smart rules (70% savings):**
- 95%+ similarity → duplicate (no Claude call)
- Exact code match → already exists
- FAQ pattern match → standard response

**Response cache (90% savings on hits):**
- 7-day TTL on similar analyses
- Cache key: issue embedding + search results hash
- Average cost after optimization: **$0.003 per issue** (vs $0.03 raw)

**Cost breakdown:**
- Input tokens: ~1500 (issue + search results)
- Output tokens: ~2000 (categorization + draft)
- Per-call cost: ~$0.005
- After rules: ~$0.0015 average
- After cache: ~$0.003 average

### Chunking & Indexing

**Code chunking:**
- 1000 bytes per chunk
- 300 bytes overlap
- Language-aware splitting (CocoIndex)
- ~500-2000 chunks per medium repo

**Similarity thresholds:**
- Duplicate issues: 95%+ cosine similarity
- Related PRs: 85%+
- Code matches: 75%+
- Documentation: 70%+

### Environment Variables

**Backend `.env`:**
```bash
APP_DATABASE_URL=postgresql://snorlax:snorlax_password@localhost:5432/snorlax
ADMIN_PASSWORD=your-password  # Optional, for production
GITHUB_WEBHOOK_SECRET=secret  # Optional, webhooks only
```

**Frontend `.env.local`:**
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Dependencies

**Backend:**
`fastapi`, `anthropic`, `pygithub`, `psycopg[binary,pool]`, `pgvector`, `cocoindex>=0.3.20`, `sentence-transformers`, `slowapi`

**Frontend:**
`next@15`, `react@19`, `tailwindcss`, `lucide-react`, `react-markdown`

**Database:**
PostgreSQL 15+ with `pgvector` extension

### Where Claude Is (and Isn't) Used

**Claude is used for:**
1. Issue categorization (critical, bug, feature, question, low_priority)
2. Draft response generation
3. Priority scoring (0-100)

**Claude is NOT used for:**
- Duplicate detection (vector similarity)
- Code search (embedding similarity)
- Related issues/PRs (vector search)
- Rule-based routing (70% of issues)

**Failure handling:**
- API timeout → "Analysis failed" + retry button
- Low confidence (<60%) → warning shown
- No context found → Claude notes "limited context"
- Cache misses → fresh API call
- Errors logged to console

</details>

---

## Support the Developer

If Snorlax saves you time, consider sponsoring:

**[Sponsor this project →](https://github.com/sponsors/YOUR_USERNAME)**
