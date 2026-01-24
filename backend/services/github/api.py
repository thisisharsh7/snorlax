"""
Service for GitHub API integration - fetching issues, PRs, and comments.
"""

from github import Github, GithubException, RateLimitExceededException
import os
import time
import logging
from typing import List, Dict, Optional, Callable, Any
from functools import wraps
from itertools import islice
import psycopg
from datetime import datetime, timezone

# Setup logger
logger = logging.getLogger(__name__)


def retry_with_exponential_backoff(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    exponential_base: float = 2.0,
    exceptions: tuple = (GithubException, RateLimitExceededException)
):
    """
    Decorator that retries a function with exponential backoff on specific exceptions.

    Args:
        max_retries: Maximum number of retry attempts (default: 3)
        base_delay: Initial delay in seconds (default: 1.0)
        max_delay: Maximum delay between retries in seconds (default: 60.0)
        exponential_base: Base for exponential backoff calculation (default: 2.0)
        exceptions: Tuple of exceptions to catch and retry (default: GitHub exceptions)

    Returns:
        Decorated function with retry logic

    Example:
        @retry_with_exponential_backoff(max_retries=3)
        def fetch_issues(repo_name):
            return github.get_repo(repo_name).get_issues()

    Backoff Strategy:
        - Attempt 1: No delay
        - Attempt 2: 1 second delay (2^0 * 1)
        - Attempt 3: 2 second delay (2^1 * 1)
        - Attempt 4: 4 second delay (2^2 * 1)
        - For rate limits: Uses GitHub's reset time or backoff, whichever is shorter
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            last_exception = None

            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)

                except RateLimitExceededException as e:
                    last_exception = e

                    if attempt == max_retries:
                        logger.error(f"GitHub rate limit exceeded after {max_retries} retries")
                        raise

                    # For rate limit errors, use GitHub's reset time
                    try:
                        # Try to get the reset time from the exception or API
                        # PyGithub provides rate limit info via the exception
                        reset_time = getattr(e, 'reset_time', None)
                        if reset_time:
                            wait_time = min(reset_time - time.time(), max_delay)
                            if wait_time > 0:
                                logger.warning(
                                    f"Rate limit exceeded. Waiting {wait_time:.1f}s until reset "
                                    f"(attempt {attempt + 1}/{max_retries})"
                                )
                                time.sleep(wait_time)
                                continue
                    except Exception:
                        pass

                    # Fallback to exponential backoff if reset time unavailable
                    wait_time = min(base_delay * (exponential_base ** attempt), max_delay)
                    logger.warning(
                        f"Rate limit exceeded. Backing off for {wait_time:.1f}s "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    time.sleep(wait_time)

                except exceptions as e:
                    last_exception = e

                    if attempt == max_retries:
                        logger.error(
                            f"GitHub API call failed after {max_retries} retries: {str(e)}"
                        )
                        raise

                    # Check if this is a retryable error
                    status_code = getattr(e, 'status', None)

                    # Retry on:
                    # - 429 (rate limit) - handled above
                    # - 502 (bad gateway)
                    # - 503 (service unavailable)
                    # - 504 (gateway timeout)
                    if status_code in [502, 503, 504]:
                        wait_time = min(base_delay * (exponential_base ** attempt), max_delay)
                        logger.warning(
                            f"GitHub API error {status_code}. Retrying in {wait_time:.1f}s "
                            f"(attempt {attempt + 1}/{max_retries})"
                        )
                        time.sleep(wait_time)
                    else:
                        # Not a retryable error, raise immediately
                        logger.error(f"Non-retryable GitHub API error: {str(e)}")
                        raise

            # If we exhausted all retries
            if last_exception:
                raise last_exception

        return wrapper
    return decorator


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
            # Show first 10 chars of token for verification (not full token for security)
            token_preview = self.token[:10] if len(self.token) >= 10 else self.token[:5]
            print(f"✓ GitHub service initialized with AUTHENTICATED token (starts with: {token_preview}...)")
            print(f"   Rate limit: 5,000 calls/hour")
        else:
            self.github = Github()  # Unauthenticated (rate limited)
            print("⚠ WARNING: GitHub service initialized WITHOUT token")
            print("   Rate limit: 60 calls/hour (unauthenticated)")
            print("   Add a GitHub token in Settings to get 5,000 calls/hour")

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
            limit = rate_limit_data.resources.core.limit
            reset_time = rate_limit_data.resources.core.reset

            # Show authentication status
            auth_status = "AUTHENTICATED" if self.token else "UNAUTHENTICATED"
            print(f"Rate limit check [{auth_status}]: {remaining}/{limit} calls remaining, resets at {reset_time.strftime('%I:%M %p')}")

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
        conn = None
        cur = None
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
                # CRITICAL: Use raw_data to avoid triggering lazy load API call
                # Accessing issue.pull_request makes a hidden API call per issue!
                if hasattr(issue, '_rawData') and issue._rawData.get('pull_request'):
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
        finally:
            # Always close database connections, even on exceptions
            if cur:
                try:
                    cur.close()
                except Exception:
                    pass
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

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
        conn = None
        cur = None
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

            try:
                for pr in prs:
                    try:
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
                        # Make pr.updated_at timezone-aware to compare with timezone-aware last_sync from DB
                        if last_sync and pr.updated_at:
                            pr_updated_at = pr.updated_at.replace(tzinfo=timezone.utc) if pr.updated_at.tzinfo is None else pr.updated_at
                            if pr_updated_at < last_sync:
                                skipped_count += 1
                                continue

                        # Rate limit monitoring every 50 items
                        if fetched_count % 50 == 0:
                            print(f"Progress: fetched {fetched_count}, imported {imported_count}, updated {updated_count}, skipped {skipped_count}")
                            rate_check = self.check_rate_limit(required_calls=5)
                            if not rate_check["sufficient"]:
                                print(f"⚠ Stopping early: only {rate_check['remaining']} API calls remaining")
                                break
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

            except StopIteration:
                # Normal end of pagination
                print(f"Completed pagination: fetched {fetched_count} PRs")
            except Exception as e:
                # Catch errors during pagination (e.g., network issues, GitHub API errors)
                print(f"⚠ Error during PR pagination: {str(e)}")
                print(f"Stopping PR import. Successfully processed {imported_count} new, {updated_count} updated")
                import traceback
                traceback.print_exc()

            # Update last_prs_sync timestamp for incremental sync
            cur.execute("""
                UPDATE repositories
                SET last_prs_sync = NOW()
                WHERE project_id = %s
            """, (project_id,))

            # Final commit
            conn.commit()

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
        finally:
            # Always close database connections, even on exceptions
            if cur:
                try:
                    cur.close()
                except Exception:
                    pass
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

    def import_issues_by_state(
        self,
        project_id: str,
        state: str = 'open',
        limit: int = 50,
        offset: int = 0
    ) -> Dict:
        """
        Import issues filtered by state (open/closed) with pagination.

        Args:
            project_id: Project identifier
            state: State filter ('open' or 'closed')
            limit: Maximum number of issues to import
            offset: Number of issues to skip (for pagination)

        Returns:
            Dictionary with import statistics
        """
        conn = None
        cur = None
        try:
            # Get repository URL from database
            conn = self.get_db_connection()
            cur = conn.cursor()

            cur.execute(
                "SELECT repo_url FROM repositories WHERE project_id = %s",
                (project_id,)
            )
            result = cur.fetchone()

            if not result:
                return {
                    "status": "error",
                    "message": "Project not found",
                    "imported": 0
                }

            repo_url = result[0]
            repo_name = self.extract_repo_name_from_url(repo_url)
            repo = self.github.get_repo(repo_name)

            imported_count = 0
            updated_count = 0
            fetched_count = 0

            # Pre-fetch existing issue numbers for fast O(1) lookup
            cur.execute(
                "SELECT issue_number FROM github_issues WHERE project_id = %s",
                (project_id,)
            )
            existing_issues = set(row[0] for row in cur.fetchall())

            # Fetch issues with state filter
            issues = repo.get_issues(state=state, sort='updated', direction='desc')

            logger.info(f"Fetching {state} issues: limit={limit}, offset={offset}")

            # Use islice to skip offset items and take limit items
            for issue in islice(issues, offset, offset + limit):
                # Skip pull requests
                if hasattr(issue, '_rawData') and issue._rawData.get('pull_request'):
                    continue

                fetched_count += 1

                try:
                    labels = [label.name for label in issue.labels]

                    # Check if issue already exists
                    if issue.number in existing_issues:
                        # Update existing issue
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
                        existing_issues.add(issue.number)

                except Exception as e:
                    logger.error(f"Error importing issue #{issue.number}: {str(e)}")
                    continue

            conn.commit()

            return {
                "status": "success",
                "imported": imported_count,
                "updated": updated_count,
                "fetched": fetched_count,
                "total": imported_count + updated_count
            }

        except Exception as e:
            logger.error(f"Error in import_issues_by_state: {str(e)}")
            return {
                "status": "error",
                "message": str(e),
                "imported": 0
            }
        finally:
            if cur:
                try:
                    cur.close()
                except Exception:
                    pass
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

    def import_prs_by_state(
        self,
        project_id: str,
        state: str = 'open',
        limit: int = 50,
        offset: int = 0
    ) -> Dict:
        """
        Import PRs filtered by state (open/closed) with pagination.

        Args:
            project_id: Project identifier
            state: State filter ('open' or 'closed')
            limit: Maximum number of PRs to import
            offset: Number of PRs to skip (for pagination)

        Returns:
            Dictionary with import statistics
        """
        conn = None
        cur = None
        try:
            # Get repository URL from database
            conn = self.get_db_connection()
            cur = conn.cursor()

            cur.execute(
                "SELECT repo_url FROM repositories WHERE project_id = %s",
                (project_id,)
            )
            result = cur.fetchone()

            if not result:
                return {
                    "status": "error",
                    "message": "Project not found",
                    "imported": 0
                }

            repo_url = result[0]
            repo_name = self.extract_repo_name_from_url(repo_url)
            repo = self.github.get_repo(repo_name)

            imported_count = 0
            updated_count = 0
            fetched_count = 0

            # Pre-fetch existing PR numbers for fast O(1) lookup
            cur.execute(
                "SELECT pr_number FROM github_pull_requests WHERE project_id = %s",
                (project_id,)
            )
            existing_prs = set(row[0] for row in cur.fetchall())

            # Fetch PRs with state filter
            prs = repo.get_pulls(state=state, sort='updated', direction='desc')

            logger.info(f"Fetching {state} PRs: limit={limit}, offset={offset}")

            # Use islice to skip offset items and take limit items
            for pr in islice(prs, offset, offset + limit):
                fetched_count += 1

                try:
                    labels = [label.name for label in pr.labels]

                    # Determine state
                    if pr.merged:
                        pr_state = 'merged'
                    else:
                        pr_state = pr.state

                    # Check if PR already exists
                    if pr.number in existing_prs:
                        # Update existing PR
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
                            pr_state,
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
                            pr_state,
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
                        existing_prs.add(pr.number)

                except Exception as e:
                    logger.error(f"Error importing PR #{pr.number}: {str(e)}")
                    continue

            conn.commit()

            return {
                "status": "success",
                "imported": imported_count,
                "updated": updated_count,
                "fetched": fetched_count,
                "total": imported_count + updated_count
            }

        except Exception as e:
            logger.error(f"Error in import_prs_by_state: {str(e)}")
            return {
                "status": "error",
                "message": str(e),
                "imported": 0
            }
        finally:
            if cur:
                try:
                    cur.close()
                except Exception:
                    pass
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

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

    @retry_with_exponential_backoff(max_retries=3, base_delay=1.0)
    def post_issue_comment(self, project_id: str, issue_number: int, comment_body: str) -> Dict:
        """
        Post a comment on a GitHub issue.

        Automatically retries on transient GitHub API errors with exponential backoff.

        Args:
            project_id: Repository full name (e.g., "owner/repo")
            issue_number: Issue number
            comment_body: Comment text to post

        Returns:
            Dictionary with comment information

        Raises:
            GithubException: If posting comment fails
            ValueError: If not authenticated or repo not found
        """
        if not self.token:
            raise ValueError("Cannot post comments without GitHub authentication token. Please add a token in Settings.")

        try:
            # Get repository
            repo = self.github.get_repo(project_id)

            # Get issue
            issue = repo.get_issue(issue_number)

            # Post comment
            comment = issue.create_comment(comment_body)

            return {
                "success": True,
                "comment_id": comment.id,
                "comment_url": comment.html_url,
                "created_at": comment.created_at.isoformat(),
                "author": comment.user.login
            }

        except GithubException as e:
            error_msg = f"Failed to post comment: {e.data.get('message', str(e))}"
            raise GithubException(e.status, error_msg, e.headers)
        except Exception as e:
            raise Exception(f"Unexpected error posting comment: {str(e)}")
