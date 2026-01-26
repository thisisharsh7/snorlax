"""GitHub integration API endpoints."""

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
import os

from utils.database import get_db_connection, get_db_connection_ctx
from services.github.api import GitHubService
from services.github.background_jobs import SyncJobManager, background_import_remaining
from github import Github, GithubException, RateLimitExceededException

router = APIRouter(prefix="/api/github", tags=["github"])


class ValidateTokenRequest(BaseModel):
    """Request model for token validation."""
    token: str


def get_github_service() -> GitHubService:
    """
    Get GitHub service with current token from environment/database.

    This function ensures the token is loaded from the database settings
    which are loaded at startup by load_settings_from_db().
    """
    token = os.getenv("GITHUB_TOKEN")
    return GitHubService(github_token=token)


@router.post("/validate-token")
async def validate_github_token(request: ValidateTokenRequest):
    """
    Validate a GitHub token.

    Args:
        request: Request body containing the token to validate

    Returns:
        Token validation status with rate limit info
    """
    try:
        token = request.token.strip() if request.token else ""

        if not token:
            return {
                "valid": False,
                "error": "No GitHub token provided",
                "type": "missing_token"
            }

        # Try to authenticate with the token
        github = Github(token)

        try:
            user = github.get_user()
            login = user.login  # This will fail if token is invalid

            # Get rate limit info
            rate_limit = github.get_rate_limit()
            core_limit = rate_limit.resources.core

            return {
                "valid": True,
                "username": login,
                "rate_limit": core_limit.limit,
                "remaining": core_limit.remaining,
                "reset_time": core_limit.reset.timestamp() if core_limit.reset else None
            }

        except GithubException as e:
            if e.status == 401:
                return {
                    "valid": False,
                    "error": "GitHub token is invalid or expired",
                    "type": "invalid_token"
                }
            elif e.status == 403:
                return {
                    "valid": False,
                    "error": "GitHub token has insufficient permissions",
                    "type": "insufficient_permissions"
                }
            else:
                return {
                    "valid": False,
                    "error": f"GitHub API error: {str(e)}",
                    "type": "api_error"
                }

    except Exception as e:
        return {
            "valid": False,
            "error": f"Validation failed: {str(e)}",
            "type": "unknown_error"
        }


@router.post("/import-issues/{project_id}")
async def import_github_issues(
    project_id: str,
    limit: Optional[int] = Query(default=500, description="Max NEW issues to import per sync (default: 500)")
):
    """
    Import GitHub issues for a project.

    Args:
        project_id: Project identifier
        limit: Optional limit on number of issues to import (for testing)

    Returns:
        Import statistics
    """
    try:
        # Get repository URL from database
        with get_db_connection_ctx() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT repo_url FROM repositories WHERE project_id = %s",
                (project_id,)
            )
            result = cur.fetchone()
            cur.close()

        if not result:
            raise HTTPException(status_code=404, detail="Project not found")

        repo_url = result[0]

        # Get GitHub service with current token
        github_service = get_github_service()

        # Import issues
        result = github_service.import_issues(project_id, repo_url, limit)

        if result["status"] == "rate_limited":
            raise HTTPException(
                status_code=429,
                detail={
                    "message": result["message"],
                    "reset_time": result.get("reset_time"),
                    "type": "rate_limit"
                }
            )
        elif result["status"] == "error":
            raise HTTPException(
                status_code=500,
                detail={
                    "message": result["message"],
                    "error_code": result.get("error_code"),
                    "type": "github_error"
                }
            )

        # Update last_synced_at timestamp
        with get_db_connection_ctx() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE repositories SET last_synced_at = NOW() WHERE project_id = %s",
                (project_id,)
            )
            conn.commit()
            cur.close()

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to import issues: {str(e)}"
        )


@router.post("/import-prs/{project_id}")
async def import_github_prs(
    project_id: str,
    limit: Optional[int] = Query(default=500, description="Max NEW PRs to import per sync (default: 500)")
):
    """
    Import GitHub pull requests for a project.

    Args:
        project_id: Project identifier
        limit: Optional limit on number of PRs to import (for testing)

    Returns:
        Import statistics
    """
    try:
        # Get repository URL from database
        with get_db_connection_ctx() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT repo_url FROM repositories WHERE project_id = %s",
                (project_id,)
            )
            result = cur.fetchone()
            cur.close()

        if not result:
            raise HTTPException(status_code=404, detail="Project not found")

        repo_url = result[0]

        # Get GitHub service with current token
        github_service = get_github_service()

        # Import PRs
        result = github_service.import_pull_requests(project_id, repo_url, limit)

        if result["status"] == "rate_limited":
            raise HTTPException(
                status_code=429,
                detail={
                    "message": result["message"],
                    "reset_time": result.get("reset_time"),
                    "type": "rate_limit"
                }
            )
        elif result["status"] == "error":
            # Don't throw 500 error - return partial success with warning
            # This allows the import to complete even if some PRs failed
            result["status"] = "partial_success"
            result["warning"] = result.get("message", "Some PRs failed to import")
            # Continue to update timestamp and return result below

        # Update last_synced_at timestamp
        with get_db_connection_ctx() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE repositories SET last_synced_at = NOW() WHERE project_id = %s",
                (project_id,)
            )
            conn.commit()
            cur.close()

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to import PRs: {str(e)}"
        )


@router.get("/issues/{project_id}")
async def get_github_issues(project_id: str, state: Optional[str] = None):
    """
    Get GitHub issues for a project.

    Args:
        project_id: Project identifier
        state: Optional filter by state ('open', 'closed', or None for all)

    Returns:
        List of issues
    """
    try:
        # Get GitHub service with current token
        github_service = get_github_service()

        issues = github_service.get_issues_for_project(project_id, state)
        return {"issues": issues, "count": len(issues)}

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get issues: {str(e)}"
        )


