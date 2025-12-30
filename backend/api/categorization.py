"""AI-powered issue categorization API endpoints."""

from fastapi import APIRouter, BackgroundTasks, HTTPException
from typing import Optional

from utils.database import get_db_connection
from services.ai.categorization import IssueCategorizationService

router = APIRouter(prefix="/api", tags=["categorization"])

# Initialize categorization service
categorization_service = IssueCategorizationService()


@router.post("/categorize-issues/{project_id}")
async def categorize_issues(project_id: str, background_tasks: BackgroundTasks):
    """
    Categorize all issues in a project using AI and semantic search.
    Runs in background.
    """
    try:
        # Check if project exists
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT repo_name, status FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        result = cur.fetchone()
        cur.close()
        conn.close()

        if not result:
            raise HTTPException(status_code=404, detail="Project not found")

        repo_name, status = result

        if status != "indexed":
            raise HTTPException(
                status_code=400,
                detail="Project must be indexed before categorizing issues"
            )

        # Run categorization in background
        background_tasks.add_task(
            categorization_service.categorize_all_issues,
            project_id
        )

        return {
            "status": "started",
            "message": f"Started categorizing issues for {repo_name}",
            "project_id": project_id
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start categorization: {str(e)}"
        )


@router.get("/categorized-issues/{project_id}")
async def get_categorized_issues(project_id: str, category: Optional[str] = None):
    """
    Get categorized issues for a project.
    Optional category filter: duplicate, implemented, fixed_in_pr, theme_cluster
    """
    try:
        issues = categorization_service.get_categorized_issues(project_id, category)

        return {
            "project_id": project_id,
            "category_filter": category,
            "count": len(issues),
            "issues": issues
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get categorized issues: {str(e)}"
        )


@router.post("/categorize-single-issue/{project_id}/{issue_number}")
async def categorize_single_issue(project_id: str, issue_number: int):
    """
    Categorize a single issue with full transparency.
    Returns categories, reasoning, and search results.
    """
    try:
        result = categorization_service.categorize_issue(project_id, issue_number)

        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to categorize issue: {str(e)}"
        )


@router.post("/generate-comment/{project_id}/{issue_number}")
async def generate_comment(project_id: str, issue_number: int, category: str):
    """
    Generate a GitHub comment for an issue based on its category.
    """
    try:
        comment = categorization_service.generate_comment(
            project_id, issue_number, category
        )

        return {
            "issue_number": issue_number,
            "category": category,
            "comment": comment
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate comment: {str(e)}"
        )


@router.get("/category-stats/{project_id}")
async def get_category_stats(project_id: str):
    """
    Get statistics about categorized issues in a project.
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Count issues by category
        cur.execute("""
            SELECT category, COUNT(DISTINCT issue_number) as count
            FROM issue_categories
            WHERE project_id = %s
            GROUP BY category
            ORDER BY count DESC
        """, (project_id,))

        stats = {}
        for row in cur.fetchall():
            stats[row[0]] = row[1]

        # Get total issues
        cur.execute("""
            SELECT COUNT(*) FROM github_issues WHERE project_id = %s
        """, (project_id,))
        total_issues = cur.fetchone()[0]

        # Get categorized count
        cur.execute("""
            SELECT COUNT(DISTINCT issue_number) FROM issue_categories
            WHERE project_id = %s
        """, (project_id,))
        categorized_issues = cur.fetchone()[0]

        cur.close()
        conn.close()

        return {
            "project_id": project_id,
            "total_issues": total_issues,
            "categorized_issues": categorized_issues,
            "uncategorized_issues": total_issues - categorized_issues,
            "by_category": stats
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get category stats: {str(e)}"
        )
