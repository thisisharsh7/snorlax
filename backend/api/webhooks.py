"""GitHub Webhooks API endpoints for real-time issue and PR updates."""

import hashlib
import hmac
import json
import os
import logging
from typing import Dict, Any
from fastapi import APIRouter, Request, HTTPException, Header
from slowapi import Limiter
from slowapi.util import get_remote_address

from utils.database import get_db_connection

# Initialize rate limiter for this router
limiter = Limiter(key_func=get_remote_address)

# Setup logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

# GitHub webhook secret (set via environment variable)
GITHUB_WEBHOOK_SECRET = os.getenv("GITHUB_WEBHOOK_SECRET", "")


def verify_github_signature(payload_body: bytes, signature_header: str) -> bool:
    """
    Verify that the webhook request came from GitHub.

    Args:
        payload_body: Raw request body
        signature_header: X-Hub-Signature-256 header value

    Returns:
        True if signature is valid, False otherwise
    """
    if not GITHUB_WEBHOOK_SECRET:
        logger.error("GITHUB_WEBHOOK_SECRET not set - rejecting webhook for security")
        return False  # SECURITY: Reject all webhooks if secret not configured

    if not signature_header:
        logger.warning("Webhook received without signature header")
        return False

    # GitHub sends signature as "sha256=<hash>"
    hash_algorithm, github_signature = signature_header.split('=')

    if hash_algorithm != 'sha256':
        return False

    # Calculate expected signature
    mac = hmac.new(
        GITHUB_WEBHOOK_SECRET.encode(),
        msg=payload_body,
        digestmod=hashlib.sha256
    )
    expected_signature = mac.hexdigest()

    # Compare signatures (constant-time comparison to prevent timing attacks)
    return hmac.compare_digest(expected_signature, github_signature)


def extract_project_id(repo_url: str) -> str:
    """
    Extract project_id (owner/repo) from repository URL.

    Args:
        repo_url: GitHub repository URL

    Returns:
        Project ID in format "owner/repo"
    """
    # Handle both HTTPS and git URLs
    # https://github.com/owner/repo
    # git@github.com:owner/repo.git

    if "github.com/" in repo_url:
        parts = repo_url.split("github.com/")[1]
        parts = parts.rstrip(".git").rstrip("/")
        return parts

    if "github.com:" in repo_url:
        parts = repo_url.split("github.com:")[1]
        parts = parts.rstrip(".git").rstrip("/")
        return parts

    return repo_url


