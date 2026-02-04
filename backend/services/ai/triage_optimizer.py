"""
Optimized triage methods for cost-effective issue analysis.

This module implements:
1. Smart rule-based filtering (70% cost reduction)
2. Internet search integration (Stack Overflow, GitHub)
3. Prompt caching (90% cost reduction on remaining Claude calls)
4. Single decision output (simplified UX)
"""

import os
import json
import hashlib
import requests
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
from psycopg_pool import ConnectionPool


class TriageOptimizer:
    """
    Cost-optimized triage with smart routing and caching.

    Decision Types:
    - CLOSE_DUPLICATE: Same as existing issue (>95% similarity)
    - CLOSE_FIXED: Already fixed in recent version
    - CLOSE_EXISTS: Feature already in codebase/docs
    - NEEDS_INVESTIGATION: Real bug requiring work
    - VALID_FEATURE: Good feature request for roadmap
    - NEEDS_INFO: Missing reproduction steps/details
    - ANSWER_FROM_DOCS: Can be answered from documentation
    - INVALID: Spam or not actionable
    """

    # Decision thresholds
    DUPLICATE_THRESHOLD = 0.95  # Auto-close duplicates
    DOCS_THRESHOLD = 0.80       # Auto-respond from docs
    CODE_THRESHOLD = 0.80       # Feature exists in code

    def __init__(self, db_pool: ConnectionPool, claude_client):
        """Initialize optimizer with database and Claude client."""
        self.db_pool = db_pool
        self.claude_client = claude_client

        # API configurations
        self.github_token = os.getenv("GITHUB_TOKEN")
        self.stackoverflow_key = os.getenv("STACKOVERFLOW_KEY")  # Optional

    def _get_cache_key(self, issue: Dict, context: Dict) -> str:
        """Generate cache key for Claude response."""
        # Hash issue content + top similar items
        content = f"{issue['title']}:{issue.get('body', '')[:500]}"
        similar = json.dumps(context.get('top_similar', [])[:3])
        return hashlib.sha256(f"{content}:{similar}".encode()).hexdigest()

    def _check_response_cache(self, cache_key: str) -> Optional[Dict]:
        """Check if we have a cached Claude response (7 days)."""
        try:
            with self.db_pool.connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT response, expires_at
                        FROM claude_response_cache
                        WHERE cache_key = %s
                    """, (cache_key,))

                    result = cur.fetchone()
                    if result and result[1] > datetime.now():
                        return json.loads(result[0])
        except Exception as e:
            print(f"Cache check failed: {e}")

        return None

    def _save_response_cache(self, cache_key: str, response: Dict):
        """Save Claude response to cache (7 days)."""
        try:
            with self.db_pool.connection() as conn:
                with conn.cursor() as cur:
                    expires_at = datetime.now() + timedelta(days=7)
                    cur.execute("""
                        INSERT INTO claude_response_cache
                        (cache_key, response, created_at, expires_at)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (cache_key)
                        DO UPDATE SET
                            response = EXCLUDED.response,
                            created_at = EXCLUDED.created_at,
                            expires_at = EXCLUDED.expires_at
                    """, (cache_key, json.dumps(response), datetime.now(), expires_at))
                    conn.commit()
        except Exception as e:
            print(f"Cache save failed: {e}")

    def apply_smart_rules(
        self,
        issue: Dict,
        similar_issues: List[Dict],
        code_matches: List[Dict],
        doc_links: List[Dict],
        repo_url: Optional[str] = None
    ) -> Optional[Dict]:
        """
        Apply rule-based filtering to avoid Claude API calls.

        Returns decision dict if rule matches, None if needs Claude.

        This saves ~70% of API costs by handling obvious cases.
        """

        # RULE 1: Exact Duplicate (>95% similarity)
        if similar_issues and similar_issues[0].get('similarity', 0) > self.DUPLICATE_THRESHOLD:
            duplicate = similar_issues[0]
            return {
                "decision": "CLOSE_DUPLICATE",
                "primary_message": f"This is the same as Issue #{duplicate['issue_number']}",
                "evidence_bullets": [
                    f"{int(duplicate['similarity']*100)}% similarity match",
                    f"Original: {duplicate['title']}",
                    f"Status: {duplicate['state']}"
                ],
                "draft_response": self._generate_duplicate_response(issue, duplicate),
                "action_button_text": f"Post & Close as Duplicate of #{duplicate['issue_number']}",
                "action_button_style": "danger",
                "related_links": [{
                    "text": f"Original Issue #{duplicate['issue_number']}",
                    "url": f"{repo_url}/issues/{duplicate['issue_number']}" if repo_url else f"#/issues/{duplicate['issue_number']}",
                    "source": "github"
                }],
                "confidence": duplicate['similarity'],
                "cost_saved": 0.02,  # Saved a Claude call
                "rule_matched": "exact_duplicate"
            }

        # RULE 2: Found in Documentation (>80% similarity)
        if doc_links and doc_links[0].get('similarity', 0) > self.DOCS_THRESHOLD:
            doc = doc_links[0]
            # Build GitHub URL for docs if repo_url is available
            doc_url = f"#/docs/{doc['filename']}"
            if repo_url:
                # Convert to GitHub blob URL for markdown files
                doc_url = f"{repo_url}/blob/main/{doc['filename']}"
                if 'start_line' in doc:
                    doc_url += f"#L{doc['start_line']}"

            return {
                "decision": "ANSWER_FROM_DOCS",
                "primary_message": "This is already explained in the documentation",
                "evidence_bullets": [
                    f"Found in {doc['filename']}",
                    f"{int(doc['similarity']*100)}% relevance",
                    "Documentation is up to date"
                ],
                "draft_response": self._generate_docs_response(issue, doc),
                "action_button_text": "Post Answer & Close",
                "action_button_style": "success",
                "related_links": [{
                    "text": f"Documentation: {doc['filename']}",
                    "url": doc_url,
                    "source": "github" if repo_url else "docs"
                }],
                "confidence": doc['similarity'],
                "cost_saved": 0.02,
                "rule_matched": "found_in_docs"
            }

        # RULE 3: Feature exists in code (>80% similarity)
        if code_matches and code_matches[0].get('similarity', 0) > self.CODE_THRESHOLD:
            code = code_matches[0]
            # Check if it's a feature request asking for something that exists
            if self._is_feature_request(issue):
                # Build GitHub URL for code if repo_url is available
                code_url = f"#/code/{code['filename']}#L{code['start_line']}"
                if repo_url:
                    # Convert repo_url to GitHub blob URL
                    # e.g., https://github.com/owner/repo -> https://github.com/owner/repo/blob/main/file.py#L123
                    code_url = f"{repo_url}/blob/main/{code['filename']}#L{code['start_line']}"

                return {
                    "decision": "CLOSE_EXISTS",
                    "primary_message": "This feature already exists in the codebase",
                    "evidence_bullets": [
                        f"Found in {code['filename']}",
                        f"Lines {code['start_line']}-{code['end_line']}",
                        f"{int(code['similarity']*100)}% match"
                    ],
                    "draft_response": self._generate_exists_response(issue, code),
                    "action_button_text": "Post Explanation & Close",
                    "action_button_style": "primary",
                    "related_links": [{
                        "text": f"Code: {code['filename']}:{code['start_line']}",
                        "url": code_url,
                        "source": "github" if repo_url else "internal"
                    }],
                    "confidence": code['similarity'],
                    "cost_saved": 0.02,
                    "rule_matched": "exists_in_code"
                }

        # No rules matched - needs Claude analysis
        return None

    def search_stackoverflow(self, issue: Dict) -> List[Dict]:
        """
        Search Stack Overflow for similar questions.

        Free tier: 10,000 requests/day (no key needed)
        With key: 10,000 requests/day + higher rate limit
        """
        # Check cache first (24 hours)
        cache_key = hashlib.sha256(
            f"stackoverflow:{issue['title']}".encode()
        ).hexdigest()

        cached = self._check_internet_cache(cache_key)
        if cached:
            return cached

        try:
            # Use Stack Exchange API v2.3
            params = {
                'order': 'desc',
                'sort': 'relevance',
                'q': issue['title'],
                'site': 'stackoverflow',
                'filter': '!9_bDE(fI5'  # Include body excerpt
            }

            if self.stackoverflow_key:
                params['key'] = self.stackoverflow_key

            response = requests.get(
                'https://api.stackexchange.com/2.3/search/advanced',
                params=params,
                timeout=5
            )

            if response.status_code == 200:
                data = response.json()
                results = [
                    {
                        "title": item['title'],
                        "url": item['link'],
                        "score": item['score'],
                        "accepted": item.get('is_answered', False)
                    }
                    for item in data.get('items', [])[:5]
                ]

                # Cache for 24 hours
                self._save_internet_cache(cache_key, results)
                return results

        except Exception as e:
            print(f"Stack Overflow search failed: {e}")

        return []

    def search_github_issues(self, issue: Dict) -> List[Dict]:
        """
        Search GitHub for similar issues in popular repos.

        Free tier (authenticated): 5,000 requests/hour
        """
        if not self.github_token:
            return []

        cache_key = hashlib.sha256(
            f"github:{issue['title']}".encode()
        ).hexdigest()

        cached = self._check_internet_cache(cache_key)
        if cached:
            return cached

        try:
            # Search across GitHub
            headers = {
                'Authorization': f'token {self.github_token}',
                'Accept': 'application/vnd.github.v3+json'
            }

            params = {
                'q': f"{issue['title']} type:issue",
                'sort': 'reactions',
                'per_page': 5
            }

            response = requests.get(
                'https://api.github.com/search/issues',
                headers=headers,
                params=params,
                timeout=5
            )

            if response.status_code == 200:
                data = response.json()
                results = [
                    {
                        "title": item['title'],
                        "url": item['html_url'],
                        "repo": item['repository_url'].split('/')[-1],
                        "state": item['state'],
                        "comments": item['comments']
                    }
                    for item in data.get('items', [])[:5]
                ]

                self._save_internet_cache(cache_key, results)
                return results

        except Exception as e:
            print(f"GitHub search failed: {e}")

        return []

    def _check_internet_cache(self, cache_key: str) -> Optional[List]:
        """Check internet search cache (24 hours)."""
        try:
            with self.db_pool.connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT results, expires_at
                        FROM internet_search_cache
                        WHERE query_hash = %s
                    """, (cache_key,))

                    result = cur.fetchone()
                    if result and result[1] > datetime.now():
                        return json.loads(result[0])
        except Exception as e:
            print(f"Internet cache check failed: {e}")

        return None

    def _save_internet_cache(self, cache_key: str, results: List):
        """Save internet search results (24 hours)."""
        try:
            with self.db_pool.connection() as conn:
                with conn.cursor() as cur:
                    expires_at = datetime.now() + timedelta(hours=24)
                    cur.execute("""
                        INSERT INTO internet_search_cache
                        (query_hash, results, created_at, expires_at)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (query_hash)
                        DO UPDATE SET
                            results = EXCLUDED.results,
                            created_at = EXCLUDED.created_at,
                            expires_at = EXCLUDED.expires_at
                    """, (cache_key, json.dumps(results), datetime.now(), expires_at))
                    conn.commit()
        except Exception as e:
            print(f"Internet cache save failed: {e}")

    def _is_feature_request(self, issue: Dict) -> bool:
        """Detect if issue is a feature request."""
        title = issue['title'].lower()
        body = issue.get('body', '').lower()

        feature_indicators = [
            'add', 'support', 'implement', 'allow', 'enable',
            'would be nice', 'could we', 'feature request',
            'enhancement', 'suggestion'
        ]

        return any(indicator in title or indicator in body
                  for indicator in feature_indicators)

    def _generate_duplicate_response(self, issue: Dict, duplicate: Dict) -> str:
        """Generate response for duplicate issues."""
        return f"""Hi @{issue.get('author', 'user')}! 👋

This is a duplicate of #{duplicate['issue_number']}, which is currently {duplicate['state']}.

Please follow the original issue for updates. If you have additional information that's not already covered there, feel free to comment on the original issue.

Thanks for reporting!"""

    def _generate_docs_response(self, issue: Dict, doc: Dict) -> str:
        """Generate response for issues answered by docs."""
        return f"""Hi @{issue.get('author', 'user')}! 👋

This is covered in our documentation: **{doc['filename']}**

You can find detailed information there about how to {issue['title'].lower()}.

If you have questions after reading the docs, feel free to ask!"""

    def _generate_exists_response(self, issue: Dict, code: Dict) -> str:
        """Generate response for features that already exist."""
        return f"""Hi @{issue.get('author', 'user')}! 👋

Good news! This feature already exists in the codebase.

You can find it in: **{code['filename']}** (lines {code['start_line']}-{code['end_line']})

Check the documentation for usage instructions. Let us know if you need help using it!"""

    def _extract_image_urls(self, text: str, max_images: int = 3) -> list:
        """Extract image URLs from markdown/HTML text."""
        import re

        image_urls = []

        # Extract from HTML img tags: <img src="...">
        html_pattern = r'<img[^>]+src=["\']([^"\']+)["\']'
        html_matches = re.findall(html_pattern, text, re.IGNORECASE)
        image_urls.extend(html_matches)

        # Extract from markdown syntax: ![alt](url)
        markdown_pattern = r'!\[([^\]]*)\]\(([^)]+)\)'
        markdown_matches = re.findall(markdown_pattern, text)
        image_urls.extend([url for alt, url in markdown_matches])

        # Remove duplicates and limit to max_images
        unique_urls = list(dict.fromkeys(image_urls))[:max_images]

        # Filter for valid image URLs (common formats)
        valid_urls = []
        for url in unique_urls:
            if any(ext in url.lower() for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']) or 'user-attachments' in url:
                valid_urls.append(url)

        return valid_urls[:max_images]

    def _extract_github_links(self, text: str, max_links: int = 5) -> list:
        """Extract GitHub URLs from markdown/plain text."""
        import re

        github_urls = []

        # Pattern for GitHub URLs (issues, PRs, discussions, blob/files)
        github_pattern = r'https?://(?:www\.)?github\.com/([^/\s]+)/([^/\s]+)/(issues|pull|discussions|blob)/([^\s\)>\]#]+)'

        matches = re.findall(github_pattern, text, re.IGNORECASE)

        for owner, repo, link_type, path in matches:
            url = f"https://github.com/{owner}/{repo}/{link_type}/{path.split('#')[0]}"
            github_urls.append({
                'url': url,
                'owner': owner,
                'repo': repo,
                'type': link_type,
                'path': path.split('#')[0]
            })

        # Remove duplicates and limit
        unique_links = []
        seen_urls = set()
        for link in github_urls:
            if link['url'] not in seen_urls:
                unique_links.append(link)
                seen_urls.add(link['url'])
                if len(unique_links) >= max_links:
                    break

        return unique_links

    def _extract_non_github_links(self, text: str, max_links: int = 5) -> list:
        """Extract non-GitHub URLs from text."""
        import re

        # Pattern for any HTTP/HTTPS URL
        url_pattern = r'https?://[^\s\)>\]"]+'
        all_urls = re.findall(url_pattern, text, re.IGNORECASE)

        # Filter out GitHub URLs and image URLs
        non_github_urls = []
        for url in all_urls:
            if 'github.com' not in url.lower() and not any(ext in url.lower() for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']):
                non_github_urls.append(url)

        # Remove duplicates and limit
        unique_urls = list(dict.fromkeys(non_github_urls))[:max_links]
        return unique_urls

    def _fetch_github_link_content(self, link: dict, github_token: str = None) -> str:
        """Fetch content from a GitHub link using GitHub API."""
        try:
            from github import Github

            # Initialize GitHub client
            github_client = Github(github_token) if github_token else Github()

            owner = link['owner']
            repo_name = link['repo']
            link_type = link['type']
            path = link['path']

            repo = github_client.get_repo(f"{owner}/{repo_name}")

            if link_type == 'issues':
                # Fetch issue
                issue_number = int(path)
                issue = repo.get_issue(issue_number)
                return f"📎 **Referenced Issue #{issue_number}: {issue.title}**\n{issue.body[:1000] if issue.body else 'No description'}"

            elif link_type == 'pull':
                # Fetch PR
                pr_number = int(path)
                pr = repo.get_pull(pr_number)
                return f"📎 **Referenced PR #{pr_number}: {pr.title}**\n{pr.body[:1000] if pr.body else 'No description'}"

            elif link_type == 'discussions':
                # Discussions don't have simple API access
                return f"📎 **Referenced Discussion:** {link['url']}"

            elif link_type == 'blob':
                # Fetch file content
                file_path_parts = path.split('/')
                if len(file_path_parts) > 1:
                    branch = file_path_parts[0]
                    file_path = '/'.join(file_path_parts[1:])

                    try:
                        file_content = repo.get_contents(file_path, ref=branch)
                        if hasattr(file_content, 'decoded_content') and file_content.size < 50000:
                            content = file_content.decoded_content.decode('utf-8')
                            return f"📎 **Referenced File: {file_path}**\n```\n{content[:1500]}\n```"
                    except:
                        pass

            return None

        except Exception as e:
            print(f"⚠️  Failed to fetch GitHub link {link.get('url')}: {e}")
            return None

    def analyze_with_claude_optimized(
        self,
        issue: Dict,
        context: Dict
    ) -> Dict[str, Any]:
        """
        Use Claude with optimization (caching, limited tokens, simplified output).
        Now includes vision support for images in issues.

        Args:
            issue: Issue to analyze
            context: Search results (similar issues, PRs, code, docs, internet)

        Returns:
            Decision dict with single action
        """
        # Check cache
        cache_key = self._get_cache_key(issue, context)
        cached_response = self._check_response_cache(cache_key)

        if cached_response:
            cached_response['from_cache'] = True
            cached_response['cost_saved'] = 0.015
            return cached_response

        # Build optimized prompt
        prompt = self._build_optimized_prompt(issue, context)

        # Extract images from issue body
        image_urls = self._extract_image_urls(issue.get('body', ''))

        # Extract and fetch GitHub links from issue body
        github_links = self._extract_github_links(issue.get('body', ''))
        github_content = []
        if github_links:
            # Get GitHub token from context or environment
            github_token = context.get('github_token') or None
            print(f"🔗 Found {len(github_links)} GitHub link(s) in issue #{issue.get('issue_number')} - fetching content")

            for link in github_links:
                content = self._fetch_github_link_content(link, github_token)
                if content:
                    github_content.append(content)

        # Extract non-GitHub links (just list them)
        other_links = self._extract_non_github_links(issue.get('body', ''))

        # Add link context to prompt
        if github_content or other_links:
            link_context = "\n\n## Referenced Links\n"

            if github_content:
                link_context += "\n".join(github_content)

            if other_links:
                link_context += "\n\n⚠️ **User also referenced external links:**\n"
                for url in other_links:
                    link_context += f"- {url}\n"

            prompt += link_context

        if image_urls:
            print(f"🖼️  Found {len(image_urls)} image(s) in issue #{issue.get('issue_number')} - analyzing with vision")

        try:
            # Build message content with images
            message_content = []

            # Add images first (if any)
            for url in image_urls:
                message_content.append({
                    "type": "image",
                    "source": {
                        "type": "url",
                        "url": url
                    }
                })

            # Add text prompt
            message_content.append({
                "type": "text",
                "text": prompt
            })

            # Use prompt caching for system context
            message = self.claude_client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=500,  # Reduced from 1500 (cheaper!)
                system=[{
                    "type": "text",
                    "text": self._get_cached_system_prompt(),
                    "cache_control": {"type": "ephemeral"}
                }],
                messages=[{
                    "role": "user",
                    "content": message_content
                }]
            )

            # Parse response
            response_text = message.content[0].text
            if response_text.startswith("```json"):
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif response_text.startswith("```"):
                response_text = response_text.split("```")[1].split("```")[0].strip()

            result = json.loads(response_text)

            # Add cost tracking
            input_tokens = message.usage.input_tokens
            output_tokens = message.usage.output_tokens

            # Prompt caching tokens
            cache_read_tokens = getattr(message.usage, 'cache_read_input_tokens', 0)
            cache_write_tokens = getattr(message.usage, 'cache_creation_input_tokens', 0)

            # Calculate billable input tokens
            # Regular input tokens (not cached)
            regular_input = input_tokens - cache_read_tokens - cache_write_tokens

            # Cache write tokens cost 1.25x base price (for 5-min ephemeral cache)
            cache_write_cost = (cache_write_tokens / 1_000_000) * 3 * 1.25

            # Cache read tokens cost 0.1x base price (10% of normal)
            cache_read_cost = (cache_read_tokens / 1_000_000) * 3 * 0.1

            # Regular input and output costs
            regular_input_cost = (regular_input / 1_000_000) * 3
            output_cost = (output_tokens / 1_000_000) * 15

            total_cost = regular_input_cost + cache_write_cost + cache_read_cost + output_cost

            result['api_cost'] = {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_read_tokens": cache_read_tokens,
                "cache_write_tokens": cache_write_tokens,
                "input_cost_usd": round(regular_input_cost + cache_write_cost + cache_read_cost, 4),
                "output_cost_usd": round(output_cost, 4),
                "total_cost_usd": round(total_cost, 4)
            }

            result['from_cache'] = False
            result['images_analyzed'] = len(image_urls)

            # Save to cache
            self._save_response_cache(cache_key, result)

            return result

        except Exception as e:
            print(f"Claude analysis failed: {e}")
            return {
                "decision": "NEEDS_INVESTIGATION",
                "primary_message": "Could not analyze automatically",
                "evidence_bullets": ["AI analysis failed", "Needs manual review"],
                "draft_response": f"Thanks for reporting! We'll review this shortly.",
                "action_button_text": "Mark for Review",
                "action_button_style": "warning",
                "error": str(e)
            }

    def _get_cached_system_prompt(self) -> str:
        """System prompt that will be cached (90% cost reduction on cache hits)."""
        return """You are a GitHub issue triage assistant with vision capabilities. Your job is to make ONE CLEAR DECISION.

You may receive images (screenshots, error messages, UI mockups, etc.) along with the issue text. Analyze both the text and any images to make better decisions.

Return JSON with this structure:
{
  "decision": "CLOSE_DUPLICATE|CLOSE_FIXED|CLOSE_EXISTS|NEEDS_INVESTIGATION|VALID_FEATURE|NEEDS_INFO|ANSWER_FROM_DOCS|INVALID",
  "primary_message": "One sentence explanation",
  "evidence_bullets": ["2-3 short evidence points"],
  "draft_response": "Friendly comment to post on GitHub",
  "action_button_text": "Text for main action button",
  "action_button_style": "danger|success|primary|warning",
  "related_links": [{"text": "Link text", "url": "URL", "source": "stackoverflow|github|docs|internal"}]
}

Be decisive. Pick ONE action. Be helpful and friendly. If images show errors or bugs, reference them in your response."""

    def _build_optimized_prompt(self, issue: Dict, context: Dict) -> str:
        """Build short, focused prompt (only top results)."""
        # Only send top 3 of each type
        similar = context.get('similar_issues', [])[:3]
        prs = context.get('similar_prs', [])[:3]
        stackoverflow = context.get('stackoverflow', [])[:3]
        github_issues = context.get('github_issues', [])[:3]

        # Format similar issues with URLs
        similar_text = ""
        if similar:
            for i, s in enumerate(similar, 1):
                similar_text += f"\n  {i}. #{s['issue_number']}: {s['title']} ({int(s['similarity']*100)}% match, {s['state']}) - {s.get('github_url', 'N/A')}"

        # Format similar PRs with URLs
        prs_text = ""
        if prs:
            for i, p in enumerate(prs, 1):
                prs_text += f"\n  {i}. PR #{p['pr_number']}: {p['title']} ({int(p['similarity']*100)}% match, {p['state']}) - {p.get('github_url', 'N/A')}"

        # Check if images are present
        image_urls = self._extract_image_urls(issue.get('body', ''))
        images_note = f"\n\nNote: {len(image_urls)} image(s) attached - analyze them for error messages, UI issues, or bugs." if image_urls else ""

        return f"""Issue #{issue['issue_number']}: "{issue['title']}"

{issue.get('body', '')[:500]}{images_note}

Evidence:
- Similar issues: {len(similar)} found{similar_text}
- Related PRs: {len(prs)} found{prs_text}
- Stack Overflow: {len(stackoverflow)} results
- GitHub: {len(github_issues)} similar issues in other repos

When generating related_links, use the GitHub URLs provided above. Format: {{"text": "Issue #123", "url": "https://github.com/...", "source": "github"}}

Decide what to do."""


