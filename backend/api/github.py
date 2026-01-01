"""GitHub integration API endpoints."""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from utils.database import get_db_connection
from services.github.api import GitHubService

router = APIRouter(prefix="/api/github", tags=["github"])

# Initialize GitHub service
github_service = GitHubService()


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
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT repo_url FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        result = cur.fetchone()
        cur.close()
        conn.close()

        if not result:
            raise HTTPException(status_code=404, detail="Project not found")

        repo_url = result[0]

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
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "UPDATE repositories SET last_synced_at = NOW() WHERE project_id = %s",
            (project_id,)
        )
        conn.commit()
        cur.close()
        conn.close()

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
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT repo_url FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        result = cur.fetchone()
        cur.close()
        conn.close()

        if not result:
            raise HTTPException(status_code=404, detail="Project not found")

        repo_url = result[0]

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
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "UPDATE repositories SET last_synced_at = NOW() WHERE project_id = %s",
            (project_id,)
        )
        conn.commit()
        cur.close()
        conn.close()

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
        prs = github_service.get_pull_requests_for_project(project_id, state)
        return {"pull_requests": prs, "count": len(prs)}

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get PRs: {str(e)}"
        )
