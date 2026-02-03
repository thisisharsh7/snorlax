"""
Service for intelligent issue categorization using AI and semantic search.
Categories: duplicate, implemented, fixed_in_pr, theme_cluster
"""

import os
import json
from typing import List, Dict, Optional, Any
from psycopg_pool import ConnectionPool
import anthropic
from services.ai.embeddings import IssueEmbeddingService


class IssueCategorizationService:
    """
    Categorizes issues using semantic search and Claude AI.

    Categories:
    - duplicate: Similar issue already exists (>85% similarity)
    - implemented: Feature/fix already in codebase (>75% similarity with code)
    - fixed_in_pr: Issue addressed in a PR (>75% similarity)
    - theme_cluster: Related issues forming a theme (60-75% similarity)
    """

    # Thresholds for categorization
    DUPLICATE_THRESHOLD = 0.85
    IMPLEMENTED_THRESHOLD = 0.75
    FIXED_IN_PR_THRESHOLD = 0.75
    THEME_MIN_THRESHOLD = 0.60
    THEME_MAX_THRESHOLD = 0.84

    # Triage detection keywords and patterns
    CRITICAL_KEYWORDS = [
        "security", "vulnerability", "exploit", "breach", "cve",
        "crash", "crashes", "crashing", "hang", "freeze", "segfault",
        "breaking", "broken", "blocks", "blocker",
        "production", "urgent", "critical", "emergency",
        "data loss", "corruption", "failure", "down"
    ]

    CRITICAL_LABELS = ["critical", "security", "blocker", "urgent", "p0", "high priority"]

    BUG_KEYWORDS = [
        "bug", "broken", "doesn't work", "not working", "fails", "error",
        "issue", "problem", "wrong", "incorrect", "unexpected"
    ]

    FEATURE_KEYWORDS = [
        "add", "support", "implement", "allow", "enable", "feature",
        "enhancement", "improvement", "would be nice", "can we have"
    ]

    def __init__(self):
        """Initialize service with dependencies."""
        self.db_pool = ConnectionPool(os.getenv("APP_DATABASE_URL"))
        self.embedding_service = IssueEmbeddingService()

        # Get API key from settings
        with self.db_pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT value FROM settings WHERE key = 'anthropic_api_key'")
                result = cur.fetchone()
                api_key = result[0] if result else os.getenv("ANTHROPIC_API_KEY")

        self.claude_client = anthropic.Anthropic(api_key=api_key) if api_key else None

    def _get_issue_details(self, project_id: str, issue_number: int) -> Optional[Dict]:
        """Fetch issue details from database."""
        with self.db_pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT title, body, state
                    FROM github_issues
                    WHERE project_id = %s AND issue_number = %s
                """, (project_id, issue_number))

                result = cur.fetchone()
                if not result:
                    return None

                return {
                    "issue_number": issue_number,
                    "title": result[0],
                    "body": result[1],
                    "state": result[2]
                }

    def _truncate_text(self, text: str, max_chars: int = 2000) -> str:
        """
        Truncate text to max characters to reduce token usage.

        Args:
            text: Text to truncate
            max_chars: Maximum character count (roughly ~500 tokens)

        Returns:
            Truncated text with indicator if truncated
        """
        if not text or len(text) <= max_chars:
            return text or ""

        return text[:max_chars] + f"\n\n[... truncated {len(text) - max_chars} characters for cost optimization]"

    def _format_similar_issues(self, issues: List[Dict]) -> str:
        """Format similar issues for Claude prompt."""
        if not issues:
            return "None found"

        formatted = []
        for issue in issues:
            formatted.append(
                f"  - Issue #{issue['issue_number']}: {issue['title']}\n"
                f"    State: {issue['state']}\n"
                f"    Similarity: {issue['similarity']*100:.1f}%"
            )
        return "\n".join(formatted)

    def _format_similar_prs(self, prs: List[Dict]) -> str:
        """Format similar PRs for Claude prompt."""
        if not prs:
            return "None found"

        formatted = []
        for pr in prs:
            formatted.append(
                f"  - PR #{pr['pr_number']}: {pr['title']}\n"
                f"    State: {pr['state']}\n"
                f"    Similarity: {pr['similarity']*100:.1f}%"
            )
        return "\n".join(formatted)

    def _format_code_matches(self, code_matches: List[Dict]) -> str:
        """Format code matches for Claude prompt."""
        if not code_matches:
            return "None found"

        formatted = []
        for match in code_matches[:5]:  # Top 5
            formatted.append(
                f"  - {match['filename']} (lines {match['start_line']}-{match['end_line']})\n"
                f"    Language: {match['language']}\n"
                f"    Similarity: {match['similarity']*100:.1f}%\n"
                f"    Code preview:\n    ```{match['language']}\n    {match['code'][:200]}...\n    ```"
            )
        return "\n".join(formatted)

    def _analyze_with_claude(
        self,
        issue: Dict,
        similar_issues: List[Dict],
        similar_prs: List[Dict],
        code_matches: List[Dict],
        related_issues: List[Dict]
    ) -> Dict[str, Any]:
        """
        Use Claude to analyze all signals and make final categorization decision.
        Returns full transparency with reasoning for each category.
        """
        if not self.claude_client:
            return {"error": "Claude API key not configured"}

        # Truncate issue body to reduce token usage (max 2000 chars = ~500 tokens)
        truncated_body = self._truncate_text(issue.get('body', ''), max_chars=2000)

        prompt = f"""You are analyzing GitHub issue #{issue['issue_number']}: "{issue['title']}"

