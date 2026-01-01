"""
Service for GitHub API integration - fetching issues, PRs, and comments.
"""

from github import Github, GithubException, RateLimitExceededException
import os
from typing import List, Dict, Optional
import psycopg
from datetime import datetime


class GitHubService:
    """Handles GitHub API operations and database storage."""

    def __init__(self, github_token: Optional[str] = None):
        """
        Initialize GitHub service.

        Args:
            github_token: GitHub personal access token (optional for public repos)
        """
        self.token = github_token or os.getenv("GITHUB_TOKEN")
        if self.token:
            self.github = Github(self.token)
        else:
            self.github = Github()  # Unauthenticated (rate limited)

        self.db_url = os.getenv("APP_DATABASE_URL")

    def get_db_connection(self):
        """Get database connection."""
        return psycopg.connect(self.db_url)

    def check_rate_limit(self, required_calls: int = 20) -> Dict:
        """
        Check if sufficient GitHub API rate limit is available.

        Args:
            required_calls: Minimum number of API calls required

        Returns:
            Dictionary with rate limit status
        """
        try:
            # Get rate limit info from GitHub API
            rate_limit_data = self.github.get_rate_limit()

            # Access the core rate limit (for most API calls)
            # Correct structure: RateLimitOverview.resources.core
            # - rate_limit_data = RateLimitOverview
            # - rate_limit_data.resources = RateLimit (has .core, .search, etc.)
            # - rate_limit_data.resources.core = Rate (has .remaining, .reset)
            remaining = rate_limit_data.resources.core.remaining
            reset_time = rate_limit_data.resources.core.reset

            print(f"Rate limit check: {remaining} calls remaining, resets at {reset_time.strftime('%I:%M %p')}")

            if remaining < required_calls:
                return {
                    "sufficient": False,
                    "remaining": remaining,
                    "reset_time": reset_time.timestamp(),
                    "message": f"Insufficient rate limit. Only {remaining} calls remaining. Please wait until {reset_time.strftime('%I:%M %p')} or add a GitHub token for higher limits."
                }

            return {
                "sufficient": True,
                "remaining": remaining,
                "reset_time": reset_time.timestamp()
            }
        except Exception as e:
            # If we can't check rate limit, proceed cautiously
            print(f"Warning: Could not check rate limit: {str(e)}")
            return {"sufficient": True, "remaining": -1}

    def extract_repo_name_from_url(self, github_url: str) -> str:
        """
        Extract owner/repo from GitHub URL.

        Args:
            github_url: GitHub repository URL

        Returns:
            Repository name in format 'owner/repo'
        """
        # Handle different URL formats
        # https://github.com/owner/repo
        # https://github.com/owner/repo.git
        # git@github.com:owner/repo.git

        if "github.com/" in github_url:
            parts = github_url.split("github.com/")[1]
            parts = parts.replace(".git", "").strip("/")
            return parts
        elif "github.com:" in github_url:
            parts = github_url.split("github.com:")[1]
            parts = parts.replace(".git", "")
            return parts
        else:
            raise ValueError(f"Invalid GitHub URL: {github_url}")

    def import_issues(self, project_id: str, github_url: str, limit: Optional[int] = None) -> Dict:
        """
        Import issues from a GitHub repository.

        Args:
            project_id: Project identifier
            github_url: GitHub repository URL
            limit: Optional limit on number of NEW issues to import (default: 200)

        Returns:
            Dictionary with import statistics
        """
        try:
            # Check rate limit before starting
            rate_limit_check = self.check_rate_limit(required_calls=10)
            if not rate_limit_check["sufficient"]:
                return {
                    "status": "rate_limited",
                    "message": rate_limit_check["message"],
                    "reset_time": rate_limit_check["reset_time"]
                }

            repo_name = self.extract_repo_name_from_url(github_url)
            repo = self.github.get_repo(repo_name)

            conn = self.get_db_connection()
            cur = conn.cursor()

            imported_count = 0  # NEW items imported
            updated_count = 0   # Existing items updated
            skipped_count = 0   # Unchanged items skipped
            fetched_count = 0   # Total items fetched from API

            # Check for last sync time to enable incremental sync
            cur.execute(
                "SELECT last_issues_sync FROM repositories WHERE project_id = %s",
                (project_id,)
            )
            result = cur.fetchone()
            last_sync = result[0] if result else None

            # Pre-fetch ALL existing issue numbers into a set for fast O(1) lookup
            cur.execute(
                "SELECT issue_number FROM github_issues WHERE project_id = %s",
                (project_id,)
            )
            existing_issues = set(row[0] for row in cur.fetchall())

            # Use incremental sync if we have a previous sync time
            # This fetches only issues updated since last sync
            if last_sync:
                print(f"Incremental sync: fetching issues updated since {last_sync.strftime('%Y-%m-%d %I:%M %p')}")
                issues = repo.get_issues(state='all', since=last_sync)
            else:
                print(f"Full sync: fetching all issues")
                issues = repo.get_issues(state='all')

            print(f"Importing up to {limit if limit else 'all'} NEW issues (DB has {len(existing_issues)} existing)...")

            for issue in issues:
                # Skip pull requests (they have their own table)
                if issue.pull_request:
                    continue

                fetched_count += 1

                # Stop if we've imported enough NEW items
                if limit and imported_count >= limit:
                    print(f"✓ Reached import limit of {limit} NEW issues")
                    break

                # Safety check: stop if we've fetched way more than the limit
                # (indicates mostly duplicates, prevents runaway API calls)
                if limit and fetched_count >= limit * 2:
                    print(f"⚠ Safety stop: fetched {fetched_count} items, well beyond limit of {limit}")
                    break

                # Rate limit monitoring every 50 items
                if fetched_count % 50 == 0:
                    print(f"Progress: fetched {fetched_count}, imported {imported_count}, skipped {skipped_count}")
                    rate_check = self.check_rate_limit(required_calls=5)
                    if not rate_check["sufficient"]:
                        print(f"⚠ Stopping early: only {rate_check['remaining']} API calls remaining")
                        break

                try:
                    # Extract labels
                    labels = [label.name for label in issue.labels]

                    # Check if issue already exists
                    if issue.number in existing_issues:
                        # Update existing issue with latest data
                        cur.execute("""
                            UPDATE github_issues SET
                                title = %s,
                                body = %s,
                                state = %s,
                                labels = %s,
                                updated_at = %s,
                                closed_at = %s,
                                comments_count = %s
                            WHERE project_id = %s AND issue_number = %s
                        """, (
                            issue.title,
                            issue.body or "",
                            issue.state,
                            labels,
                            issue.updated_at,
                            issue.closed_at,
                            issue.comments,
                            project_id,
                            issue.number
                        ))
                        updated_count += 1
                    else:
                        # Insert new issue
                        cur.execute("""
                            INSERT INTO github_issues (
                                project_id, issue_number, title, body, state,
                                author, labels, created_at, updated_at, closed_at,
                                comments_count, github_url
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            project_id,
                            issue.number,
                            issue.title,
                            issue.body or "",
                            issue.state,
                            issue.user.login if issue.user else "unknown",
                            labels,
                            issue.created_at,
                            issue.updated_at,
                            issue.closed_at,
                            issue.comments,
                            issue.html_url
                        ))
                        imported_count += 1
                        existing_issues.add(issue.number)  # Add to set to avoid re-importing

                    # Commit every 100 items to save progress
                    if (imported_count + updated_count) % 100 == 0:
                        conn.commit()
                        print(f"✓ Committed batch: {imported_count} new, {updated_count} updated so far")

                except Exception as e:
                    print(f"Error importing issue #{issue.number}: {str(e)}")
                    continue

            # Update last_issues_sync timestamp for incremental sync
            cur.execute("""
                UPDATE repositories
                SET last_issues_sync = NOW()
                WHERE project_id = %s
            """, (project_id,))

            # Final commit
            conn.commit()
            cur.close()
            conn.close()

            # Get final rate limit status
            final_rate_check = self.check_rate_limit(required_calls=0)

            return {
                "status": "success",
                "imported": imported_count,
                "updated": updated_count,
                "skipped": skipped_count,
                "fetched": fetched_count,
                "total": imported_count + updated_count + skipped_count,
                "repository": repo_name,
                "rate_limit_remaining": final_rate_check.get("remaining", -1),
                "sync_type": "incremental" if last_sync else "full"
            }

        except RateLimitExceededException as e:
            return {
                "status": "rate_limited",
                "message": "GitHub API rate limit exceeded. Try again later or add a GitHub token for higher limits.",
                "reset_time": e.reset_time if hasattr(e, 'reset_time') else None
            }
        except GithubException as e:
            if e.status == 403 and 'rate limit' in str(e).lower():
                return {
                    "status": "rate_limited",
                    "message": "GitHub API rate limit exceeded. Try again later or add a GitHub token.",
                    "reset_time": None
                }
            return {
                "status": "error",
                "message": f"GitHub API error: {str(e)}",
                "error_code": e.status if hasattr(e, 'status') else None
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Import failed: {str(e)}"
            }

    def import_pull_requests(self, project_id: str, github_url: str, limit: Optional[int] = None) -> Dict:
        """
        Import pull requests from a GitHub repository.

        Args:
            project_id: Project identifier
            github_url: GitHub repository URL
            limit: Optional limit on number of NEW PRs to import (default: 200)

        Returns:
            Dictionary with import statistics
        """
        try:
            # Check rate limit before starting
            rate_limit_check = self.check_rate_limit(required_calls=10)
            if not rate_limit_check["sufficient"]:
                return {
                    "status": "rate_limited",
                    "message": rate_limit_check["message"],
                    "reset_time": rate_limit_check["reset_time"]
                }

            repo_name = self.extract_repo_name_from_url(github_url)
            repo = self.github.get_repo(repo_name)

            conn = self.get_db_connection()
            cur = conn.cursor()

            imported_count = 0  # NEW items imported
            updated_count = 0   # Existing items updated
            skipped_count = 0   # Unchanged items skipped
            fetched_count = 0   # Total items fetched from API

            # Check for last sync time to enable incremental sync
            cur.execute(
                "SELECT last_prs_sync FROM repositories WHERE project_id = %s",
                (project_id,)
            )
            result = cur.fetchone()
            last_sync = result[0] if result else None

            # Pre-fetch ALL existing PR numbers into a set for fast O(1) lookup
            cur.execute(
                "SELECT pr_number FROM github_pull_requests WHERE project_id = %s",
                (project_id,)
            )
            existing_prs = set(row[0] for row in cur.fetchall())

            # Note: PyGithub's get_pulls() doesn't support 'since' parameter
            # So we fetch all PRs but this will be optimized in future with direct API calls
            prs = repo.get_pulls(state='all', sort='updated', direction='desc')

            if last_sync:
                print(f"Incremental sync: filtering PRs updated since {last_sync.strftime('%Y-%m-%d %I:%M %p')}")
            else:
                print(f"Full sync: fetching all PRs")

            print(f"Importing up to {limit if limit else 'all'} NEW PRs (DB has {len(existing_prs)} existing)...")

            for pr in prs:
                fetched_count += 1

                # Stop if we've imported enough NEW items
                if limit and imported_count >= limit:
                    print(f"✓ Reached import limit of {limit} NEW PRs")
                    break

                # Safety check: stop if we've fetched way more than the limit
                # (indicates mostly duplicates, prevents runaway API calls)
                if limit and fetched_count >= limit * 2:
                    print(f"⚠ Safety stop: fetched {fetched_count} items, well beyond limit of {limit}")
                    break

                # Skip PRs not updated since last sync (for incremental sync)
                if last_sync and pr.updated_at < last_sync:
                    skipped_count += 1
                    continue

                # Rate limit monitoring every 50 items
                if fetched_count % 50 == 0:
                    print(f"Progress: fetched {fetched_count}, imported {imported_count}, updated {updated_count}, skipped {skipped_count}")
                    rate_check = self.check_rate_limit(required_calls=5)
                    if not rate_check["sufficient"]:
                        print(f"⚠ Stopping early: only {rate_check['remaining']} API calls remaining")
                        break

                try:
                    # Extract labels
                    labels = [label.name for label in pr.labels]

                    # Determine state
                    if pr.merged:
                        state = 'merged'
                    else:
                        state = pr.state

                    # Check if PR already exists
                    if pr.number in existing_prs:
                        # Update existing PR with latest data
                        cur.execute("""
                            UPDATE github_pull_requests SET
                                title = %s,
                                body = %s,
                                state = %s,
                                labels = %s,
                                updated_at = %s,
                                closed_at = %s,
                                merged_at = %s,
                                comments_count = %s,
                                review_comments_count = %s,
                                mergeable = %s
                            WHERE project_id = %s AND pr_number = %s
                        """, (
                            pr.title,
                            pr.body or "",
                            state,
                            labels,
                            pr.updated_at,
                            pr.closed_at,
                            pr.merged_at,
                            pr.comments,
                            pr.review_comments,
                            pr.mergeable,
                            project_id,
                            pr.number
                        ))
                        updated_count += 1
                    else:
                        # Insert new PR
                        cur.execute("""
                            INSERT INTO github_pull_requests (
                                project_id, pr_number, title, body, state,
                                author, labels, created_at, updated_at, closed_at,
                                merged_at, comments_count, review_comments_count,
                                commits_count, additions, deletions, changed_files,
                                github_url, head_branch, base_branch, mergeable
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            project_id,
                            pr.number,
                            pr.title,
                            pr.body or "",
                            state,
                            pr.user.login if pr.user else "unknown",
                            labels,
                            pr.created_at,
                            pr.updated_at,
                            pr.closed_at,
                            pr.merged_at,
                            pr.comments,
                            pr.review_comments,
                            pr.commits,
                            pr.additions,
                            pr.deletions,
                            pr.changed_files,
                            pr.html_url,
                            pr.head.ref if pr.head else None,
                            pr.base.ref if pr.base else None,
                            pr.mergeable
                        ))
                        imported_count += 1
                        existing_prs.add(pr.number)  # Add to set to avoid re-importing

                    # Commit every 100 items to save progress
                    if (imported_count + updated_count) % 100 == 0:
                        conn.commit()
                        print(f"✓ Committed batch: {imported_count} new, {updated_count} updated so far")

                except Exception as e:
                    print(f"Error importing PR #{pr.number}: {str(e)}")
                    continue

            # Update last_prs_sync timestamp for incremental sync
            cur.execute("""
                UPDATE repositories
                SET last_prs_sync = NOW()
                WHERE project_id = %s
            """, (project_id,))

            # Final commit
            conn.commit()
            cur.close()
            conn.close()

            # Get final rate limit status
            final_rate_check = self.check_rate_limit(required_calls=0)

            return {
                "status": "success",
                "imported": imported_count,
                "updated": updated_count,
                "skipped": skipped_count,
                "fetched": fetched_count,
                "total": imported_count + updated_count + skipped_count,
                "repository": repo_name,
                "rate_limit_remaining": final_rate_check.get("remaining", -1),
                "sync_type": "incremental" if last_sync else "full"
            }

        except RateLimitExceededException as e:
            return {
                "status": "rate_limited",
                "message": "GitHub API rate limit exceeded. Try again later or add a GitHub token for higher limits.",
                "reset_time": e.reset_time if hasattr(e, 'reset_time') else None
            }
        except GithubException as e:
            if e.status == 403 and 'rate limit' in str(e).lower():
                return {
                    "status": "rate_limited",
                    "message": "GitHub API rate limit exceeded. Try again later or add a GitHub token.",
                    "reset_time": None
                }
            return {
                "status": "error",
                "message": f"GitHub API error: {str(e)}",
                "error_code": e.status if hasattr(e, 'status') else None
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Import failed: {str(e)}"
            }

    def get_issues_for_project(self, project_id: str, state: Optional[str] = None) -> List[Dict]:
        """
        Get issues for a project from database.

        Args:
            project_id: Project identifier
            state: Optional filter by state ('open', 'closed', or None for all)

        Returns:
            List of issue dictionaries
        """
        conn = self.get_db_connection()
        cur = conn.cursor()

        if state:
            cur.execute("""
                SELECT issue_number, title, body, state, author, labels,
                       created_at, comments_count, github_url
                FROM github_issues
                WHERE project_id = %s AND state = %s
                ORDER BY created_at DESC
            """, (project_id, state))
        else:
            cur.execute("""
                SELECT issue_number, title, body, state, author, labels,
                       created_at, comments_count, github_url
                FROM github_issues
                WHERE project_id = %s
                ORDER BY created_at DESC
            """, (project_id,))

        results = cur.fetchall()
        cur.close()
        conn.close()

        return [
            {
                "number": row[0],
                "title": row[1],
                "body": row[2],
                "state": row[3],
                "author": row[4],
                "labels": row[5],
                "created_at": str(row[6]),
                "comments_count": row[7],
                "html_url": row[8]
            }
            for row in results
        ]

    def get_pull_requests_for_project(self, project_id: str, state: Optional[str] = None) -> List[Dict]:
        """
        Get pull requests for a project from database.

        Args:
            project_id: Project identifier
            state: Optional filter by state ('open', 'closed', 'merged', or None for all)

        Returns:
            List of PR dictionaries
        """
        conn = self.get_db_connection()
        cur = conn.cursor()

        if state:
            cur.execute("""
                SELECT pr_number, title, body, state, author, labels,
                       created_at, additions, deletions, changed_files, github_url
                FROM github_pull_requests
                WHERE project_id = %s AND state = %s
                ORDER BY created_at DESC
            """, (project_id, state))
        else:
            cur.execute("""
                SELECT pr_number, title, body, state, author, labels,
                       created_at, additions, deletions, changed_files, github_url
                FROM github_pull_requests
                WHERE project_id = %s
                ORDER BY created_at DESC
            """, (project_id,))

        results = cur.fetchall()
        cur.close()
        conn.close()

        return [
            {
                "number": row[0],
                "title": row[1],
                "body": row[2],
                "state": row[3],
                "author": row[4],
                "labels": row[5],
                "created_at": str(row[6]),
                "additions": row[7],
                "deletions": row[8],
                "changed_files": row[9],
                "html_url": row[10]
            }
            for row in results
        ]
