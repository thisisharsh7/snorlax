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

        prompt = f"""You are analyzing GitHub issue #{issue['issue_number']}: "{issue['title']}"

Issue Description:
{issue['body'] or 'No description provided'}

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

            response_text = message.content[0].text
            # Remove markdown code blocks if present
            if response_text.startswith("```json"):
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif response_text.startswith("```"):
                response_text = response_text.split("```")[1].split("```")[0].strip()

            return json.loads(response_text)

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

    def categorize_all_issues(self, project_id: str) -> Dict[str, Any]:
        """
        Categorize all issues in a project.

        Args:
            project_id: Project identifier

        Returns:
            Statistics about categorization
        """
        # First, generate embeddings for all issues/PRs
        embed_stats = self.embedding_service.generate_all_embeddings(project_id)

        # Get all issues
        with self.db_pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT issue_number
                    FROM github_issues
                    WHERE project_id = %s
                    AND state = 'open'
                    ORDER BY issue_number
                """, (project_id,))

                issue_numbers = [row[0] for row in cur.fetchall()]

        # Categorize each issue
        categorized = 0
        failed = 0

        for issue_number in issue_numbers:
            try:
                result = self.categorize_issue(project_id, issue_number)
                if "error" not in result:
                    categorized += 1
                else:
                    failed += 1
            except Exception as e:
                print(f"Error categorizing issue #{issue_number}: {e}")
                failed += 1

        return {
            **embed_stats,
            "issues_categorized": categorized,
            "issues_failed": failed
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
                        ORDER BY ic.issue_number, ic.confidence DESC
                    """, (project_id,))

                results = cur.fetchall()

                return [
                    {
                        "issue_number": row[0],
                        "title": row[1],
                        "state": row[2],
                        "category": row[3],
                        "confidence": row[4],
                        "reasoning": row[5],
                        "related_issues": row[6] or [],
                        "related_prs": row[7] or [],
                        "related_files": row[8] or [],
                        "theme_name": row[9],
                        "theme_description": row[10]
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