Issue Description:
{truncated_body or 'No description provided'}

I've run semantic similarity searches across the codebase and found:

## 1. SIMILAR ISSUES (Duplicate Detection Threshold: >85%)
{self._format_similar_issues(similar_issues)}

## 2. RELATED PULL REQUESTS (Fix Detection Threshold: >75%)
{self._format_similar_prs(similar_prs)}

## 3. SIMILAR CODE IN CODEBASE (Implementation Detection Threshold: >75%)
{self._format_code_matches(code_matches)}

## 4. RELATED ISSUES (Theme Clustering: 60-75% similarity)
{self._format_similar_issues(related_issues)}

---

Your task is to categorize this issue. Analyze each category carefully:

**DUPLICATE** (>85% similarity with another issue):
- Is this issue essentially the same as an existing issue?
- Even if worded differently, do they describe the same problem/request?

**IMPLEMENTED** (>75% similarity with existing code):
- Does the codebase already contain this feature or fix?
- Look at the code matches - do they actually implement what the issue requests?
- Be strict - only mark as implemented if it truly exists

**FIXED_IN_PR** (>75% similarity with a PR):
- Is there an open or merged PR that addresses this issue?
- Does the PR actually solve what the issue describes?

**THEME_CLUSTER** (60-75% similarity with other issues):
- Are there related issues that form a cohesive theme?
- If yes, name the theme and explain how they're connected
- Examples: "Export Features", "Authentication Improvements", "Performance Optimizations"

Return your analysis as JSON:
{{
  "categories": [
    {{
      "category": "duplicate",  // or "implemented", "fixed_in_pr", "theme_cluster"
      "confidence": 0.95,  // 0.0 to 1.0
      "reasoning": "Detailed explanation of why this category applies...",
      "evidence": {{
        "related_issues": [123, 456],  // Issue numbers
        "related_prs": [78],  // PR numbers
        "related_files": ["src/auth.py", "src/login.py"]  // File paths
      }}
    }},
    // Can have multiple categories
  ],
  "theme_name": "Theme Name Here",  // Only if theme_cluster category applies
  "theme_description": "Detailed explanation of the theme..."  // Only if theme_cluster applies
}}

**IMPORTANT**:
- Be thorough and transparent in your reasoning
- Show your work - reference specific similarity scores
- Can assign multiple categories if appropriate
- Only include theme_name/theme_description if theme_cluster category applies
- If no strong categories apply, return empty categories array

