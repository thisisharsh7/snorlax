"""
Background script to periodically fetch issues and PRs from GitHub.

This keeps the database fresh with the latest data from GitHub API.
CocoIndex automatically regenerates embeddings via PostgreSQL triggers.
"""

import asyncio
import logging
from typing import Dict
from services.github.api import GitHubService
from utils.database import get_db_connection

logger = logging.getLogger(__name__)


async def sync_all_repositories() -> Dict[str, any]:
    """
    Sync all indexed repositories from GitHub.

    Fetches latest issues and PRs for each indexed repository.
    CocoIndex automatically updates embeddings via database triggers.

    Returns:
        Summary statistics about the sync operation
    """
    github_service = GitHubService()
    total_repos = 0
    successful_repos = 0
    failed_repos = 0

    try:
        # Get all indexed repositories
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT project_id, repo_url, repo_name
            FROM repositories
            WHERE status = 'indexed'
            ORDER BY last_issues_sync NULLS FIRST
        """)
        repos = cur.fetchall()
        cur.close()
        conn.close()

        total_repos = len(repos)
        logger.info(f"Starting background sync for {total_repos} repositories")

        for project_id, repo_url, repo_name in repos:
            try:
                # Fetch latest issues from GitHub
                logger.info(f"[{repo_name}] Starting sync...")

                issues_result = github_service.import_issues(
                    project_id,
                    repo_url,
                    limit=100  # Limit to avoid rate limit issues
                )

                prs_result = github_service.import_pull_requests(
                    project_id,
                    repo_url,
                    limit=100
                )

                # CocoIndex automatically updates embeddings via triggers
                if issues_result.get('status') == 'success':
                    logger.info(
                        f"[{repo_name}] Issues: {issues_result['imported']} new, "
                        f"{issues_result['updated']} updated"
                    )

                if prs_result.get('status') == 'success':
                    logger.info(
                        f"[{repo_name}] PRs: {prs_result['imported']} new, "
                        f"{prs_result['updated']} updated"
                    )

                successful_repos += 1

            except Exception as e:
                logger.error(f"[{repo_name}] Sync failed: {e}")
                failed_repos += 1

            # Avoid rate limit - wait 10 seconds between repos
            await asyncio.sleep(10)

        logger.info(
            f"Background sync complete: {successful_repos}/{total_repos} successful, "
            f"{failed_repos} failed"
        )

        return {
            "total": total_repos,
            "successful": successful_repos,
            "failed": failed_repos
        }

    except Exception as e:
        logger.error(f"Background sync error: {e}", exc_info=True)
        return {
            "total": total_repos,
            "successful": successful_repos,
            "failed": failed_repos,
            "error": str(e)
        }


async def background_sync_loop(interval_minutes: int = 5):
    """
    Run sync loop continuously at specified interval.

    Args:
        interval_minutes: Minutes between sync cycles (default: 5)
    """
    logger.info(f"Starting background sync loop (every {interval_minutes} minutes)")

    while True:
        try:
            result = await sync_all_repositories()
            logger.info(f"Sync cycle complete: {result}")
        except Exception as e:
            logger.error(f"Background sync loop error: {e}", exc_info=True)

        # Wait for next cycle
        await asyncio.sleep(interval_minutes * 60)


# To enable background sync, add this to main.py startup:
#
# import asyncio
# from services.github.background_sync import background_sync_loop
#
# @app.on_event("startup")
# async def startup_event():
#     # ... existing startup code ...
#
#     # Start background sync (optional)
#     asyncio.create_task(background_sync_loop(interval_minutes=5))
