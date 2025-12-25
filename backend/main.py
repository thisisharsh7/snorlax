"""
FastAPI backend for Code Q&A platform.
"""

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
import uuid
import os
from dotenv import load_dotenv
import psycopg2
from typing import List, Optional
from datetime import datetime
import re

from services.repo_cloner import RepoCloner
from services.query_service import QueryService
from services.github_service import GitHubService
from flows import create_flow_for_project

load_dotenv()

# Initialize FastAPI app
app = FastAPI(
    title="Code Q&A API",
    description="AI-powered code understanding platform",
    version="1.0.0"
)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper function to load settings from database
def load_settings_from_db():
    """Load API keys from database and set environment variables."""
    try:
        conn = psycopg2.connect(os.getenv("APP_DATABASE_URL"))
        cur = conn.cursor()

        # Load anthropic key
        cur.execute("SELECT value FROM settings WHERE key = 'anthropic_api_key'")
        anthropic_result = cur.fetchone()
        if anthropic_result and anthropic_result[0]:
            os.environ['ANTHROPIC_API_KEY'] = anthropic_result[0]

        # Load github token
        cur.execute("SELECT value FROM settings WHERE key = 'github_token'")
        github_result = cur.fetchone()
        if github_result and github_result[0]:
            os.environ['GITHUB_TOKEN'] = github_result[0]

        cur.close()
        conn.close()
    except Exception as e:
        print(f"Warning: Could not load settings from database: {e}")


# Load settings from database on startup
load_settings_from_db()

# Initialize services
repo_cloner = RepoCloner(data_dir=os.getenv("DATA_DIR", "./data"))
query_service = QueryService()
github_service = GitHubService()


# Pydantic models for API
class IndexRequest(BaseModel):
    github_url: HttpUrl


class QueryRequest(BaseModel):
    question: str


class IndexResponse(BaseModel):
    project_id: str
    status: str
    message: str


class Source(BaseModel):
    filename: str
    code: str
    language: str
    start_line: int
    end_line: int
    similarity: float


class QueryResponse(BaseModel):
    answer: str
    sources: List[Source]


class StatusResponse(BaseModel):
    status: str
    error_message: Optional[str] = None
    indexed_at: Optional[str] = None


class Repository(BaseModel):
    repo_url: str
    project_id: str
    repo_name: str
    indexed_at: str
    status: str


class SettingsRequest(BaseModel):
    ai_provider: Optional[str] = "anthropic"
    anthropic_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    github_token: Optional[str] = None


class SettingsResponse(BaseModel):
    ai_provider: str
    anthropic_key_set: bool
    openai_key_set: bool
    openrouter_key_set: bool
    github_token_set: bool


# Helper functions
def extract_repo_name(github_url: str) -> str:
    """Extract repository name from GitHub URL."""
    # Match patterns like github.com/owner/repo or github.com/owner/repo.git
    match = re.search(r'github\.com[:/]([^/]+)/([^/\.]+)', github_url)
    if match:
        owner, repo = match.groups()
        return f"{owner}/{repo}"
    return "unknown"


# Database helper functions
def get_db_connection():
    """Get database connection."""
    return psycopg2.connect(os.getenv("APP_DATABASE_URL"))


def update_repository_status(
    project_id: str,
    status: str
):
    """Update repository status in database."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "UPDATE repositories SET status = %s, indexed_at = NOW() WHERE project_id = %s",
        (status, project_id)
    )
    conn.commit()
    cur.close()
    conn.close()


# Background task for indexing
def index_repository(project_id: str, github_url: str):
    """
    Background task to clone and index a repository.

    Args:
        project_id: Unique project identifier
        github_url: GitHub repository URL
    """
    try:
        print(f"\n[{project_id}] Starting indexing process...")

        # Update status to indexing
        update_repository_status(project_id, "indexing")

        # Step 1: Clone repository
        print(f"[{project_id}] Cloning repository from {github_url}")
        repo_path = repo_cloner.clone_repo(github_url, project_id)
        repo_info = repo_cloner.get_repo_info(repo_path)
        print(f"[{project_id}] Cloned {repo_info['file_count']} files "
              f"({repo_info['total_size_mb']} MB)")

        # Step 2: Create CocoIndex flow
        print(f"[{project_id}] Creating CocoIndex flow...")
        flow = create_flow_for_project(project_id, repo_path)

        # Step 3: Setup flow (creates tables and indexes)
        print(f"[{project_id}] Setting up flow (creating tables)...")
        flow.setup()

        # Step 4: Run indexing
        print(f"[{project_id}] Processing files and generating embeddings...")
        flow.update()

        # Step 5: Mark as complete
        print(f"[{project_id}] Indexing complete!")
        update_repository_status(project_id, "indexed")

    except Exception as e:
        error_msg = str(e)
        print(f"[{project_id}] Error: {error_msg}")
        update_repository_status(project_id, "failed")


# API Endpoints

@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Code Q&A API",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "index": "POST /api/index",
            "status": "GET /api/status/{project_id}",
            "query": "POST /api/query/{project_id}"
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    try:
        # Check database connection
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        conn.close()
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}


@app.post("/api/index", response_model=IndexResponse)
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


@app.get("/api/repositories", response_model=List[Repository])
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
            """SELECT repo_url, project_id, repo_name, indexed_at, status
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
                status=row[4]
            )
            for row in results
        ]
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list repositories: {str(e)}"
        )


