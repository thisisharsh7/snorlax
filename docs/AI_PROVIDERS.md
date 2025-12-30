# AI Providers Used in Code Q&A Platform

## Quick Answer
**You only need 1 API key: Anthropic Claude** (for answering questions)

## Detailed Breakdown

### 1. 🔢 Embeddings (Indexing Code)
**Provider:** Local SentenceTransformers
**Model:** `sentence-transformers/all-MiniLM-L6-v2`
**Cost:** FREE (runs on your machine)
**API Key:** NOT NEEDED ✅
**Size:** ~90MB (downloads once)
**Used for:** Converting code into vectors for semantic search

**Why local?**
- Faster (no API calls)
- Private (code never leaves your machine)
- Free (no usage costs)
- Reliable (no rate limits)

### 2. 🤖 LLM (Answering Questions)
**Provider:** Anthropic
**Model:** Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
**Cost:** Pay-as-you-go (see [Anthropic pricing](https://www.anthropic.com/pricing))
**API Key:** REQUIRED ⚠️
**Get key:** [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
**Used for:** Generating intelligent answers based on code context

**Why Claude?**
- Excellent code understanding
- 200K context window (can handle large codebases)
- Great at technical explanations
- Accurate and reliable

### 3. 🐙 GitHub API (Issue Management)
**Provider:** GitHub
**Token:** OPTIONAL (but recommended)
**Get token:** [github.com/settings/tokens](https://github.com/settings/tokens)
**Used for:** Importing issues and pull requests

**Rate limits:**
- Without token: 60 requests/hour (very limited!)
- With token: 5,000 requests/hour (much better!)

**Permissions needed:** None for public repos (just create token with no checkboxes)

## What We DON'T Use

❌ **OpenAI** - Not used anywhere
❌ **OpenRouter** - Not needed
❌ **Cohere** - Not needed
❌ **Google AI** - Not needed

## How It Works Together

```
┌─────────────────────────────────────────────┐
│ 1. USER INDEXES A REPO                     │
├─────────────────────────────────────────────┤
│ Clone → Split code → LOCAL embeddings      │
│ No API calls needed!                        │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ 2. USER ASKS A QUESTION                     │
├─────────────────────────────────────────────┤
│ Question → LOCAL embedding → Vector search  │
│ (finds relevant code)                       │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ 3. GENERATE ANSWER                          │
├─────────────────────────────────────────────┤
│ Code context + Question → CLAUDE API       │
│ (needs Anthropic API key)                   │
└─────────────────────────────────────────────┘
```

## Cost Breakdown

**Indexing:** FREE (runs locally)
**Storage:** FREE (PostgreSQL on your machine)
**Searching:** FREE (vector search is local)
**Answering:** ~$0.003 per question (Claude API)

**Example:** 1,000 questions = ~$3.00

## Adding API Keys

### Option 1: Settings UI (Recommended) ⚙️
1. Start the app
2. Click Settings button (⚙️)
3. Add your Anthropic API key
4. Optionally add GitHub token

### Option 2: Environment Variables (Legacy)
Not recommended anymore, but supported:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GITHUB_TOKEN=ghp_...
```

## Why This Architecture?

**Local embeddings + Cloud LLM = Best of both worlds:**
- ✅ Fast indexing (no API delays)
- ✅ Private code (never sent for embeddings)
- ✅ Low cost (only pay for answers, not indexing)
- ✅ High quality (Claude is excellent for code)
- ✅ Scalable (embed millions of lines locally)

## FAQ

**Q: Can I use OpenAI instead of Claude?**
A: Not currently, but we could add it. Claude is better for code though.

**Q: Can I use a different embedding model?**
A: Yes, edit `flows.py` and change the SentenceTransformerEmbed model.

**Q: Does my code get sent to Anthropic?**
A: Only the relevant code snippets when you ask questions. During indexing, nothing is sent anywhere.

**Q: Can I run Claude locally too?**
A: Not easily. Claude is API-only. You could replace it with Ollama for a fully local setup.

**Q: How much does 1 question cost?**
A: ~$0.003 (input: ~3000 tokens, output: ~500 tokens)
