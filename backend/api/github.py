"""GitHub integration API endpoints."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import os

from utils.database import get_db_connection, get_db_connection_ctx
from services.github.api import GitHubService
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
    limit: Optional[int] = Query(default=50, description="Max issues to import (default: 50)")
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
    limit: Optional[int] = Query(default=50, description="Max PRs to import (default: 50)")
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