@app.get("/api/status/{project_id}", response_model=StatusResponse)
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


@app.post("/api/query/{project_id}", response_model=QueryResponse)
async def query_project(project_id: str, request: QueryRequest):
    """
    Ask a question about the indexed code.

    Args:
        project_id: Project identifier
        request: QueryRequest with question

    Returns:
        QueryResponse with answer and sources
    """
    # Check if repository exists and is indexed
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT status FROM repositories WHERE project_id = %s",
            (project_id,)
        )
        result = cur.fetchone()
        cur.close()
        conn.close()

        if not result:
            raise HTTPException(status_code=404, detail="Repository not found")

        if result[0] != "indexed":
            raise HTTPException(
                status_code=400,
                detail=f"Repository is not ready yet. Current status: {result[0]}"
            )

        # Execute query
        result = query_service.query(project_id, request.question)

        return QueryResponse(
            answer=result["answer"],
            sources=[Source(**source) for source in result["sources"]]
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Query failed: {str(e)}"
        )


@app.post("/api/github/import-issues/{project_id}")
async def import_github_issues(project_id: str, limit: Optional[int] = None):
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

        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=result["message"])

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to import issues: {str(e)}"
        )


@app.post("/api/github/import-prs/{project_id}")
async def import_github_prs(project_id: str, limit: Optional[int] = None):
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

        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=result["message"])

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to import PRs: {str(e)}"
        )


@app.get("/api/github/issues/{project_id}")
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


@app.get("/api/github/prs/{project_id}")
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


@app.get("/api/settings", response_model=SettingsResponse)
async def get_settings():
    """
    Get current settings status (without exposing actual keys).

    Returns:
        SettingsResponse with boolean flags indicating if keys are set
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Get AI provider
        cur.execute("SELECT value FROM settings WHERE key = 'ai_provider'")
        provider_result = cur.fetchone()
        ai_provider = provider_result[0] if provider_result and provider_result[0] else 'anthropic'

        # Check if keys are set (not null)
        cur.execute("SELECT value FROM settings WHERE key = 'anthropic_api_key'")
        anthropic_result = cur.fetchone()

        cur.execute("SELECT value FROM settings WHERE key = 'openai_api_key'")
        openai_result = cur.fetchone()

        cur.execute("SELECT value FROM settings WHERE key = 'openrouter_api_key'")
        openrouter_result = cur.fetchone()

        cur.execute("SELECT value FROM settings WHERE key = 'github_token'")
        github_result = cur.fetchone()

        cur.close()
        conn.close()

        return SettingsResponse(
            ai_provider=ai_provider,
            anthropic_key_set=bool(anthropic_result and anthropic_result[0]),
            openai_key_set=bool(openai_result and openai_result[0]),
            openrouter_key_set=bool(openrouter_result and openrouter_result[0]),
            github_token_set=bool(github_result and github_result[0])
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get settings: {str(e)}"
        )


@app.post("/api/settings")
async def save_settings(settings: SettingsRequest):
    """
    Save API settings (keys are stored securely in database).

    Args:
        settings: SettingsRequest with optional API keys

    Returns:
        Success message
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Update AI provider
        if settings.ai_provider:
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('ai_provider', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()""",
                (settings.ai_provider, settings.ai_provider)
            )
            os.environ['AI_PROVIDER'] = settings.ai_provider

        # Update anthropic key if provided (and not masked)
        if settings.anthropic_api_key and not settings.anthropic_api_key.startswith('••'):
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('anthropic_api_key', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()""",
                (settings.anthropic_api_key, settings.anthropic_api_key)
            )
            os.environ['ANTHROPIC_API_KEY'] = settings.anthropic_api_key

        # Update openai key if provided (and not masked)
        if settings.openai_api_key and not settings.openai_api_key.startswith('••'):
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('openai_api_key', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()""",
                (settings.openai_api_key, settings.openai_api_key)
            )
            os.environ['OPENAI_API_KEY'] = settings.openai_api_key

        # Update openrouter key if provided (and not masked)
        if settings.openrouter_api_key and not settings.openrouter_api_key.startswith('••'):
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('openrouter_api_key', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()""",
                (settings.openrouter_api_key, settings.openrouter_api_key)
            )
            os.environ['OPENROUTER_API_KEY'] = settings.openrouter_api_key

        # Update github token if provided (and not masked)
        if settings.github_token and not settings.github_token.startswith('••'):
            cur.execute(
                """INSERT INTO settings (key, value, updated_at)
                   VALUES ('github_token', %s, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW()""",
                (settings.github_token, settings.github_token)
            )
            os.environ['GITHUB_TOKEN'] = settings.github_token
            global github_service
            github_service = GitHubService(github_token=settings.github_token)

        conn.commit()
        cur.close()
        conn.close()

        return {"status": "success", "message": "Settings saved successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save settings: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    print("Starting Code Q&A API server...")
    print("API docs available at: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)
