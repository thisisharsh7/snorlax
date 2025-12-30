"""
FastAPI backend for Code Q&A platform.
Main application entry point.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from utils.database import get_db_connection, load_settings_from_db
from api import repositories, github, settings, categorization

load_dotenv()

# Load settings from database on startup
load_settings_from_db()

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

# Include API routers
app.include_router(repositories.router)
app.include_router(github.router)
app.include_router(settings.router)
app.include_router(categorization.router)


# Root endpoints
@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Code Q&A API",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "docs": "/docs",
            "repositories": "/api/repositories",
            "github": "/api/github",
            "settings": "/api/settings",
            "categorization": "/api/categorize-issues"
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
    print("Starting Code Q&A API server...")
    print("API docs available at: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)