Return ONLY valid JSON, no markdown code blocks."""

        try:
            message = self.claude_client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}]
            )

            # Extract token usage for cost tracking
            input_tokens = message.usage.input_tokens
            output_tokens = message.usage.output_tokens

            # Calculate cost (Claude Sonnet 4.5 pricing: $3 input / $15 output per 1M tokens)
            input_cost = (input_tokens / 1_000_000) * 3
            output_cost = (output_tokens / 1_000_000) * 15
            total_cost = input_cost + output_cost

            response_text = message.content[0].text
            # Remove markdown code blocks if present
            if response_text.startswith("```json"):
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif response_text.startswith("```"):
                response_text = response_text.split("```")[1].split("```")[0].strip()

            result = json.loads(response_text)

            # Add cost tracking to result
            result["api_cost"] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "input_cost_usd": round(input_cost, 6),
                "output_cost_usd": round(output_cost, 6),
                "total_cost_usd": round(total_cost, 6)
            }

            return result

        except Exception as e:
            print(f"Error in Claude analysis: {e}")
            return {"error": str(e), "categories": []}

    def categorize_issue(self, project_id: str, issue_number: int) -> Dict[str, Any]:
        """
        Categorize a single issue using semantic search and AI analysis.

        Args:
            project_id: Project identifier
            issue_number: Issue number

        Returns:
            Categorization results with full transparency
        """
        # 1. Ensure issue has embedding
        self.embedding_service.generate_issue_embedding(project_id, issue_number)

        # 2. Get issue details
        issue = self._get_issue_details(project_id, issue_number)
        if not issue:
            return {"error": "Issue not found"}

        # 3. Run all similarity searches in parallel conceptually
        # Find potential duplicates (>85%)
        similar_issues = self.embedding_service.search_similar_issues(
            project_id, issue_number,
            limit=10,
            min_similarity=self.DUPLICATE_THRESHOLD
        )

        # Find related PRs (>75%)
        similar_prs = self.embedding_service.search_similar_prs(
            project_id, issue_number,
            limit=10,
            min_similarity=self.FIXED_IN_PR_THRESHOLD
        )

        # Search codebase (>75%)
        code_matches = self.embedding_service.search_in_codebase(
            project_id, issue_number,
            limit=10,
            min_similarity=self.IMPLEMENTED_THRESHOLD
        )

        # Find related issues for theme clustering (60-75%)
        related_issues = self.embedding_service.search_similar_issues(
            project_id, issue_number,
            limit=10,
            min_similarity=self.THEME_MIN_THRESHOLD
        )
        # Filter to theme range
        related_issues = [
            i for i in related_issues
            if self.THEME_MIN_THRESHOLD <= i['similarity'] <= self.THEME_MAX_THRESHOLD
        ]

        # 4. Use Claude to make final decision with full reasoning
        analysis = self._analyze_with_claude(
            issue, similar_issues, similar_prs, code_matches, related_issues
        )

        if "error" in analysis:
            return analysis

        # 5. Store categorization results in database
        self._store_categories(project_id, issue_number, analysis)

        # 6. Return results with full transparency
        return {
            "issue_number": issue_number,
            "title": issue['title'],
            "categories": analysis.get("categories", []),
            "theme_name": analysis.get("theme_name"),
            "theme_description": analysis.get("theme_description"),
            "search_results": {
                "similar_issues": similar_issues,
                "similar_prs": similar_prs,
                "code_matches": code_matches[:5],  # Top 5 for display
                "related_issues": related_issues
            }
        }

    def _store_categories(self, project_id: str, issue_number: int, analysis: Dict):
        """Store categorization results in database."""
        with self.db_pool.connection() as conn:
            with conn.cursor() as cur:
                # Delete existing categories for this issue
                cur.execute("""
                    DELETE FROM issue_categories
                    WHERE project_id = %s AND issue_number = %s
                """, (project_id, issue_number))

                # Insert new categories
                for cat in analysis.get("categories", []):
                    evidence = cat.get("evidence", {})

                    cur.execute("""
                        INSERT INTO issue_categories
                        (project_id, issue_number, category, confidence, reasoning,
                         related_issues, related_prs, related_files,
                         theme_name, theme_description)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        project_id,
                        issue_number,
                        cat["category"],
                        cat["confidence"],
                        cat["reasoning"],
                        evidence.get("related_issues", []),
                        evidence.get("related_prs", []),
                        evidence.get("related_files", []),
                        analysis.get("theme_name"),
                        analysis.get("theme_description")
                    ))

                conn.commit()

    def categorize_all_issues(self, project_id: str, force_recategorize: bool = False) -> Dict[str, Any]:
        """
        Categorize all issues in a project with intelligent caching.

        Args:
            project_id: Project identifier
            force_recategorize: If True, re-categorize already categorized issues (default: False)

        Returns:
            Statistics about categorization including skipped count
        """
        # First, generate embeddings for all issues/PRs
        embed_stats = self.embedding_service.generate_all_embeddings(project_id)

        # Get issues (skip already categorized unless force_recategorize=True)
        with self.db_pool.connection() as conn:
            with conn.cursor() as cur:
                if force_recategorize:
                    # Get ALL open issues
                    cur.execute("""
                        SELECT issue_number
                        FROM github_issues
                        WHERE project_id = %s
                        AND state = 'open'
                        ORDER BY issue_number
                    """, (project_id,))
                    issue_numbers = [row[0] for row in cur.fetchall()]
                    skipped = 0
                else:
                    # Get only UNCATEGORIZED open issues (OPTIMIZATION!)
                    cur.execute("""
                        SELECT gi.issue_number
                        FROM github_issues gi
                        LEFT JOIN issue_categories ic
                            ON gi.project_id = ic.project_id
                            AND gi.issue_number = ic.issue_number
                        WHERE gi.project_id = %s
                        AND gi.state = 'open'
                        AND ic.issue_number IS NULL
                        ORDER BY gi.issue_number
                    """, (project_id,))
                    issue_numbers = [row[0] for row in cur.fetchall()]

                    # Count already categorized issues
                    cur.execute("""
                        SELECT COUNT(DISTINCT ic.issue_number)
                        FROM issue_categories ic
                        JOIN github_issues gi
                            ON ic.project_id = gi.project_id
                            AND ic.issue_number = gi.issue_number
                        WHERE ic.project_id = %s
                        AND gi.state = 'open'
                    """, (project_id,))
                    skipped = cur.fetchone()[0]

        total_open = len(issue_numbers) + (0 if force_recategorize else skipped)
        print(f"📊 Categorization Plan:")
        print(f"   Total open issues: {total_open}")
        print(f"   Already categorized: {skipped} (skipping)")
        print(f"   To categorize: {len(issue_numbers)}")
        print(f"   Estimated cost: ${len(issue_numbers) * 0.015:.2f}")

        if len(issue_numbers) == 0:
            print("✅ All open issues already categorized!")
            return {
                **embed_stats,
                "issues_categorized": 0,
                "issues_failed": 0,
                "issues_skipped": skipped,
                "message": "All issues already categorized"
            }

        # Categorize each issue and track costs
        categorized = 0
        failed = 0
        total_cost = 0.0
        total_input_tokens = 0
        total_output_tokens = 0

        for idx, issue_number in enumerate(issue_numbers, 1):
            try:
                # Progress logging every 10 issues
                if idx % 10 == 0 or idx == len(issue_numbers):
                    print(f"   Progress: {idx}/{len(issue_numbers)} ({idx/len(issue_numbers)*100:.1f}%) • Cost so far: ${total_cost:.4f}")

                result = self.categorize_issue(project_id, issue_number)
                if "error" not in result:
                    categorized += 1

                    # Track API costs
                    if "api_cost" in result:
                        cost_info = result["api_cost"]
                        total_cost += cost_info.get("total_cost_usd", 0)
                        total_input_tokens += cost_info.get("input_tokens", 0)
                        total_output_tokens += cost_info.get("output_tokens", 0)
                else:
                    failed += 1
            except Exception as e:
                print(f"Error categorizing issue #{issue_number}: {e}")
                failed += 1

        print(f"✅ Categorization complete! Total cost: ${total_cost:.4f}")

        return {
            **embed_stats,
            "issues_categorized": categorized,
            "issues_failed": failed,
            "issues_skipped": skipped if not force_recategorize else 0,
            "force_recategorize": force_recategorize,
            "api_cost": {
                "total_input_tokens": total_input_tokens,
                "total_output_tokens": total_output_tokens,
                "total_tokens": total_input_tokens + total_output_tokens,
                "total_cost_usd": round(total_cost, 6),
                "average_cost_per_issue": round(total_cost / categorized, 6) if categorized > 0 else 0
            }
        }

    def get_categorized_issues(self, project_id: str, category: Optional[str] = None) -> List[Dict]:
        """
        Retrieve categorized issues from database.

        Args:
            project_id: Project identifier
            category: Optional category filter

        Returns:
            List of categorized issues
        """
        with self.db_pool.connection() as conn:
            with conn.cursor() as cur:
                if category:
                    cur.execute("""
                        SELECT DISTINCT
                            ic.issue_number,
                            gi.title,
                            gi.state,
                            ic.category,
                            ic.confidence,
                            ic.reasoning,
                            ic.related_issues,
                            ic.related_prs,
                            ic.related_files,
                            ic.theme_name,
                            ic.theme_description
                        FROM issue_categories ic
                        JOIN github_issues gi
                            ON ic.project_id = gi.project_id
                            AND ic.issue_number = gi.issue_number
                        WHERE ic.project_id = %s
                          AND ic.category = %s
                        ORDER BY ic.confidence DESC, ic.issue_number
                    """, (project_id, category))
                else:
                    # All tab query - return all categories grouped by issue
                    cur.execute("""
                        SELECT
                            gi.issue_number,
                            gi.title,
                            gi.state,
                            json_agg(
                                json_build_object(
                                    'category', ic.category,
                                    'confidence', ic.confidence,
                                    'reasoning', ic.reasoning,
                                    'related_issues', ic.related_issues,
                                    'related_prs', ic.related_prs,
                                    'related_files', ic.related_files,
                                    'theme_name', ic.theme_name,
                                    'theme_description', ic.theme_description
                                ) ORDER BY ic.confidence DESC
                            ) as categories
                        FROM github_issues gi
                        JOIN issue_categories ic
                            ON gi.project_id = ic.project_id
                            AND gi.issue_number = ic.issue_number
                        WHERE ic.project_id = %s
                        GROUP BY gi.issue_number, gi.title, gi.state
                        ORDER BY gi.issue_number
                    """, (project_id,))

                results = cur.fetchall()

                # Transform to grouped format
                return [
                    {
                        "issue_number": row[0],
                        "title": row[1],
                        "state": row[2],
                        "categories": row[3],  # Array of all categories
                        "primary_category": row[3][0]["category"],  # First = highest confidence
                        "primary_confidence": row[3][0]["confidence"],
                        "theme_name": row[3][0].get("theme_name"),
                        "theme_description": row[3][0].get("theme_description")
                    }
                    for row in results
                ]

    def generate_comment(self, project_id: str, issue_number: int, category: str) -> str:
        """
        Generate a comment for an issue based on its category.

        Args:
            project_id: Project identifier
            issue_number: Issue number
            category: Category to generate comment for

        Returns:
            Generated comment text
        """
        if not self.claude_client:
            return "Please configure Claude API key in Settings"

        # Get issue details and categorization
        issue = self._get_issue_details(project_id, issue_number)
        categories = self.get_categorized_issues(project_id)
        issue_cat = next((c for c in categories if c['issue_number'] == issue_number and c['category'] == category), None)

        if not issue_cat:
            return "Category not found for this issue"

        prompt = f"""Generate a professional, friendly GitHub issue comment.

Issue: #{issue_number} - {issue['title']}
Category: {category}
Confidence: {issue_cat['confidence']*100:.0f}%

Reasoning: {issue_cat['reasoning']}

Related Issues: {issue_cat.get('related_issues', [])}
Related PRs: {issue_cat.get('related_prs', [])}
Related Files: {issue_cat.get('related_files', [])}

Generate a comment that:
1. Is friendly and professional
2. Clearly explains the category
3. Provides specific references (issue/PR numbers, file paths)
4. Offers next steps or suggestions
5. Is concise (2-3 paragraphs max)

Return only the comment text, no markdown code blocks."""

        try:
            message = self.claude_client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}]
            )

            return message.content[0].text.strip()

        except Exception as e:
            return f"Error generating comment: {e}"

    def _find_relevant_docs(self, project_id: str, issue_number: int) -> List[Dict]:
        """
        Find relevant documentation files using CocoIndex semantic search.

        Args:
            project_id: Project identifier
            issue_number: Issue number

        Returns:
            List of documentation file matches
        """
        # Search in codebase with broader threshold
        code_matches = self.embedding_service.search_in_codebase(
            project_id, issue_number,
            limit=20,
            min_similarity=0.60
        )

        # Filter for documentation files
        doc_patterns = ['.md', '.rst', 'readme', 'docs/', 'documentation', 'doc/', '.txt']
        doc_matches = [
            m for m in code_matches
            if any(pattern in m['filename'].lower() for pattern in doc_patterns)
        ]

        return doc_matches[:5]  # Top 5 docs

    def _generate_suggested_responses(
        self,
        issue: Dict,
        primary_category: str,
        duplicate_of: Optional[int],
        related_prs: List[int],
        doc_links: List[Dict]
    ) -> List[Dict]:
        """
        Generate 2-3 actionable response templates based on triage analysis.

        Args:
            issue: Issue details
            primary_category: Primary triage category
            duplicate_of: Duplicate issue number if found
            related_prs: Related PR numbers
            doc_links: Related documentation links

        Returns:
            List of suggested responses with actions
        """
        responses = []

        # Response for duplicates
        if duplicate_of:
            responses.append({
                "type": "close_duplicate",
                "title": f"Close as duplicate of #{duplicate_of}",
                "body": f"Thanks for reporting! This appears to be a duplicate of #{duplicate_of}. "
                       f"Please follow that issue for updates.",
                "actions": ["comment", "close", "add_label:duplicate"]
            })

        # Response for providing documentation
        if doc_links:
            doc_list = "\n".join([
                f"- [{doc['filename']}]({doc['filename']})" for doc in doc_links[:3]
            ])
            responses.append({
                "type": "provide_docs",
                "title": "Provide documentation links",
                "body": f"Thanks for your interest! You might find these resources helpful:\n\n{doc_list}\n\n"
                       f"Let us know if you have any questions!",
                "actions": ["comment"]
            })

        # Response for related PRs
        if related_prs:
            pr_list = ", ".join([f"#{pr}" for pr in related_prs[:3]])
            responses.append({
                "type": "link_prs",
                "title": "Link related PRs",
                "body": f"This may be related to {pr_list}. Please check if those PRs address your issue.",
                "actions": ["comment"]
            })

        # Response for critical issues
        if primary_category == "critical":
            responses.append({
                "type": "escalate_critical",
                "title": "Escalate as critical",
                "body": "Thanks for reporting this critical issue. We're escalating this to the team for immediate attention.",
                "actions": ["comment", "add_label:critical", "add_label:urgent"]
            })

        # Response for bugs
        if primary_category == "bug":
            responses.append({
                "type": "acknowledge_bug",
                "title": "Acknowledge bug",
                "body": "Thanks for the bug report! We've confirmed this is a bug and will work on a fix. "
                       "We'll update this issue as we make progress.",
                "actions": ["comment", "add_label:bug", "add_label:confirmed"]
            })

        # Response for feature requests
        if primary_category == "feature_request":
            responses.append({
                "type": "acknowledge_feature",
                "title": "Acknowledge feature request",
                "body": "Thanks for the feature request! We'll consider this for a future release. "
                       "Feel free to contribute a PR if you'd like to help implement it!",
                "actions": ["comment", "add_label:enhancement"]
            })

        # Response for questions
        if primary_category == "question":
            responses.append({
                "type": "answer_question",
                "title": "Answer question",
                "body": "Thanks for your question! [Add your answer here]\n\n"
                       "Let us know if this helps or if you need more clarification.",
                "actions": ["comment", "add_label:question"]
            })

        # Response for low priority
        if primary_category == "low_priority":
            responses.append({
                "type": "close_low_priority",
                "title": "Close as low priority",
                "body": "Thanks for the report. This appears to be a very minor issue or lacks sufficient detail. "
                       "Please provide more information if this is a significant problem.",
                "actions": ["comment", "close", "add_label:wontfix"]
            })

        return responses[:3]  # Max 3 suggestions

    def _triage_with_claude(
        self,
        issue: Dict,
        similar_issues: List[Dict],
        similar_prs: List[Dict],
        code_matches: List[Dict],
        doc_links: List[Dict]
    ) -> Dict[str, Any]:
        """
        Use Claude to perform triage analysis with enhanced prompts.

        Args:
            issue: Issue details
            similar_issues: Similar issues from semantic search
            similar_prs: Similar PRs from semantic search
            code_matches: Code matches from CocoIndex
            doc_links: Documentation links

        Returns:
            Triage analysis with primary_category, confidence, and recommendations
        """
        if not self.claude_client:
            return {"error": "Claude API key not configured"}

        # Get issue labels for critical detection
        with self.db_pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT labels
                    FROM github_issues
                    WHERE project_id = %s AND issue_number = %s
                """, (issue.get('project_id', ''), issue['issue_number']))
                result = cur.fetchone()
                labels = result[0] if result and result[0] else []

        # Truncate issue body to reduce token usage (max 2000 chars = ~500 tokens)
        truncated_body = self._truncate_text(issue.get('body', ''), max_chars=2000)

        prompt = f"""You are triaging GitHub issue #{issue['issue_number']}: "{issue['title']}"

