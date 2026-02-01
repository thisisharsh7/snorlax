"""Triage API endpoints for GitHub Issue Triage Assistant."""

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from typing import List, Dict, Optional, Any
import logging
from slowapi import Limiter
from slowapi.util import get_remote_address
from datetime import date

from utils.database import get_db_connection
from services.ai.categorization import IssueCategorizationService
from services.ai.triage_optimizer import TriageOptimizer

# Initialize rate limiter for this router
limiter = Limiter(key_func=get_remote_address)

# Setup logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/triage", tags=["triage"])

# Initialize categorization service
categorization_service = IssueCategorizationService()

# Initialize optimizer (cost-optimized triage)
triage_optimizer = TriageOptimizer(
    db_pool=categorization_service.db_pool,
    claude_client=categorization_service.claude_client
)

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
    Run optimized AI analysis on a single issue for triage mode.

    This endpoint uses a 3-tier cost-optimization system:
    - Tier 1: Smart rules (70% of issues, $0 cost) - Auto-close duplicates, answer from docs
    - Tier 2: Cache hits (20% of issues, $0 cost) - Return cached responses
    - Tier 3: Claude AI (10% of issues, 90% cheaper) - Use AI with prompt caching

    Cost reduction: 99% (from $0.03 to $0.003 per issue)

    Args:
        project_id: Project identifier
        issue_number: Issue number

    Returns:
        Optimized triage analysis with single decision and draft response
    """
    try:
        logger.info(f"[{project_id}] Analyzing issue #{issue_number} with optimized triage")

        # Step 1: Generate embedding and get issue details
        categorization_service.embedding_service.generate_issue_embedding(project_id, issue_number)

        # Get issue details
        issue = categorization_service._get_issue_details(project_id, issue_number)
        if not issue:
            raise HTTPException(status_code=404, detail="Issue not found")

        issue['project_id'] = project_id

        # Step 2: Run similarity searches (free/cheap)
        logger.info(f"[{project_id}] Running similarity searches...")

        similar_issues = categorization_service.embedding_service.search_similar_issues(
            project_id, issue_number,
            limit=10,
            min_similarity=0.60
        )

        similar_prs = categorization_service.embedding_service.search_similar_prs(
            project_id, issue_number,
            limit=10,
            min_similarity=0.60
        )

        code_matches = categorization_service.embedding_service.search_in_codebase(
            project_id, issue_number,
            limit=10,
            min_similarity=0.60
        )

        doc_links = categorization_service._find_relevant_docs(project_id, issue_number)

        # Step 3: Try smart rules first (TIER 1 - FREE)
        logger.info(f"[{project_id}] Checking smart rules...")
        rule_result = triage_optimizer.apply_smart_rules(
            issue, similar_issues, code_matches, doc_links
        )

        if rule_result:
            logger.info(f"[{project_id}] ✅ Handled by rule: {rule_result.get('rule_matched')}")

            # Transform result to include backwards-compatible fields
            rule_result = _transform_analysis_result(rule_result)

            # Track cost savings
            _track_cost_savings(
                project_id=project_id,
                cost_saved=rule_result.get('cost_saved', 0.02),
                cache_hit=False,
                rule_matched=rule_result.get('rule_matched')
            )

            return rule_result

        # Step 4: Search internet (FREE with caching)
        logger.info(f"[{project_id}] Searching internet...")

        stackoverflow_results = triage_optimizer.search_stackoverflow(issue)
        github_results = triage_optimizer.search_github_issues(issue)

        # Step 5: Use Claude AI with caching (TIER 3 - CHEAP)
        logger.info(f"[{project_id}] Using Claude AI with caching...")

        context = {
            'similar_issues': similar_issues[:3],  # Only top 3
            'similar_prs': similar_prs[:3],
            'code_matches': code_matches[:3],
            'doc_links': doc_links[:3],
            'stackoverflow': stackoverflow_results,
            'github_issues': github_results
        }

        result = triage_optimizer.analyze_with_claude_optimized(issue, context)

        # Transform result to include backwards-compatible fields
        result = _transform_analysis_result(result)

        # Track API costs
        if result.get('api_cost'):
            _track_cost_savings(
                project_id=project_id,
                claude_cost=result['api_cost'].get('total_cost_usd', 0),
                cache_hit=result.get('from_cache', False),
                cached_tokens=result['api_cost'].get('cached_tokens', 0)
            )

        logger.info(f"[{project_id}] ✅ Analysis complete. Cost: ${result.get('api_cost', {}).get('total_cost_usd', 0):.4f}")

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


def _transform_analysis_result(result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform optimized triage result to include legacy fields.

    Adds backwards-compatible fields so frontend works with both formats:
    - Maps decision -> primary_category
    - Generates confidence score based on decision type
    - Maps primary_message -> reasoning
    - Creates suggested_responses from draft_response

    Args:
        result: Result from TriageOptimizer (new format)

    Returns:
        Enhanced result with both old and new fields
    """
    # Decision to category mapping
    DECISION_TO_CATEGORY = {
        'CLOSE_DUPLICATE': 'bug',
        'CLOSE_FIXED': 'bug',
        'CLOSE_EXISTS': 'feature_request',
        'NEEDS_INVESTIGATION': 'bug',
        'VALID_FEATURE': 'feature_request',
        'NEEDS_INFO': 'question',
        'ANSWER_FROM_DOCS': 'question',
        'INVALID': 'low_priority'
    }

    # Decision to confidence mapping
    DECISION_TO_CONFIDENCE = {
        'CLOSE_DUPLICATE': 0.95,
        'CLOSE_FIXED': 0.85,
        'CLOSE_EXISTS': 0.85,
        'NEEDS_INVESTIGATION': 0.70,
        'VALID_FEATURE': 0.80,
        'NEEDS_INFO': 0.75,
        'ANSWER_FROM_DOCS': 0.90,
        'INVALID': 0.65
    }

    decision = result.get('decision')

    # Only transform if using new format (has 'decision' field)
    if decision:
        # Map decision to category
        result['primary_category'] = DECISION_TO_CATEGORY.get(decision, 'question')

        # Use rule-based confidence if present, otherwise map from decision
        if 'confidence' not in result:
            result['confidence'] = DECISION_TO_CONFIDENCE.get(decision, 0.75)

        # Map primary_message to reasoning
        if 'primary_message' in result and 'reasoning' not in result:
            result['reasoning'] = result['primary_message']

        # Create suggested_responses from draft_response
        if 'draft_response' in result and not result.get('suggested_responses'):
            action_text = result.get('action_button_text', 'Post Comment')
            response_type = result.get('action_button_style', 'primary')

            result['suggested_responses'] = [{
                'type': response_type,
                'title': action_text,
                'body': result['draft_response'],
                'actions': [action_text]
            }]

        # Initialize empty arrays for old format fields if missing
        result.setdefault('duplicate_of', None)
        result.setdefault('related_prs', [])
        result.setdefault('doc_links', [])
        result.setdefault('tags', [])

        # Map decision to priority
        priority_map = {
            'CLOSE_DUPLICATE': 3,
            'NEEDS_INVESTIGATION': 8,
            'VALID_FEATURE': 6,
            'NEEDS_INFO': 5
        }
        result.setdefault('priority_score', priority_map.get(decision, 5))

        # Set needs_response based on decision
        result.setdefault('needs_response', decision in ['NEEDS_INFO', 'ANSWER_FROM_DOCS'])

    return result


