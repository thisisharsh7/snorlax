"""
Database module for managing migrations and connections.
"""

from .migrate import run_migrations

__all__ = ["run_migrations"]