Issue Description:
{truncated_body or 'No description provided'}

Labels: {', '.join(labels) if labels else 'None'}

## Semantic Search Results:

**Similar Issues:**
{self._format_similar_issues(similar_issues)}

**Related Pull Requests:**
{self._format_similar_prs(similar_prs)}

**Related Code:**
{self._format_code_matches(code_matches)}

**Related Documentation:**
{self._format_code_matches(doc_links)}

---

## Your Task: Triage Categorization

Analyze this issue and assign ONE primary category:

### 1. CRITICAL
High priority issues requiring immediate attention:
- Security vulnerabilities, exploits, breaches
- Crashes, segfaults, data loss, corruption
- Breaking changes, production blockers
- Keywords: {', '.join(self.CRITICAL_KEYWORDS[:10])}

### 2. BUG
Confirmed bugs - something that SHOULD work but DOESN'T:
- Has error messages or stack traces
- Describes unexpected behavior
- Uses verbs: "fix", "broken", "doesn't work", "fails"
- NOT feature requests in disguise

### 3. FEATURE_REQUEST
New feature requests - something that doesn't exist yet:
- Describes something NEW to add
- Uses phrases: "add", "support", "implement", "allow", "it would be nice if"
- Enhancement or improvement proposals

### 4. QUESTION
User questions about usage or behavior:
- Starts with "How do I...", "Why does...", "What is..."
- Ends with "?"
- Seeking clarification or guidance
- May be answered with documentation

