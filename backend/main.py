"""
FastAPI backend for GitHub Issue Triage Assistant.
Main application entry point.
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from utils.database import get_db_connection, load_settings_from_db
from api import repositories, github, settings, categorization, triage, webhooks

load_dotenv()

# Load settings from database on startup
load_settings_from_db()

# Initialize FastAPI app
app = FastAPI(
    title="Issue Triage API",
    description="AI-powered GitHub issue triage and management platform",
    version="1.0.0"
)

# CORS middleware for frontend
# Configure allowed origins from environment variable
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

# Add common development origins
if "http://localhost:3000" not in allowed_origins:
    allowed_origins.append("http://localhost:3000")
if "http://127.0.0.1:3000" not in allowed_origins:
    allowed_origins.append("http://127.0.0.1:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(repositories.router)
app.include_router(github.router)
app.include_router(settings.router)
app.include_router(categorization.router)
app.include_router(triage.router)
app.include_router(webhooks.router)


# Root endpoints
@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Issue Triage API",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "docs": "/docs",
            "repositories": "/api/repositories",
            "github": "/api/github",
            "settings": "/api/settings",
            "triage": "/api/triage",
            "categorization": "/api/categorize-issues",
            "webhooks": "/api/webhooks"
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


if __name__ == "__main__":
    import uvicorn
    print("Starting Issue Triage API server...")
    print("API docs available at: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)