async def handle_issue_event(event_action: str, payload: Dict[str, Any]) -> Dict[str, str]:
    """
    Handle GitHub issue webhook events.

    Args:
        event_action: Action type (opened, edited, closed, reopened, etc.)
        payload: GitHub webhook payload

    Returns:
        Response dict with status
    """
    try:
        issue = payload.get("issue", {})
        repository = payload.get("repository", {})

        issue_number = issue.get("number")
        repo_full_name = repository.get("full_name")
        project_id = repo_full_name

        if not issue_number or not project_id:
            raise ValueError("Missing issue_number or project_id in payload")

        logger.info(f"[{project_id}] Issue #{issue_number} - {event_action}")

        conn = get_db_connection()
        cur = conn.cursor()

        # Check if repository exists in our database
        cur.execute(
            "SELECT project_id FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        if not cur.fetchone():
            logger.warning(f"Repository {project_id} not indexed - ignoring webhook")
            cur.close()
            conn.close()
            return {"status": "ignored", "reason": "repository_not_indexed"}

        # Update or insert issue
        if event_action in ["opened", "reopened", "edited"]:
            # Upsert issue data
            cur.execute("""
                INSERT INTO github_issues (
                    project_id, issue_number, title, body, state,
                    author, created_at, updated_at, labels, comments_count, github_url
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (project_id, issue_number)
                DO UPDATE SET
                    title = EXCLUDED.title,
                    body = EXCLUDED.body,
                    state = EXCLUDED.state,
                    updated_at = EXCLUDED.updated_at,
                    labels = EXCLUDED.labels,
                    comments_count = EXCLUDED.comments_count
            """, (
                project_id,
                issue_number,
                issue.get("title", ""),
                issue.get("body", ""),
                issue.get("state", "open"),
                issue.get("user", {}).get("login", "unknown"),
                issue.get("created_at"),
                issue.get("updated_at"),
                json.dumps([label["name"] for label in issue.get("labels", [])]),
                issue.get("comments", 0),
                issue.get("html_url", "")
            ))

            conn.commit()
            logger.info(f"[{project_id}] Issue #{issue_number} updated in database")

        elif event_action == "closed":
            # Mark issue as closed
            cur.execute("""
                UPDATE github_issues
                SET state = 'closed', updated_at = %s
                WHERE project_id = %s AND issue_number = %s
            """, (issue.get("updated_at"), project_id, issue_number))

            conn.commit()
            logger.info(f"[{project_id}] Issue #{issue_number} marked as closed")

        cur.close()
        conn.close()

        return {"status": "success", "action": event_action, "issue": issue_number}

    except Exception as e:
        logger.error(f"Failed to handle issue event: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process webhook: {str(e)}")


async def handle_pull_request_event(event_action: str, payload: Dict[str, Any]) -> Dict[str, str]:
    """
    Handle GitHub pull request webhook events.

    Args:
        event_action: Action type (opened, edited, closed, etc.)
        payload: GitHub webhook payload

    Returns:
        Response dict with status
    """
    try:
        pull_request = payload.get("pull_request", {})
        repository = payload.get("repository", {})

        pr_number = pull_request.get("number")
        repo_full_name = repository.get("full_name")
        project_id = repo_full_name

        if not pr_number or not project_id:
            raise ValueError("Missing pr_number or project_id in payload")

        logger.info(f"[{project_id}] PR #{pr_number} - {event_action}")

        conn = get_db_connection()
        cur = conn.cursor()

        # Check if repository exists in our database
        cur.execute(
            "SELECT project_id FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        if not cur.fetchone():
            logger.warning(f"Repository {project_id} not indexed - ignoring webhook")
            cur.close()
            conn.close()
            return {"status": "ignored", "reason": "repository_not_indexed"}

        # Update or insert PR data
        if event_action in ["opened", "reopened", "edited", "synchronize"]:
            # Upsert PR data
            cur.execute("""
                INSERT INTO github_prs (
                    project_id, pr_number, title, body, state,
                    author, created_at, updated_at, merged_at, github_url
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (project_id, pr_number)
                DO UPDATE SET
                    title = EXCLUDED.title,
                    body = EXCLUDED.body,
                    state = EXCLUDED.state,
                    updated_at = EXCLUDED.updated_at,
                    merged_at = EXCLUDED.merged_at
            """, (
                project_id,
                pr_number,
                pull_request.get("title", ""),
                pull_request.get("body", ""),
                pull_request.get("state", "open"),
                pull_request.get("user", {}).get("login", "unknown"),
                pull_request.get("created_at"),
                pull_request.get("updated_at"),
                pull_request.get("merged_at"),
                pull_request.get("html_url", "")
            ))

            conn.commit()
            logger.info(f"[{project_id}] PR #{pr_number} updated in database")

        elif event_action == "closed":
            # Mark PR as closed/merged
            merged_at = pull_request.get("merged_at")
            state = "merged" if merged_at else "closed"

            cur.execute("""
                UPDATE github_prs
                SET state = %s, updated_at = %s, merged_at = %s
                WHERE project_id = %s AND pr_number = %s
            """, (state, pull_request.get("updated_at"), merged_at, project_id, pr_number))

            conn.commit()
            logger.info(f"[{project_id}] PR #{pr_number} marked as {state}")

        cur.close()
        conn.close()

        return {"status": "success", "action": event_action, "pr": pr_number}

    except Exception as e:
        logger.error(f"Failed to handle PR event: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process webhook: {str(e)}")


@router.post("/github")
@limiter.limit("100/minute")  # Allow 100 webhook events per minute per IP
async def github_webhook(
    request: Request,
    x_hub_signature_256: str = Header(None),
    x_github_event: str = Header(None)
):
    """
    Handle incoming GitHub webhook events.

    Rate Limit: 100 requests per minute per IP address

    Supports:
    - Issues (opened, edited, closed, reopened)
    - Pull Requests (opened, edited, closed, reopened, synchronize)

    Headers:
        X-Hub-Signature-256: HMAC signature for verification
        X-GitHub-Event: Event type (issues, pull_request, etc.)

    Returns:
        Status response
    """
    try:
        # Get raw body for signature verification (with size limit)
        MAX_PAYLOAD_SIZE = 1024 * 1024  # 1MB limit
        body = await request.body()

        if len(body) > MAX_PAYLOAD_SIZE:
            logger.warning(f"Webhook payload too large: {len(body)} bytes")
            raise HTTPException(status_code=413, detail="Payload too large")

        # Verify webhook signature
        if not verify_github_signature(body, x_hub_signature_256):
            logger.warning("Invalid webhook signature")
            raise HTTPException(status_code=401, detail="Invalid signature")

        # Parse JSON payload
        payload = json.loads(body.decode())

        # Route to appropriate handler based on event type
        if x_github_event == "issues":
            action = payload.get("action")
            result = await handle_issue_event(action, payload)
            return result

        elif x_github_event == "pull_request":
            action = payload.get("action")
            result = await handle_pull_request_event(action, payload)
            return result

        elif x_github_event == "ping":
            # GitHub sends a ping event when webhook is first set up
            logger.info("Received ping event from GitHub")
            return {"status": "success", "message": "Webhook configured successfully"}

        else:
            logger.info(f"Unsupported event type: {x_github_event}")
            return {"status": "ignored", "reason": "unsupported_event_type", "event": x_github_event}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Webhook processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Webhook processing failed: {str(e)}")


@router.get("/setup-instructions")
async def get_webhook_setup_instructions():
    """
    Get instructions for setting up GitHub webhooks.

    Returns:
        Setup instructions and webhook URL
    """
    # Get the webhook URL (in production, this should be the public URL)
    webhook_url = os.getenv("WEBHOOK_URL", "https://your-domain.com/api/webhooks/github")

    return {
        "webhook_url": webhook_url,
        "instructions": [
            "1. Go to your GitHub repository settings",
            "2. Navigate to 'Webhooks' section",
            "3. Click 'Add webhook'",
            "4. Enter the Payload URL: " + webhook_url,
            "5. Set Content type to: application/json",
            "6. Enter your webhook secret (match GITHUB_WEBHOOK_SECRET env var)",
            "7. Select individual events: Issues, Pull requests",
            "8. Ensure 'Active' is checked",
            "9. Click 'Add webhook'"
        ],
        "events_to_enable": [
            "Issues",
            "Pull requests"
        ],
        "environment_variables": {
            "GITHUB_WEBHOOK_SECRET": "Set this to a secure random string",
            "WEBHOOK_URL": "Set this to your public webhook endpoint URL"
        }
    }
