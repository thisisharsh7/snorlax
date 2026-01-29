"""Triage API endpoints for GitHub Issue Triage Assistant."""

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from typing import List, Dict, Optional, Any
import logging
from slowapi import Limiter
from slowapi.util import get_remote_address

from utils.database import get_db_connection
from services.ai.categorization import IssueCategorizationService

# Initialize rate limiter for this router
limiter = Limiter(key_func=get_remote_address)

# Setup logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/triage", tags=["triage"])

# Initialize categorization service
categorization_service = IssueCategorizationService()

# In-memory batch triage status tracking
# Format: { project_id: { status, total, processed, current_issue, errors, start_time } }
batch_triage_status: Dict[str, Dict[str, Any]] = {}


def batch_triage_issues_task(project_id: str):
    """
    Background task to triage all uncategorized issues.

    Args:
        project_id: Project identifier
    """
    from datetime import datetime

    try:
        logger.info(f"[{project_id}] Starting batch triage")

        conn = get_db_connection()
        cur = conn.cursor()

        # Get all open issues without triage categories
        cur.execute("""
            SELECT DISTINCT gi.issue_number
            FROM github_issues gi
            LEFT JOIN issue_categories ic
                ON gi.project_id = ic.project_id
                AND gi.issue_number = ic.issue_number
                AND ic.category IN ('critical', 'bug', 'feature_request', 'question', 'low_priority')
            WHERE gi.project_id = %s
              AND gi.state = 'open'
              AND ic.issue_number IS NULL
            ORDER BY gi.issue_number
        """, (project_id,))

        issue_numbers = [row[0] for row in cur.fetchall()]
        cur.close()
        conn.close()

        logger.info(f"[{project_id}] Found {len(issue_numbers)} issues to triage")

        # Initialize status tracking
        batch_triage_status[project_id] = {
            "status": "running",
            "total": len(issue_numbers),
            "processed": 0,
            "current_issue": None,
            "errors": [],
            "start_time": datetime.now().isoformat()
        }

        # Triage each issue
        for i, issue_number in enumerate(issue_numbers, 1):
            try:
                # Update current issue in status
                batch_triage_status[project_id]["current_issue"] = issue_number

                logger.info(f"[{project_id}] Triaging issue #{issue_number} ({i}/{len(issue_numbers)})")
                categorization_service.triage_issue(project_id, issue_number)

                # Update processed count
                batch_triage_status[project_id]["processed"] = i

            except Exception as e:
                logger.error(f"[{project_id}] Failed to triage issue #{issue_number}: {e}")
                batch_triage_status[project_id]["errors"].append({
                    "issue_number": issue_number,
                    "error": str(e)
                })

        logger.info(f"[{project_id}] Batch triage complete")

        # Mark as completed
        batch_triage_status[project_id]["status"] = "completed"
        batch_triage_status[project_id]["current_issue"] = None

    except Exception as e:
        logger.error(f"[{project_id}] Batch triage failed: {e}")

        # Mark as failed
        if project_id in batch_triage_status:
            batch_triage_status[project_id]["status"] = "failed"
            batch_triage_status[project_id]["errors"].append({
                "error": f"Batch triage failed: {str(e)}"
            })
        else:
            batch_triage_status[project_id] = {
                "status": "failed",
                "total": 0,
                "processed": 0,
                "current_issue": None,
                "errors": [{"error": f"Batch triage failed: {str(e)}"}],
                "start_time": datetime.now().isoformat()
            }


