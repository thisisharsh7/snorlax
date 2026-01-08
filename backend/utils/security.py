"""Security utilities for authentication and authorization."""

import os
import secrets
import hashlib
from typing import Optional
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

# HTTP Basic Auth security scheme
security = HTTPBasic()


def verify_admin_credentials(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    """
    Verify admin credentials for sensitive endpoints.

    Uses HTTP Basic Auth with credentials from environment variables.
    Performs constant-time comparison to prevent timing attacks.

    Args:
        credentials: HTTP Basic Auth credentials from request

    Returns:
        Username if authentication successful

    Raises:
        HTTPException: 401 if credentials invalid or not configured

    Environment Variables:
        ADMIN_USERNAME: Admin username (default: "admin")
        ADMIN_PASSWORD: Admin password (required, no default)

    Example:
        @router.post("/api/settings")
        async def save_settings(
            settings: SettingsRequest,
            admin: str = Depends(verify_admin_credentials)
        ):
            # Only accessible with valid admin credentials
            pass
    """
    # Get expected credentials from environment
    correct_username = os.getenv("ADMIN_USERNAME", "admin")
    correct_password = os.getenv("ADMIN_PASSWORD")

    # Critical: Require password to be configured
    if not correct_password:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin authentication not configured. Set ADMIN_PASSWORD environment variable.",
            headers={"WWW-Authenticate": "Basic"},
        )

    # Constant-time comparison to prevent timing attacks
    username_correct = secrets.compare_digest(
        credentials.username.encode("utf8"),
        correct_username.encode("utf8")
    )
    password_correct = secrets.compare_digest(
        credentials.password.encode("utf8"),
        correct_password.encode("utf8")
    )

    if not (username_correct and password_correct):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )

    return credentials.username


def generate_secure_password(length: int = 32) -> str:
    """
    Generate a cryptographically secure random password.

    Args:
        length: Password length (default: 32)

    Returns:
        Secure random password string

    Example:
        >>> password = generate_secure_password()
        >>> print(f"ADMIN_PASSWORD={password}")
    """
    import string

    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    password = ''.join(secrets.choice(alphabet) for _ in range(length))
    return password


def hash_password(password: str) -> str:
    """
    Hash a password using SHA-256.

    Note: For production, use bcrypt or argon2 instead.
    This is a simple implementation for basic security.

    Args:
        password: Plain text password

    Returns:
        Hexadecimal hash string
    """
    return hashlib.sha256(password.encode()).hexdigest()


# Optional: API Key authentication for programmatic access
class APIKeyAuth:
    """
    API Key authentication for programmatic access.

    Usage:
        api_key_auth = APIKeyAuth()

        @router.get("/api/data")
        async def get_data(api_key: str = Depends(api_key_auth)):
            # Endpoint protected by API key
            pass
    """

    def __init__(self, header_name: str = "X-API-Key"):
        """
        Initialize API key authentication.

        Args:
            header_name: HTTP header name for API key (default: X-API-Key)
        """
        self.header_name = header_name

    async def __call__(self, api_key: Optional[str] = None) -> str:
        """
        Verify API key from request header.

        Args:
            api_key: API key from request header

        Returns:
            API key if valid

        Raises:
            HTTPException: 401 if API key invalid or not configured
        """
        expected_key = os.getenv("API_KEY")

        if not expected_key:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="API key authentication not configured"
            )

        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Missing API key in {self.header_name} header"
            )

        if not secrets.compare_digest(api_key, expected_key):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid API key"
            )

        return api_key
