"""
Service for GitHub API integration - fetching issues, PRs, and comments.
"""

from github import Github, GithubException
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
        Import all issues from a GitHub repository.

        Args:
            project_id: Project identifier
            github_url: GitHub repository URL
            limit: Optional limit on number of issues to fetch (for testing)

        Returns:
            Dictionary with import statistics
        """
        try:
            repo_name = self.extract_repo_name_from_url(github_url)
            repo = self.github.get_repo(repo_name)

            conn = self.get_db_connection()
            cur = conn.cursor()

            imported_count = 0
            skipped_count = 0

            # Fetch all issues (open and closed)
            issues = repo.get_issues(state='all')

            for issue in issues:
                # Skip pull requests (they have their own table)
                if issue.pull_request:
                    continue

                try:
                    # Check if already exists
                    cur.execute(
                        "SELECT id FROM github_issues WHERE project_id = %s AND issue_number = %s",
                        (project_id, issue.number)
                    )

                    if cur.fetchone():
                        skipped_count += 1
                        continue

                    # Extract labels
                    labels = [label.name for label in issue.labels]

                    # Insert issue
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

                    if limit and imported_count >= limit:
                        break

                except Exception as e:
                    print(f"Error importing issue #{issue.number}: {str(e)}")
                    continue

            conn.commit()
            cur.close()
            conn.close()

            return {
                "status": "success",
                "imported": imported_count,
                "skipped": skipped_count,
                "total": imported_count + skipped_count,
                "repository": repo_name
            }

        except GithubException as e:
            return {
                "status": "error",
                "message": f"GitHub API error: {str(e)}"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Import failed: {str(e)}"
            }

    def import_pull_requests(self, project_id: str, github_url: str, limit: Optional[int] = None) -> Dict:
        """
        Import all pull requests from a GitHub repository.

        Args:
            project_id: Project identifier
            github_url: GitHub repository URL
            limit: Optional limit on number of PRs to fetch

        Returns:
            Dictionary with import statistics
        """
        try:
            repo_name = self.extract_repo_name_from_url(github_url)
            repo = self.github.get_repo(repo_name)

            conn = self.get_db_connection()
            cur = conn.cursor()

            imported_count = 0
            skipped_count = 0

            # Fetch all PRs (open, closed, and merged)
            prs = repo.get_pulls(state='all')

            for pr in prs:
                try:
                    # Check if already exists
                    cur.execute(
                        "SELECT id FROM github_pull_requests WHERE project_id = %s AND pr_number = %s",
                        (project_id, pr.number)
                    )

                    if cur.fetchone():
                        skipped_count += 1
                        continue

                    # Extract labels
                    labels = [label.name for label in pr.labels]

                    # Determine state
                    if pr.merged:
                        state = 'merged'
                    else:
                        state = pr.state

                    # Insert PR
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

                    if limit and imported_count >= limit:
                        break

                except Exception as e:
                    print(f"Error importing PR #{pr.number}: {str(e)}")
                    continue

            conn.commit()
            cur.close()
            conn.close()

            return {
                "status": "success",
                "imported": imported_count,
                "skipped": skipped_count,
                "total": imported_count + skipped_count,
                "repository": repo_name
            }

        except GithubException as e:
            return {
                "status": "error",
                "message": f"GitHub API error: {str(e)}"
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
                "url": row[8]
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
                "url": row[10]
            }
            for row in results
        ]