@router.get("/dashboard/{project_id}")
async def get_triage_dashboard(project_id: str):
    """
    Get triage dashboard with categorized issues.

    Args:
        project_id: Project identifier

    Returns:
        Dashboard data with categorized issues and counts
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Get categorized issues grouped by category
        cur.execute("""
            SELECT
                ic.category,
                ic.issue_number,
                gi.title,
                ic.confidence,
                ic.priority_score
            FROM issue_categories ic
            JOIN github_issues gi
                ON ic.project_id = gi.project_id
                AND ic.issue_number = gi.issue_number
            WHERE ic.project_id = %s
              AND gi.state = 'open'
              AND ic.category IN ('critical', 'bug', 'feature_request', 'question', 'low_priority')
            ORDER BY ic.priority_score DESC, ic.confidence DESC
        """, (project_id,))

        rows = cur.fetchall()

        # Group by category
        categories = {
            "critical": [],
            "bugs": [],
            "feature_requests": [],
            "questions": [],
            "low_priority": []
        }

        for row in rows:
            category, issue_number, title, confidence, priority_score = row

            issue_data = {
                "issue_number": issue_number,
                "title": title,
                "confidence": confidence,
                "priority_score": priority_score
            }

            if category == "critical":
                categories["critical"].append(issue_data)
            elif category == "bug":
                categories["bugs"].append(issue_data)
            elif category == "feature_request":
                categories["feature_requests"].append(issue_data)
            elif category == "question":
                categories["questions"].append(issue_data)
            elif category == "low_priority":
                categories["low_priority"].append(issue_data)

        # Get count of uncategorized issues
        cur.execute("""
            SELECT COUNT(DISTINCT gi.issue_number)
            FROM github_issues gi
            LEFT JOIN issue_categories ic
                ON gi.project_id = ic.project_id
                AND gi.issue_number = ic.issue_number
                AND ic.category IN ('critical', 'bug', 'feature_request', 'question', 'low_priority')
            WHERE gi.project_id = %s
              AND gi.state = 'open'
              AND ic.issue_number IS NULL
        """, (project_id,))

        needs_triage_count = cur.fetchone()[0]

        # Get today's count (issues triaged today)
        cur.execute("""
            SELECT COUNT(DISTINCT issue_number)
            FROM issue_categories
            WHERE project_id = %s
              AND category IN ('critical', 'bug', 'feature_request', 'question', 'low_priority')
              AND created_at >= CURRENT_DATE
        """, (project_id,))

        today_count = cur.fetchone()[0]

        cur.close()
        conn.close()

        return {
            "today_count": today_count,
            "needs_triage_count": needs_triage_count,
            "categories": categories
        }

    except Exception as e:
        logger.error(f"Failed to get dashboard for {project_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get dashboard: {str(e)}"
        )


@router.get("/issues/{project_id}/uncategorized")
async def get_uncategorized_issues(project_id: str):
    """
    Get all open issues that haven't been triaged yet.

    Args:
        project_id: Project identifier

    Returns:
        List of uncategorized issues
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT DISTINCT
                gi.issue_number,
                gi.title,
                gi.body,
                gi.state,
                gi.created_at
            FROM github_issues gi
            LEFT JOIN issue_categories ic
                ON gi.project_id = ic.project_id
                AND gi.issue_number = ic.issue_number
                AND ic.category IN ('critical', 'bug', 'feature_request', 'question', 'low_priority')
            WHERE gi.project_id = %s
              AND gi.state = 'open'
              AND ic.issue_number IS NULL
            ORDER BY gi.issue_number
        """, (project_id,))

        rows = cur.fetchall()
        cur.close()
        conn.close()

        return [
            {
                "issue_number": row[0],
                "title": row[1],
                "body": row[2],
                "state": row[3],
                "created_at": str(row[4])
            }
            for row in rows
        ]

    except Exception as e:
        logger.error(f"Failed to get uncategorized issues for {project_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get uncategorized issues: {str(e)}"
        )


@router.post("/analyze/{project_id}/{issue_number}")
@limiter.limit("30/minute")  # Limit AI API calls to 30 per minute per IP
async def analyze_issue_for_triage(request: Request, project_id: str, issue_number: int):
    """
    Run full AI analysis on a single issue for triage mode.

    This endpoint performs comprehensive triage including:
    - Primary categorization
    - Duplicate detection
    - Related PR identification
    - Documentation linking
    - Suggested response generation

    Args:
        project_id: Project identifier
        issue_number: Issue number

    Returns:
        Triage analysis results
    """
    try:
        logger.info(f"[{project_id}] Analyzing issue #{issue_number} for triage")

        result = categorization_service.triage_issue(project_id, issue_number)

        if "error" in result:
            raise HTTPException(
                status_code=500,
                detail=result["error"]
            )

        return result

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        logger.error(f"Failed to analyze issue #{issue_number}: {e}\n{error_trace}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to analyze issue: {str(e)}"
        )


@router.post("/batch-triage/{project_id}")
@limiter.limit("5/minute")  # Very restrictive - batch operations are expensive
async def batch_triage_issues(request: Request, project_id: str, background_tasks: BackgroundTasks):
    """
    Triage all uncategorized issues in the background.

    This is useful for:
    - Initial setup after importing issues
    - Bulk re-triaging after changes
    - Catching up on untriaged issues

    Args:
        project_id: Project identifier
        background_tasks: FastAPI background tasks

    Returns:
        Status message
    """
    try:
        # Check if repository exists
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute(
            "SELECT status FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        result = cur.fetchone()

        if not result:
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Repository not found")

        # Get count of uncategorized issues
        cur.execute("""
            SELECT COUNT(DISTINCT gi.issue_number)
            FROM github_issues gi
            LEFT JOIN issue_categories ic
                ON gi.project_id = ic.project_id
                AND gi.issue_number = ic.issue_number
                AND ic.category IN ('critical', 'bug', 'feature_request', 'question', 'low_priority')
            WHERE gi.project_id = %s
              AND gi.state = 'open'
              AND ic.issue_number IS NULL
        """, (project_id,))

        count = cur.fetchone()[0]
        cur.close()
        conn.close()

        if count == 0:
            return {
                "status": "success",
                "message": "All issues are already triaged"
            }

        # Start batch triage in background
        background_tasks.add_task(batch_triage_issues_task, project_id)

        return {
            "status": "success",
            "message": f"Batch triage started for {count} issues. This may take several minutes.",
            "issues_to_triage": count
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start batch triage for {project_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start batch triage: {str(e)}"
        )


@router.get("/batch-status/{project_id}")
async def get_batch_triage_status(project_id: str):
    """
    Get the current status of batch triage operation for a project.

    Args:
        project_id: Project identifier

    Returns:
        Status information including:
        - status: 'not_started' | 'running' | 'completed' | 'failed'
        - total: Total number of issues to triage
        - processed: Number of issues processed so far
        - current_issue: Issue number currently being processed (null if not running)
        - errors: List of errors encountered during triage
        - start_time: ISO timestamp when batch started
    """
    if project_id not in batch_triage_status:
        return {
            "status": "not_started",
            "total": 0,
            "processed": 0,
            "current_issue": None,
            "errors": [],
            "start_time": None
        }

    return batch_triage_status[project_id]


@router.get("/issue/{project_id}/{issue_number}")
async def get_triage_analysis(project_id: str, issue_number: int):
    """
    Get existing triage analysis for an issue.

    Args:
        project_id: Project identifier
        issue_number: Issue number

    Returns:
        Triage analysis if exists, otherwise 404
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                ic.category,
                ic.confidence,
                ic.reasoning,
                ic.related_issues,
                ic.related_prs,
                ic.priority_score,
                ic.needs_response,
                ic.doc_links,
                gi.title,
                gi.body
            FROM issue_categories ic
            JOIN github_issues gi
                ON ic.project_id = gi.project_id
                AND ic.issue_number = gi.issue_number
            WHERE ic.project_id = %s
              AND ic.issue_number = %s
              AND ic.category IN ('critical', 'bug', 'feature_request', 'question', 'low_priority')
        """, (project_id, issue_number))

        result = cur.fetchone()
        cur.close()
        conn.close()

        if not result:
            raise HTTPException(
                status_code=404,
                detail="No triage analysis found for this issue"
            )

        return {
            "issue_number": issue_number,
            "title": result[8],
            "body": result[9],
            "primary_category": result[0],
            "confidence": result[1],
            "reasoning": result[2],
            "duplicate_of": result[3][0] if result[3] and len(result[3]) > 0 else None,
            "related_prs": result[4] or [],
            "priority_score": result[5],
            "needs_response": result[6],
            "doc_links": [{"file": doc} for doc in (result[7] or [])]
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get triage analysis for issue #{issue_number}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get triage analysis: {str(e)}"
        )