def _track_cost_savings(
    project_id: str,
    cost_saved: float = 0,
    claude_cost: float = 0,
    cache_hit: bool = False,
    cached_tokens: int = 0,
    rule_matched: str = None
):
    """Track cost savings for monitoring."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        today = date.today()

        cur.execute("""
            INSERT INTO api_costs (
                date,
                claude_api_calls,
                claude_cost_usd,
                cost_saved_usd,
                cache_hits,
                cache_misses,
                claude_tokens_cached
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (date) DO UPDATE SET
                claude_api_calls = api_costs.claude_api_calls + EXCLUDED.claude_api_calls,
                claude_cost_usd = api_costs.claude_cost_usd + EXCLUDED.claude_cost_usd,
                cost_saved_usd = api_costs.cost_saved_usd + EXCLUDED.cost_saved_usd,
                cache_hits = api_costs.cache_hits + EXCLUDED.cache_hits,
                cache_misses = api_costs.cache_misses + EXCLUDED.cache_misses,
                claude_tokens_cached = api_costs.claude_tokens_cached + EXCLUDED.claude_tokens_cached,
                updated_at = CURRENT_TIMESTAMP
        """, (
            today,
            1 if claude_cost > 0 else 0,
            claude_cost,
            cost_saved,
            1 if cache_hit else 0,
            0 if cache_hit else 1,
            cached_tokens
        ))

        conn.commit()
        cur.close()
        conn.close()

        logger.info(f"[{project_id}] 💰 Tracked: cost=${claude_cost:.4f}, saved=${cost_saved:.4f}, cache_hit={cache_hit}, rule={rule_matched}")

    except Exception as e:
        logger.error(f"Failed to track cost: {e}")


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
