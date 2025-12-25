"""
Service for cloning GitHub repositories.
"""

import subprocess
import os
import shutil
from pathlib import Path


class RepoCloner:
    """
    Handles cloning of GitHub repositories for indexing.
    """

    def __init__(self, data_dir: str = "./data"):
        """
        Initialize repo cloner.

        Args:
            data_dir: Base directory for storing cloned repositories
        """
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(exist_ok=True, parents=True)

    def clone_repo(self, github_url: str, project_id: str) -> str:
        """
        Clone a GitHub repository.

        Args:
            github_url: URL of the GitHub repository
            project_id: Unique identifier for the project

        Returns:
            Path to the cloned repository

        Raises:
            Exception: If cloning fails
        """
        repo_path = self.data_dir / f"repos/{project_id}"

        # Remove existing directory if present
        if repo_path.exists():
            print(f"Removing existing repo at {repo_path}")
            shutil.rmtree(repo_path)

        # Create parent directory
        repo_path.mkdir(parents=True, exist_ok=True)

        try:
            print(f"Cloning {github_url} to {repo_path}")

            # Clone with shallow depth for speed
            result = subprocess.run(
                [
                    "git", "clone",
                    "--depth", "1",      # Shallow clone (only latest commit)
                    "--single-branch",   # Only default branch
                    github_url,
                    str(repo_path)
                ],
                check=True,
                capture_output=True,
                timeout=300  # 5 minute timeout
            )

            print(f"Clone successful: {result.stdout.decode()}")

            # Remove .git directory (not needed for indexing, saves space)
            git_dir = repo_path / ".git"
            if git_dir.exists():
                shutil.rmtree(git_dir)
                print(f"Removed .git directory")

            return str(repo_path)

        except subprocess.TimeoutExpired:
            raise Exception("Repository clone timed out (>5 minutes)")

        except subprocess.CalledProcessError as e:
            error_msg = e.stderr.decode() if e.stderr else str(e)
            raise Exception(f"Git clone failed: {error_msg}")

        except Exception as e:
            raise Exception(f"Unexpected error during clone: {str(e)}")

    def get_repo_info(self, repo_path: str) -> dict:
        """
        Get basic information about the cloned repository.

        Args:
            repo_path: Path to the repository

        Returns:
            Dictionary with repo info (file count, size, etc.)
        """
        path = Path(repo_path)

        if not path.exists():
            return {"error": "Repository path does not exist"}

        # Count files
        file_count = sum(1 for f in path.rglob('*') if f.is_file())

        # Calculate total size
        total_size = sum(f.stat().st_size for f in path.rglob('*') if f.is_file())

        return {
            "file_count": file_count,
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2)
        }