@router.get("/prs/{project_id}")
async def get_github_prs(project_id: str, state: Optional[str] = None):
    """
    Get GitHub pull requests for a project.

    Args:
        project_id: Project identifier
        state: Optional filter by state ('open', 'closed', 'merged', or None for all)

    Returns:
        List of pull requests
    """
    try:
        # Get GitHub service with current token
        github_service = get_github_service()

        prs = github_service.get_pull_requests_for_project(project_id, state)
        return {"pull_requests": prs, "count": len(prs)}

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get PRs: {str(e)}"
        )


class PostCommentRequest(BaseModel):
    """Request model for posting a comment."""
    comment_body: str


@router.post("/post-comment/{project_id}/{issue_number}")
async def post_issue_comment(project_id: str, issue_number: int, request: PostCommentRequest):
    """
    Post a comment on a GitHub issue.

    Args:
        project_id: Repository identifier (owner/repo)
        issue_number: Issue number
        request: Request body containing comment text

    Returns:
        Comment information including URL and ID

    Raises:
        HTTPException: If GitHub token not configured or posting fails
    """
    try:
        # Get GitHub service with current token
        github_service = get_github_service()

        # Post comment
        result = github_service.post_issue_comment(
            project_id=project_id,
            issue_number=issue_number,
            comment_body=request.comment_body
        )

        return result

    except ValueError as e:
        # Token not configured
        raise HTTPException(
            status_code=401,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to post comment: {str(e)}"
        )


@router.post("/import-initial/{project_id}")
async def import_initial_batch(
    project_id: str,
    background_tasks: BackgroundTasks
):
    """
    Fast initial import: First 50 OPEN issues + 50 OPEN PRs.
    Returns immediately, triggers background job for remaining data.

    Args:
        project_id: Project identifier
        background_tasks: FastAPI background tasks

    Returns:
        Initial import results and background job ID
    """
    try:
        # Get repository URL from database
        with get_db_connection_ctx() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT repo_url FROM repositories WHERE project_id = %s",
                (project_id,)
            )
            result = cur.fetchone()
            cur.close()

        if not result:
            raise HTTPException(status_code=404, detail="Project not found")

        # Initialize job manager
        db_url = os.getenv("APP_DATABASE_URL")
        job_manager = SyncJobManager(db_url)

        # Check if there's already an active sync job for this project
        existing_job = job_manager.get_job_status(project_id)

        if existing_job:
            # Job already exists and is active (queued or in_progress)
            return {
                "status": "already_syncing",
                "job_id": existing_job["id"],
                "message": "Sync already in progress for this project",
                "imported_count": existing_job.get("imported_count", 0),
                "total_count": existing_job.get("total_count", 0)
            }

        # Get GitHub service with current token
        github_service = get_github_service()

        # Fetch first batch synchronously (fast - 50 open issues + 50 open PRs)
        issues_result = github_service.import_issues_by_state(
            project_id, state='open', limit=50, offset=0
        )

        prs_result = github_service.import_prs_by_state(
            project_id, state='open', limit=50, offset=0
        )

        # Create background job record (only if no existing job)
        job_id = job_manager.create_sync_job(project_id, job_type='full', priority='open')

        # Trigger background fetch for remaining data
        background_tasks.add_task(
            background_import_remaining,
            project_id=project_id,
            job_id=job_id,
            github_service=github_service,
            job_manager=job_manager
        )

        # Update last_synced_at timestamp
        with get_db_connection_ctx() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE repositories SET last_synced_at = NOW() WHERE project_id = %s",
                (project_id,)
            )
            conn.commit()
            cur.close()

        return {
            "status": "initial_complete",
            "job_id": job_id,
            "issues": {
                "imported": issues_result.get("imported", 0),
                "updated": issues_result.get("updated", 0)
            },
            "prs": {
                "imported": prs_result.get("imported", 0),
                "updated": prs_result.get("updated", 0)
            },
            "background_job_started": True
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to import initial batch: {str(e)}"
        )


@router.get("/sync-status/{project_id}")
async def get_sync_status(project_id: str):
    """
    Get sync job status for a project.

    Automatically cleans up stuck jobs (in progress for > 1 hour) before checking status.

    Args:
        project_id: Project identifier

    Returns:
        Job status information including rate limit details
    """
    try:
        db_url = os.getenv("APP_DATABASE_URL")
        job_manager = SyncJobManager(db_url)

        # Clean up any stuck jobs before checking status
        job_manager.cleanup_stuck_jobs(timeout_hours=1)

        status = job_manager.get_job_status(project_id)

        if not status:
            return {
                "status": "no_jobs",
                "message": "No sync jobs found for this project"
            }

        # Add rate limit messaging if applicable
        if status.get("rate_limited"):
            reset_time = status.get("rate_limit_reset_time")
            imported_count = status.get("imported_count", 0)

            # Format user-friendly message
            if reset_time:
                status["message"] = (
                    f"GitHub rate limit exceeded. Already imported {imported_count} items. "
                    f"Rate limit resets at {reset_time}. "
                    f"Add a GitHub token in Settings for 5,000 calls/hour (vs 60/hour without token)."
                )
            else:
                status["message"] = (
                    f"GitHub rate limit exceeded. Already imported {imported_count} items. "
                    f"Add a GitHub token in Settings for 5,000 calls/hour (vs 60/hour without token)."
                )

        return status

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get sync status: {str(e)}"
        )
