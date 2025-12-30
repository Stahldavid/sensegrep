"""
Test Python file for sensegrep multilingual support.
"""
from dataclasses import dataclass
from typing import Protocol, TypedDict, Optional
from enum import Enum
import hashlib


class UserRole(Enum):
    """User role enumeration."""
    ADMIN = "admin"
    USER = "user"
    GUEST = "guest"


class Hashable(Protocol):
    """Protocol for hashable objects."""
    def get_hash(self) -> str:
        ...


class UserConfig(TypedDict):
    """Configuration for user settings."""
    theme: str
    language: str
    notifications: bool


@dataclass
class User:
    """User entity with authentication support."""
    id: str
    name: str
    email: str
    role: UserRole
    
    def get_display_name(self) -> str:
        """Get formatted display name."""
        return f"{self.name} ({self.role.value})"
    
    @property
    def is_admin(self) -> bool:
        """Check if user has admin privileges."""
        return self.role == UserRole.ADMIN
    
    @staticmethod
    def generate_id() -> str:
        """Generate a unique user ID."""
        import uuid
        return str(uuid.uuid4())
    
    @classmethod
    def create_guest(cls) -> "User":
        """Factory method to create a guest user."""
        return cls(
            id=cls.generate_id(),
            name="Guest",
            email="guest@example.com",
            role=UserRole.GUEST
        )


def calculate_hash(data: str) -> str:
    """Calculate SHA256 hash of data."""
    return hashlib.sha256(data.encode()).hexdigest()


async def fetch_user_data(user_id: str) -> Optional[dict]:
    """
    Fetch user data from remote API.
    
    This is an async function that simulates API call.
    """
    import asyncio
    await asyncio.sleep(0.1)  # Simulate network delay
    
    if user_id == "invalid":
        return None
    
    return {
        "id": user_id,
        "name": "Test User",
        "email": "test@example.com"
    }


def _private_helper(x: int) -> int:
    """Private helper function (not exported)."""
    return x * 2


def complex_validation(data: dict) -> bool:
    """
    Complex validation with multiple conditions.
    This function has high cyclomatic complexity.
    """
    if not data:
        return False
    
    if "name" not in data:
        return False
    
    if "email" not in data:
        return False
    
    if len(data["name"]) < 2:
        return False
    
    if "@" not in data["email"]:
        return False
    
    if "role" in data:
        if data["role"] not in ["admin", "user", "guest"]:
            return False
        
        if data["role"] == "admin":
            if "admin_key" not in data:
                return False
    
    for key, value in data.items():
        if value is None:
            return False
        if isinstance(value, str) and len(value) > 1000:
            return False
    
    return True


# Module-level constant
MAX_USERS = 1000
API_VERSION = "v2"
