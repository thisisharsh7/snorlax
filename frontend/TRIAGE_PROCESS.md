# Triage "Analyze with AI" Process

## Complete Flow Explanation

When you click **"Analyze with AI"** button in Triage Mode, here's the complete process:

### Frontend (TriageModeModal.tsx)
1. **Button Click** triggers `handleAnalyzeClick()` function
2. **Check Cache**: First checks if this issue was already analyzed (to save API costs)
3. **API Request**: Makes POST request to `/api/triage/analyze/{projectId}/{issueNumber}`
4. **Loading State**: Shows "Analyzing..." spinner while waiting
5. **Cache Result**: Stores analysis result for future navigation
6. **Display Results**: Renders analysis on right panel

### Backend API Layer (api/triage.py)
1. **Rate Limiting**: Endpoint limited to 30 requests/minute per IP
2. **Validation**: Checks project and issue exist
3. **Service Call**: Delegates to `IssueCategorizationService.triage_issue()`
4. **Error Handling**: Returns errors with proper HTTP status codes

### AI Service Layer (services/ai/categorization.py)

#### Step 1: Generate Embedding
- Creates vector embedding of issue title + body using embeddings model
- Stores in database for future similarity searches

#### Step 2: Semantic Similarity Searches (Parallel)
Runs 4 different similarity searches:

**a) Find Duplicates (>85% similarity)**
- Searches all existing issues for near-identical matches
- Helps identify if issue already reported

**b) Find Related PRs (>75% similarity)**
- Searches pull requests that might fix this issue
- Identifies if fix is already in progress or merged

**c) Search Codebase (>75% similarity)**
- Searches actual source code files
- Checks if feature/fix already exists in codebase

**d) Find Documentation (>60% similarity)**
- Searches documentation files (README, docs, etc.)
- Links to relevant documentation

#### Step 3: Claude AI Analysis
Sends comprehensive prompt to **Claude Sonnet 4.5** with:
- Issue title & description (truncated to 2000 chars for cost optimization)
- All similarity search results
- Similarity scores and evidence

**Claude analyzes and returns:**
- **Primary Category**: `critical`, `bug`, `feature_request`, `question`, or `low_priority`
- **Confidence Score**: 0.0 to 1.0 (how certain the AI is)
- **Reasoning**: Detailed explanation of categorization
- **Duplicate Detection**: Issue number if duplicate found
- **Related PRs**: List of PR numbers addressing this issue
- **Priority Score**: 0-100 (urgency/importance)
- **Needs Response**: Boolean if maintainer response needed
- **Tags**: Relevant labels

#### Step 4: Generate Suggested Responses
Based on category, generates 2-3 response templates:
- **Critical/Bug**: Acknowledgment + investigation steps
- **Feature Request**: Thank you + consideration process
- **Question**: Answer + documentation links
- **Duplicate**: Polite duplicate notice with link
- **Low Priority**: Acknowledgment + backlog notice

Each response includes:
- **Title**: Response type
- **Body**: Full markdown response text
- **Actions**: Suggested next steps

#### Step 5: Cost Tracking
Calculates and returns API cost:
- **Input Tokens**: Prompt size
- **Output Tokens**: Response size
- **Cost**: $3/1M input tokens, $15/1M output tokens
- **Total Cost**: Usually $0.01-0.03 per issue

#### Step 6: Store Results
Saves to database:
- Category, confidence, reasoning
- Duplicate info, related PRs
- Priority score, documentation links
- Allows retrieval without re-analysis

### Response Format
```json
{
  "issue_number": 1291,
  "title": "Run Whispering in Background...",
  "primary_category": "feature_request",
  "confidence": 0.92,
  "reasoning": "User requests background execution...",
  "duplicate_of": null,
  "related_prs": [456],
  "doc_links": [
    {"file": "README.md", "line": 45, "similarity": 0.78}
  ],
  "suggested_responses": [
    {
      "type": "acknowledge",
      "title": "Thank You for Feature Request",
      "body": "Thank you for suggesting...",
      "actions": ["add label: enhancement", "add to roadmap"]
    }
  ],
  "priority_score": 65,
  "needs_response": true,
  "tags": ["enhancement", "ux-improvement"],
  "api_cost": {
    "input_tokens": 1250,
    "output_tokens": 450,
    "total_tokens": 1700,
    "input_cost_usd": 0.00375,
    "output_cost_usd": 0.00675,
    "total_cost_usd": 0.0105
  }
}
```

## Key Features

### Cost Optimization
- **Caching**: Analyzed issues cached in memory (no re-analysis on navigation)
- **Text Truncation**: Issue bodies limited to 2000 chars (~500 tokens)
- **Batch Mode**: Separate endpoint for bulk processing
- **Rate Limiting**: Prevents accidental API spam

### Intelligent Analysis
- **Semantic Search**: Uses embeddings for accurate similarity
- **Multi-Factor**: Combines 4 different search types
- **AI Reasoning**: Claude provides transparent explanations
- **Evidence-Based**: Shows similarity scores and references

### User Experience
- **Fast**: Usually 2-5 seconds per issue
- **Transparent**: Shows reasoning and confidence
- **Actionable**: Provides ready-to-post responses
- **Keyboard Shortcuts**: J/K navigate, 1/2/3 copy responses

## Cost Estimates
- **Per Issue Analysis**: ~$0.01-0.03 USD
- **100 Issues**: ~$1-3 USD
- **1000 Issues**: ~$10-30 USD

## Technical Details
- **Model**: Claude Sonnet 4.5 (claude-sonnet-4-5-20250929)
- **Max Tokens**: 2000 output tokens per request
- **Embedding Model**: Managed by IssueEmbeddingService
- **Database**: PostgreSQL with vector similarity support