### 5. LOW_PRIORITY
Spam, unclear, or very minor issues:
- Lacks sufficient detail
- Very minor cosmetic issues
- Spam or off-topic
- Duplicate with no additional information

---

## Detection Guidelines:

**Critical Detection:**
- Check for critical keywords in title/body
- Check for critical labels
- Assess severity from description

**Bug vs Feature:**
- Bugs describe BROKEN behavior (what should work but doesn't)
- Features describe NEW behavior (what doesn't exist yet)
- "It crashes when..." = Bug
- "It would be nice to have..." = Feature

**Question Detection:**
- Question marks, especially at end
- Question words: how, why, what, when, where
- "Can someone explain..."

**Duplicate Detection:**
- Check similar_issues >85% similarity
- Is it essentially the same issue?

Return JSON:
{{
  "primary_category": "critical|bug|feature_request|question|low_priority",
  "confidence": 0.95,  // 0.0-1.0
  "reasoning": "Detailed explanation...",
  "duplicate_of": 123,  // Issue number if duplicate, null otherwise
  "related_prs": [45, 67],  // Related PR numbers
  "priority_score": 85,  // 0-100, higher = more urgent
  "needs_response": true,  // Whether this needs human response
  "tags": ["security", "urgent"]  // Additional tags
}}

**IMPORTANT:**
- Choose ONLY ONE primary category
- Be decisive - avoid ambiguity
- Reference specific evidence from the search results
- If >85% similar to existing issue, note duplicate_of
- Return ONLY valid JSON, no markdown"""

        try:
            message = self.claude_client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=1500,
                messages=[{"role": "user", "content": prompt}]
            )

            # Extract token usage for cost tracking
            input_tokens = message.usage.input_tokens
            output_tokens = message.usage.output_tokens

            # Calculate cost (Claude Sonnet 4.5 pricing: $3 input / $15 output per 1M tokens)
            input_cost = (input_tokens / 1_000_000) * 3
            output_cost = (output_tokens / 1_000_000) * 15
            total_cost = input_cost + output_cost

            response_text = message.content[0].text
            # Remove markdown code blocks if present
            if response_text.startswith("```json"):
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif response_text.startswith("```"):
                response_text = response_text.split("```")[1].split("```")[0].strip()

            result = json.loads(response_text)

            # Add cost tracking to result
            result["api_cost"] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "input_cost_usd": round(input_cost, 6),
                "output_cost_usd": round(output_cost, 6),
                "total_cost_usd": round(total_cost, 6)
            }

            return result

        except Exception as e:
            print(f"Error in triage analysis: {e}")
            return {"error": str(e)}

    def triage_issue(self, project_id: str, issue_number: int) -> Dict[str, Any]:
        """
        Triage a single issue for the dashboard with enhanced analysis.

        This method performs comprehensive triage including:
        - Primary categorization (critical, bug, feature_request, question, low_priority)
        - Duplicate detection
        - Related PR identification
        - Documentation linking
        - Suggested response generation

        Args:
            project_id: Project identifier
            issue_number: Issue number

        Returns:
            Triage results with:
            - primary_category: str
            - confidence: float (0.0-1.0)
            - duplicate_of: Optional[int]
            - related_prs: List[int]
            - doc_links: List[Dict]
            - suggested_responses: List[Dict]
            - priority_score: int (0-100)
            - needs_response: bool
        """
        # 1. Ensure issue has embedding
        self.embedding_service.generate_issue_embedding(project_id, issue_number)

        # 2. Get issue details
        issue = self._get_issue_details(project_id, issue_number)
        if not issue:
            return {"error": "Issue not found"}

        issue['project_id'] = project_id  # Add for context

        # 3. Run all similarity searches
        # Find potential duplicates (>85%)
        similar_issues = self.embedding_service.search_similar_issues(
            project_id, issue_number,
            limit=10,
            min_similarity=self.DUPLICATE_THRESHOLD
        )

        # Find related PRs (>75%)
        similar_prs = self.embedding_service.search_similar_prs(
            project_id, issue_number,
            limit=10,
            min_similarity=self.FIXED_IN_PR_THRESHOLD
        )

        # Search codebase (>75%)
        code_matches = self.embedding_service.search_in_codebase(
            project_id, issue_number,
            limit=10,
            min_similarity=self.IMPLEMENTED_THRESHOLD
        )

        # Find relevant documentation
        doc_links = self._find_relevant_docs(project_id, issue_number)

        # 4. Run Claude triage analysis
        analysis = self._triage_with_claude(
            issue, similar_issues, similar_prs, code_matches, doc_links
        )

        if "error" in analysis:
            return analysis

        # 5. Generate suggested responses
        suggested_responses = self._generate_suggested_responses(
            issue,
            analysis.get('primary_category'),
            analysis.get('duplicate_of'),
            analysis.get('related_prs', []),
            doc_links
        )

        # 6. Store triage results in database
        self._store_triage_results(project_id, issue_number, analysis, doc_links)

        # 7. Return comprehensive triage results
        return {
            "issue_number": issue_number,
            "title": issue['title'],
            "primary_category": analysis.get('primary_category'),
            "confidence": analysis.get('confidence'),
            "reasoning": analysis.get('reasoning'),
            "duplicate_of": analysis.get('duplicate_of'),
            "related_prs": analysis.get('related_prs', []),
            "doc_links": [
                {
                    "file": doc['filename'],
                    "line": doc.get('start_line'),
                    "similarity": doc['similarity']
                }
                for doc in doc_links
            ],
            "suggested_responses": suggested_responses,
            "priority_score": analysis.get('priority_score', 0),
            "needs_response": analysis.get('needs_response', False),
            "tags": analysis.get('tags', []),
            "api_cost": analysis.get('api_cost', {})  # Include cost tracking
        }

    def _store_triage_results(
        self,
        project_id: str,
        issue_number: int,
        analysis: Dict,
        doc_links: List[Dict]
    ):
        """Store triage results in database."""
        with self.db_pool.connection() as conn:
            with conn.cursor() as cur:
                # Delete existing triage category for this issue
                cur.execute("""
                    DELETE FROM issue_categories
                    WHERE project_id = %s
                      AND issue_number = %s
                      AND category IN ('critical', 'bug', 'feature_request', 'question', 'low_priority')
                """, (project_id, issue_number))

                # Insert triage category (both old and new format fields)
                doc_file_paths = [doc['filename'] for doc in doc_links]

                # Convert related_links to JSON for storage
                import json
                related_links_json = json.dumps(analysis.get('related_links', [])) if analysis.get('related_links') else None

                cur.execute("""
                    INSERT INTO issue_categories
                    (project_id, issue_number, category, confidence, reasoning,
                     related_issues, related_prs, priority_score, needs_response, doc_links,
                     decision, primary_message, evidence_bullets, draft_response,
                     action_button_text, action_button_style, related_links)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    project_id,
                    issue_number,
                    analysis.get('primary_category'),
                    analysis.get('confidence'),
                    analysis.get('reasoning'),
                    [analysis.get('duplicate_of')] if analysis.get('duplicate_of') else [],
                    analysis.get('related_prs', []),
                    analysis.get('priority_score', 0),
                    analysis.get('needs_response', False),
                    doc_file_paths,
                    # New optimized format fields
                    analysis.get('decision'),
                    analysis.get('primary_message'),
                    analysis.get('evidence_bullets', []),
                    analysis.get('draft_response'),
                    analysis.get('action_button_text'),
                    analysis.get('action_button_style'),
                    related_links_json
                ))

                conn.commit()
