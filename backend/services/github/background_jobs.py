"""
Background job system for progressive GitHub data import.

Implements priority-based fetching:
1. OPEN issues (most important - active work)
2. OPEN PRs (active reviews)
3. CLOSED issues (historical data)
4. CLOSED PRs (completed work)
"""

import asyncio
import time
import logging
from typing import Dict, Optional, Callable
from datetime import datetime, timezone
import psycopg

from services.github.api import GitHubService

logger = logging.getLogger(__name__)

# Maximum number of batches per sync phase (10 batches × 100 items = 1000 items max per phase)
MAX_BATCHES_PER_PHASE = 10


class SyncJobManager:
    """Manages sync job lifecycle and database operations."""

    def __init__(self, db_url: str):
        self.db_url = db_url

    def get_db_connection(self):
        """Get database connection."""
        return psycopg.connect(self.db_url)

    def create_sync_job(self, project_id: str, job_type: str = 'full', priority: str = 'open') -> int:
        """
        Create a new sync job record.

        Args:
            project_id: Project identifier
            job_type: Type of job ('issues', 'prs', or 'full')
            priority: Priority level ('open' or 'closed')

        Returns:
            Job ID
        """
        with self.get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO sync_jobs (
                        project_id, job_type, status, priority, started_at
                    ) VALUES (%s, %s, %s, %s, NOW())
                    RETURNING id
                """, (project_id, job_type, 'queued', priority))
                job_id = cur.fetchone()[0]
                conn.commit()
                return job_id

    def update_job_status(
        self,
        job_id: int,
        status: str,
        error_message: Optional[str] = None,
        completed_at: Optional[datetime] = None,
        rate_limited: Optional[bool] = None,
        rate_limit_reset_time: Optional[datetime] = None
    ):
        """
        Update sync job status.

        Args:
            job_id: Job identifier
            status: New status ('queued', 'in_progress', 'completed', 'failed')
            error_message: Optional error message for failed jobs
            completed_at: Optional completion timestamp
            rate_limited: Optional flag indicating job is waiting for rate limit reset
            rate_limit_reset_time: Optional timestamp when rate limit will reset
        """
        with self.get_db_connection() as conn:
            with conn.cursor() as cur:
                # Build dynamic query based on what's provided
                updates = ["status = %s", "error_message = %s"]
                params = [status, error_message]

                if completed_at:
                    updates.append("completed_at = %s")
                    params.append(completed_at)

                if rate_limited is not None:
                    updates.append("rate_limited = %s")
                    params.append(rate_limited)

                if rate_limit_reset_time is not None:
                    updates.append("rate_limit_reset_time = %s")
                    params.append(rate_limit_reset_time)

                params.append(job_id)

                query = f"""
                    UPDATE sync_jobs
                    SET {', '.join(updates)}
                    WHERE id = %s
                """

                cur.execute(query, tuple(params))
                conn.commit()

    def update_job_progress(
        self,
        job_id: int,
        imported_count: int,
        batch_num: int,
        total_count: Optional[int] = None
    ):
        """
        Update sync job progress.

        Args:
            job_id: Job identifier
            imported_count: Number of items imported
            batch_num: Current batch number
            total_count: Optional total count estimate
        """
        with self.get_db_connection() as conn:
            with conn.cursor() as cur:
                if total_count:
                    cur.execute("""
                        UPDATE sync_jobs
                        SET imported_count = imported_count + %s,
                            current_batch = %s,
                            total_count = %s
                        WHERE id = %s
                    """, (imported_count, batch_num, total_count, job_id))
                else:
                    cur.execute("""
                        UPDATE sync_jobs
                        SET imported_count = imported_count + %s,
                            current_batch = %s
                        WHERE id = %s
                    """, (imported_count, batch_num, job_id))
                conn.commit()

    def get_job_status(self, project_id: str) -> Optional[Dict]:
        """
        Get status of the most recent active sync job for a project.

        Only returns jobs that are 'queued' or 'in_progress'.
        Jobs in 'in_progress' for more than 1 hour are considered timed out.

        Args:
            project_id: Project identifier

        Returns:
            Job status dictionary or None if no active jobs found
        """
        with self.get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, job_type, status, priority, total_count,
                           imported_count, current_batch, started_at,
                           completed_at, error_message, rate_limited,
                           rate_limit_reset_time
                    FROM sync_jobs
                    WHERE project_id = %s
                      AND status NOT IN ('completed', 'failed')
                      AND (status != 'in_progress' OR started_at > NOW() - INTERVAL '1 hour')
                    ORDER BY started_at DESC
                    LIMIT 1
                """, (project_id,))

                row = cur.fetchone()
                if not row:
                    return None

                return {
                    "id": row[0],
                    "job_type": row[1],
                    "status": row[2],
                    "priority": row[3],
                    "total_count": row[4],
                    "imported_count": row[5],
                    "current_batch": row[6],
                    "started_at": row[7].isoformat() if row[7] else None,
                    "completed_at": row[8].isoformat() if row[8] else None,
                    "error_message": row[9],
                    "rate_limited": row[10] if row[10] is not None else False,
                    "rate_limit_reset_time": row[11].isoformat() if row[11] else None
                }

    def cleanup_stuck_jobs(self, timeout_hours: int = 1) -> int:
        """
        Clean up jobs that have been stuck in 'in_progress' for too long.

        Args:
            timeout_hours: Number of hours before a job is considered stuck

        Returns:
            Number of jobs cleaned up
        """
        with self.get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE sync_jobs
                    SET status = 'failed',
                        error_message = %s,
                        completed_at = NOW()
                    WHERE status = 'in_progress'
                      AND started_at < NOW() - INTERVAL '%s hours'
                    RETURNING id, project_id
                """, (
                    f'Job timeout - exceeded {timeout_hours} hour(s)',
                    timeout_hours
                ))

                cleaned = cur.fetchall()
                conn.commit()

                if cleaned:
                    logger.warning(
                        f"Cleaned up {len(cleaned)} stuck jobs: "
                        f"{[row[0] for row in cleaned]}"
                    )

                return len(cleaned)


async def fetch_with_batches(
    github_service: GitHubService,
    job_manager: SyncJobManager,
    project_id: str,
    job_id: int,
    fetch_func: Callable,
    state: str,
    batch_size: int = 100,
    skip_first: int = 0,
    max_batches: int = MAX_BATCHES_PER_PHASE
):
    """
    Fetch data in batches with rate limit protection.

    Args:
        github_service: GitHub service instance
        job_manager: Sync job manager instance
        project_id: Project identifier
        job_id: Job ID for progress tracking
        fetch_func: Function to fetch data (import_issues_by_state or import_prs_by_state)
        state: State filter ('open' or 'closed')
        batch_size: Items per batch
        skip_first: Skip first N items (already fetched)
        max_batches: Maximum number of batches to fetch (default: MAX_BATCHES_PER_PHASE)
    """
    batch_num = 0
    total_imported = 0
    limit_reached = False

    logger.info(f"Starting batch fetch: state={state}, batch_size={batch_size}, skip_first={skip_first}, max_batches={max_batches}")

    while True:
        # Check batch limit
        if batch_num >= max_batches:
            logger.warning(f"Reached maximum batch limit ({max_batches}) for {state} items")
            limit_reached = True
            break
        # Check rate limit before each batch
        rate_check = github_service.check_rate_limit(required_calls=batch_size // 10)

        if not rate_check["sufficient"]:
            remaining = rate_check.get("remaining", 0)
            reset_time = rate_check.get("reset_time", 0)

            if remaining < 100:
                # Critical: very low on rate limit, wait for reset
                wait_time = min(reset_time - time.time(), 3600)
                if wait_time > 0:
                    logger.warning(f"Rate limit critically low ({remaining}). Waiting {wait_time:.1f}s")
                    await asyncio.sleep(wait_time)
            else:
                # Just pause briefly
                logger.warning(f"Rate limit check failed. Pausing 10s")
                await asyncio.sleep(10)

        # Fetch batch
        try:
            result = fetch_func(
                project_id,
                state=state,
                limit=batch_size,
                offset=skip_first + (batch_num * batch_size)
            )

            # Check if rate limited
            if result.get("status") == "rate_limited":
                imported_this_batch = result.get("imported", 0)
                updated_this_batch = result.get("updated", 0)
                total_imported += imported_this_batch + updated_this_batch

                # Update final progress
                if imported_this_batch + updated_this_batch > 0:
                    job_manager.update_job_progress(
                        job_id,
                        imported_count=imported_this_batch + updated_this_batch,
                        batch_num=batch_num
                    )

                reset_time = result.get("reset_time")
                logger.warning(
                    f"⚠️  Rate limit hit during batch {batch_num}. "
                    f"Imported {total_imported} items before stopping. "
                    f"Data has been saved and is available to view. "
                    f"Rate limit resets at: {reset_time}"
                )

                # Return structured data with reset time for rate limit handling
                return {
                    "status": "rate_limited",
                    "total_imported": total_imported,
                    "message": result.get("message"),
                    "reset_time": reset_time
                }

            # Check for other errors
            if result.get("status") == "error":
                logger.error(f"Error in batch {batch_num}: {result.get('message')}")
                # For non-rate-limit errors, try to continue
                batch_num += 1
                await asyncio.sleep(5)
                if batch_num > 100:
                    logger.error("Too many batches processed, stopping")
                    break
                continue

            imported_this_batch = result.get("imported", 0)
            updated_this_batch = result.get("updated", 0)
            fetched_this_batch = result.get("fetched", 0)
            total_imported += imported_this_batch + updated_this_batch

            # Update progress
            job_manager.update_job_progress(
                job_id,
                imported_count=imported_this_batch + updated_this_batch,
                batch_num=batch_num,
                total_count=result.get("total_estimate")
            )

            logger.info(
                f"Batch {batch_num} complete: {imported_this_batch} new, {updated_this_batch} updated, "
                f"{fetched_this_batch} fetched (total: {total_imported})"
            )

            # Check if we've fetched all available items (smart early stopping)
            if result.get("total_estimate") is not None:
                github_total = result.get("total_estimate")
                # Items we already have = min(skip_first, github_total) from initial sync
                # Items needed = github_total - items_already_have
                items_already_fetched = min(skip_first, github_total)
                items_still_needed = max(0, github_total - items_already_fetched)

                if total_imported >= items_still_needed:
                    logger.info(
                        f"✓ All items fetched! {items_already_fetched + total_imported}/{github_total} items total. "
                        f"Stopping early (no need for more batches)."
                    )
                    break

            batch_num += 1

            # Stop if no data changed (everything already synced and up-to-date)
            if imported_this_batch == 0 and updated_this_batch == 0:
                logger.info(f"No changes in batch {batch_num - 1} - all data is up-to-date. Stopping sync.")
                break

            # Stop if GitHub returned fewer items than requested (no more data available)
            if fetched_this_batch < batch_size:
                logger.info(f"Reached end of data (fetched {fetched_this_batch} < {batch_size})")
                break

            # Rate limit protection: 2 second delay between batches
            await asyncio.sleep(2)

        except Exception as e:
            logger.error(f"Unexpected exception in batch {batch_num}: {str(e)}")
            # Continue to next batch on error
            batch_num += 1
            await asyncio.sleep(5)  # Wait a bit longer on error

            # Safety: stop after too many consecutive errors
            if batch_num > 100:  # Arbitrary limit
                logger.error("Too many batches processed, stopping")
                break

    return {
        "status": "completed",
        "total_imported": total_imported,
        "limit_reached": limit_reached
    }


async def background_import_remaining(
    project_id: str,
    job_id: int,
    github_service: GitHubService,
    job_manager: SyncJobManager
):
    """
    Background job: Fetch remaining data in priority order.

    Priority order:
    1. Remaining OPEN issues (batches of 100)
    2. Remaining OPEN PRs (batches of 100)
    3. CLOSED issues (batches of 100)
    4. CLOSED PRs (batches of 100)

    Args:
        project_id: Project identifier
        job_id: Job ID for progress tracking
        github_service: GitHub service instance
        job_manager: Sync job manager instance
    """
    logger.info(f"Starting background import for project {project_id}, job {job_id}")

    # Update job status to in_progress
    job_manager.update_job_status(job_id, 'in_progress')

    try:
        # Priority 1: Remaining OPEN issues (skip first 50 already fetched)
        logger.info("Phase 1: Fetching remaining OPEN issues...")
        result = await fetch_with_batches(
            github_service=github_service,
            job_manager=job_manager,
            project_id=project_id,
            job_id=job_id,
            fetch_func=github_service.import_issues_by_state,
            state='open',
            batch_size=100,
            skip_first=50,
            max_batches=MAX_BATCHES_PER_PHASE
        )

        # Check if rate limited
        if isinstance(result, dict) and result.get("status") == "rate_limited":
            reset_time_str = result.get("reset_time")
            reset_time = None
            if reset_time_str:
                # Convert timestamp to datetime
                reset_time = datetime.fromtimestamp(float(reset_time_str), tz=timezone.utc)

            logger.info(
                f"⚠️  Rate limited in Phase 1. Marking job as rate_limited. "
                f"Partial data ({result.get('total_imported', 0)} items) has been saved."
            )

            # Mark job as completed with rate limit info
            job_manager.update_job_status(
                job_id,
                'completed',
                error_message=f"Rate limited. {result.get('total_imported', 0)} items imported. Add GitHub token for higher limits.",
                rate_limited=True,
                rate_limit_reset_time=reset_time,
                completed_at=datetime.now(timezone.utc)
            )
            return

        # Priority 2: Remaining OPEN PRs (skip first 50 already fetched)
        logger.info("Phase 2: Fetching remaining OPEN PRs...")
        result = await fetch_with_batches(
            github_service=github_service,
            job_manager=job_manager,
            project_id=project_id,
            job_id=job_id,
            fetch_func=github_service.import_prs_by_state,
            state='open',
            batch_size=100,
            skip_first=50,
            max_batches=MAX_BATCHES_PER_PHASE
        )

        # Check if rate limited
        if isinstance(result, dict) and result.get("status") == "rate_limited":
            reset_time_str = result.get("reset_time")
            reset_time = None
            if reset_time_str:
                from datetime import datetime
                reset_time = datetime.fromtimestamp(float(reset_time_str), tz=timezone.utc)

            logger.info(
                f"⚠️  Rate limited in Phase 2. Marking job as rate_limited. "
                f"Partial data ({result.get('total_imported', 0)} items) has been saved."
            )

            job_manager.update_job_status(
                job_id,
                'completed',
                error_message=f"Rate limited. {result.get('total_imported', 0)} items imported. Add GitHub token for higher limits.",
                rate_limited=True,
                rate_limit_reset_time=reset_time,
                completed_at=datetime.now(timezone.utc)
            )
            return

        # Skip phases 3-4 (closed items) - only sync open items by default
        logger.info("Skipping closed items sync (only syncing open items)")

        # Mark job as completed
        job_manager.update_job_status(
            job_id,
            'completed',
            completed_at=datetime.now(timezone.utc),
            rate_limited=False
        )

        logger.info(f"Background import completed successfully for project {project_id}")
        return

        # The following phases are disabled by default to improve sync performance
        # and reduce API usage. To re-enable, remove the early return above.
        #
        # Priority 3: CLOSED issues
        logger.info("Phase 3: Fetching CLOSED issues...")
        result = await fetch_with_batches(
            github_service=github_service,
            job_manager=job_manager,
            project_id=project_id,
            job_id=job_id,
            fetch_func=github_service.import_issues_by_state,
            state='closed',
            batch_size=100,
            skip_first=0
        )

        # Check if rate limited
        if isinstance(result, dict) and result.get("status") == "rate_limited":
            reset_time_str = result.get("reset_time")
            reset_time = None
            if reset_time_str:
                from datetime import datetime
                reset_time = datetime.fromtimestamp(float(reset_time_str), tz=timezone.utc)

            logger.info(
                f"⚠️  Rate limited in Phase 3. Marking job as rate_limited. "
                f"Partial data ({result.get('total_imported', 0)} items) has been saved."
            )

            job_manager.update_job_status(
                job_id,
                'completed',
                error_message=f"Rate limited. {result.get('total_imported', 0)} items imported. Add GitHub token for higher limits.",
                rate_limited=True,
                rate_limit_reset_time=reset_time,
                completed_at=datetime.now(timezone.utc)
            )
            return

        # Priority 4: CLOSED PRs
        logger.info("Phase 4: Fetching CLOSED PRs...")
        result = await fetch_with_batches(
            github_service=github_service,
            job_manager=job_manager,
            project_id=project_id,
            job_id=job_id,
            fetch_func=github_service.import_prs_by_state,
            state='closed',
            batch_size=100,
            skip_first=0
        )

        # Check if rate limited
        if isinstance(result, dict) and result.get("status") == "rate_limited":
            reset_time_str = result.get("reset_time")
            reset_time = None
            if reset_time_str:
                from datetime import datetime
                reset_time = datetime.fromtimestamp(float(reset_time_str), tz=timezone.utc)

            logger.info(
                f"⚠️  Rate limited in Phase 4. Marking job as rate_limited. "
                f"Partial data ({result.get('total_imported', 0)} items) has been saved."
            )

            job_manager.update_job_status(
                job_id,
                'completed',
                error_message=f"Rate limited. {result.get('total_imported', 0)} items imported. Add GitHub token for higher limits.",
                rate_limited=True,
                rate_limit_reset_time=reset_time,
                completed_at=datetime.now(timezone.utc)
            )
            return

        # Mark job as completed (all phases succeeded without rate limit)
        job_manager.update_job_status(
            job_id,
            'completed',
            completed_at=datetime.now(timezone.utc),
            rate_limited=False
        )

        logger.info(f"Background import completed successfully for project {project_id}")

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Background import failed for project {project_id}: {error_msg}")

        # Mark job as failed
        job_manager.update_job_status(
            job_id,
            'failed',
            error_message=error_msg,
            completed_at=datetime.now(timezone.utc)
        )
