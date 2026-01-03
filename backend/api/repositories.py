"""Repository management API endpoints."""

from fastapi import APIRouter, BackgroundTasks, HTTPException
from typing import List
import uuid
import os
import traceback
import logging

# Setup logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from models.repository import IndexRequest, IndexResponse, StatusResponse, Repository
from utils.database import get_db_connection, extract_repo_name, update_repository_status
from services.repo_cloner import RepoCloner
from flows import create_flow_for_project

router = APIRouter(prefix="/api", tags=["repositories"])

# Initialize services
repo_cloner = RepoCloner(data_dir=os.getenv("DATA_DIR", "./data"))


def index_repository(project_id: str, github_url: str):
    """
    Background task to clone and index a repository.

    Args:
        project_id: Unique project identifier
        github_url: GitHub repository URL
    """
    try:
        logger.info(f"[{project_id}] Starting indexing process for {github_url}")
        update_repository_status(project_id, "indexing")

        # Step 1: Clone repository with validation
        try:
            logger.info(f"[{project_id}] Cloning repository from {github_url}")
            repo_path = repo_cloner.clone_repo(github_url, project_id)

            if not os.path.exists(repo_path):
                raise ValueError(f"Cloned repository path does not exist: {repo_path}")

            repo_info = repo_cloner.get_repo_info(repo_path)
            logger.info(f"[{project_id}] Cloned {repo_info['file_count']} files "
                       f"({repo_info['total_size_mb']} MB)")
        except Exception as e:
            raise Exception(f"Clone failed: {str(e)}")

        # Step 2: Create CocoIndex flow with validation
        try:
            logger.info(f"[{project_id}] Creating CocoIndex flow...")
            flow = create_flow_for_project(project_id, repo_path)

            if flow is None:
                raise ValueError("create_flow_for_project returned None")

            logger.info(f"[{project_id}] CocoIndex flow created successfully")
        except Exception as e:
            raise Exception(f"Flow creation failed: {str(e)}")

        # Step 3: Setup flow with validation
        try:
            logger.info(f"[{project_id}] Setting up flow (creating tables)...")
            flow.setup()
            logger.info(f"[{project_id}] Flow setup completed")
        except Exception as e:
            raise Exception(f"Flow setup failed: {str(e)}")

        # Step 4: Run indexing with validation
        try:
            logger.info(f"[{project_id}] Processing files and generating embeddings...")
            flow.update()
            logger.info(f"[{project_id}] Flow update completed (embeddings generated)")
        except Exception as e:
            raise Exception(f"Flow update failed: {str(e)}")

        # Step 5: Mark as complete with verification
        try:
            update_repository_status(project_id, "indexed")
            logger.info(f"[{project_id}] Status updated to 'indexed'")
        except Exception as e:
            logger.error(f"[{project_id}] CRITICAL: Indexing succeeded but status update failed: {str(e)}")
            # Try one more time
            try:
                update_repository_status(project_id, "indexed")
            except:
                pass
            raise Exception(f"Status update failed after successful indexing: {str(e)}")

        logger.info(f"[{project_id}] Indexing complete!")

    except Exception as e:
        error_msg = str(e)
        stack_trace = traceback.format_exc()
        logger.error(f"[{project_id}] Indexing failed: {error_msg}\n{stack_trace}")

        try:
            update_repository_status(project_id, "failed", error_message=error_msg)
        except Exception as status_error:
            logger.error(f"[{project_id}] CRITICAL: Failed to update status to 'failed': {str(status_error)}")


@router.post("/index", response_model=IndexResponse)
async def index_repo(
    request: IndexRequest,
    background_tasks: BackgroundTasks
):
    """
    Start indexing a GitHub repository.
    If the repository is already indexed, returns the existing project_id.

    Args:
        request: IndexRequest with github_url
        background_tasks: FastAPI background tasks

    Returns:
        IndexResponse with project_id and status
    """
    repo_url = str(request.github_url)
    repo_name = extract_repo_name(repo_url)

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Check if repository already exists
        cur.execute(
            "SELECT project_id, status FROM repositories WHERE repo_url = %s",
            (repo_url,)
        )
        existing = cur.fetchone()

        if existing:
            project_id, status = existing
            cur.close()
            conn.close()

            # Return existing project
            if status == "indexed":
                return IndexResponse(
                    project_id=project_id,
                    status="indexed",
                    message=f"Repository '{repo_name}' is already indexed."
                )
            elif status == "indexing":
                return IndexResponse(
                    project_id=project_id,
                    status="indexing",
                    message=f"Repository '{repo_name}' is currently being indexed."
                )
            else:  # failed - allow re-indexing
                # Update status and restart indexing
                conn = get_db_connection()
                cur = conn.cursor()
                cur.execute(
                    "UPDATE repositories SET status = %s WHERE project_id = %s",
                    ("indexing", project_id)
                )
                conn.commit()
                cur.close()
                conn.close()
                background_tasks.add_task(index_repository, project_id, repo_url)
                return IndexResponse(
                    project_id=project_id,
                    status="indexing",
                    message=f"Re-indexing repository '{repo_name}'."
                )

        # Create new repository entry
        project_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO repositories (repo_url, project_id, repo_name, status)
               VALUES (%s, %s, %s, %s)""",
            (repo_url, project_id, repo_name, "indexing")
        )
        conn.commit()
        cur.close()
        conn.close()

        # Start indexing in background
        background_tasks.add_task(index_repository, project_id, repo_url)

        return IndexResponse(
            project_id=project_id,
            status="indexing",
            message=f"Indexing '{repo_name}' started. This may take a few minutes."
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start indexing: {str(e)}"
        )


@router.post("/reindex/{project_id}")
async def reindex_repository(project_id: str, background_tasks: BackgroundTasks):
    """
    Re-index an existing repository to update embeddings when code changes.

    Args:
        project_id: Project identifier
        background_tasks: FastAPI background tasks

    Returns:
        Status message
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Check if repository exists
        cur.execute(
            "SELECT repo_url, status FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        result = cur.fetchone()

        if not result:
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Repository not found")

        repo_url, status = result

        # Don't allow re-indexing if already indexing
        if status == "indexing":
            cur.close()
            conn.close()
            return {
                "status": "already_indexing",
                "message": "Repository is currently being indexed. Please wait for it to complete."
            }

        # Update status to indexing
        cur.execute(
            "UPDATE repositories SET status = %s WHERE project_id = %s",
            ("indexing", project_id)
        )
        conn.commit()
        cur.close()
        conn.close()

        # Start re-indexing in background
        background_tasks.add_task(index_repository, project_id, repo_url)

        return {
            "status": "success",
            "message": "Re-indexing started. Code embeddings will be updated."
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start re-indexing: {str(e)}"
        )


@router.get("/repositories", response_model=List[Repository])
async def list_repositories():
    """
    List all indexed repositories.

    Returns:
        List of Repository objects
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """SELECT repo_url, project_id, repo_name, indexed_at, status, last_synced_at,
                      error_message, last_error_at
               FROM repositories
               ORDER BY indexed_at DESC"""
        )
        results = cur.fetchall()
        cur.close()
        conn.close()

        return [
            Repository(
                repo_url=row[0],
                project_id=row[1],
                repo_name=row[2],
                indexed_at=str(row[3]),
                status=row[4],
                last_synced_at=str(row[5]) if row[5] else None,
                error_message=row[6],
                last_error_at=str(row[7]) if row[7] else None
            )
            for row in results
        ]
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list repositories: {str(e)}"
        )


@router.delete("/repositories/{project_id}")
async def delete_repository(project_id: str):
    """
    Delete a repository and all associated data.

    Args:
        project_id: Project identifier

    Returns:
        Success message
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Check if repository exists
        cur.execute(
            "SELECT repo_name FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        result = cur.fetchone()

        if not result:
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Repository not found")

        repo_name = result[0]

        # Delete repository (CASCADE will handle related data)
        cur.execute(
            "DELETE FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        conn.commit()
        cur.close()
        conn.close()

        return {
            "message": f"Repository '{repo_name}' deleted successfully",
            "project_id": project_id
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete repository: {str(e)}"
        )


@router.patch("/repositories/{project_id}/status")
async def update_repo_status(project_id: str, status: str):
    """
    Manually update repository status.
    Useful for fixing stuck repositories.

    Args:
        project_id: Project identifier
        status: New status ('indexing', 'indexed', 'failed')
    """
    if status not in ['indexing', 'indexed', 'failed']:
        raise HTTPException(
            status_code=400,
            detail="Status must be 'indexing', 'indexed', or 'failed'"
        )

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Check if repository exists
        cur.execute(
            "SELECT status FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        result = cur.fetchone()

        if not result:
            cur.close()
            conn.close()
            raise HTTPException(status_code=404, detail="Repository not found")

        old_status = result[0]

        # Update status
        cur.execute(
            "UPDATE repositories SET status = %s, indexed_at = NOW() WHERE project_id = %s",
            (status, project_id)
        )
        conn.commit()
        cur.close()
        conn.close()

        return {
            "message": f"Status updated from '{old_status}' to '{status}'",
            "project_id": project_id,
            "old_status": old_status,
            "new_status": status
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update status: {str(e)}"
        )


@router.get("/repositories/{project_id}/details")
async def get_repository_details(project_id: str):
    """
    Get detailed information about a repository including error messages.

    Args:
        project_id: Project identifier

    Returns:
        Detailed repository information including errors
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute(
            """SELECT repo_url, project_id, repo_name, indexed_at, status,
                      last_synced_at, error_message, last_error_at
               FROM repositories
               WHERE project_id = %s""",
            (project_id,)
        )
        result = cur.fetchone()
        cur.close()
        conn.close()

        if not result:
            raise HTTPException(status_code=404, detail="Repository not found")

        return {
            "repo_url": result[0],
            "project_id": result[1],
            "repo_name": result[2],
            "indexed_at": str(result[3]) if result[3] else None,
            "status": result[4],
            "last_synced_at": str(result[5]) if result[5] else None,
            "error_message": result[6],
            "last_error_at": str(result[7]) if result[7] else None
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get repository details: {str(e)}"
        )


@router.get("/status/{project_id}", response_model=StatusResponse)
async def get_status(project_id: str):
    """
    Get indexing status of a repository.

    Args:
        project_id: Project identifier

    Returns:
        StatusResponse with current status
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT status, indexed_at FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        result = cur.fetchone()
        cur.close()
        conn.close()

        if not result:
            raise HTTPException(status_code=404, detail="Repository not found")

        return StatusResponse(
            status=result[0],
            error_message=None,
            indexed_at=str(result[1]) if result[1] else None
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get status: {str(e)}"
        )


