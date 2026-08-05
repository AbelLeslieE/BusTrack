"""Authentication API routes for secure browser sign-in.

TODO: Add rate limiting, refresh tokens, and password-reset delivery before public deployment.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.auth import DatabaseSession, authenticate_user, get_current_user
from backend.schemas import TokenResponse, UserResponse
from backend.utils.jwt_handler import create_access_token


router = APIRouter(prefix="/api/auth", tags=["Authentication"])
LoginForm = Annotated[OAuth2PasswordRequestForm, Depends()]


@router.post("/login", response_model=TokenResponse)
def login(form_data: LoginForm, database_session: DatabaseSession) -> TokenResponse:
    """Validate credentials and issue a short-lived JWT bearer token."""

    user = authenticate_user(database_session, form_data.username, form_data.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return TokenResponse(
        access_token=create_access_token(user.username),
        user=user,
    )


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: Annotated[object, Depends(get_current_user)]) -> object:
    """Return safe account details for the signed-in browser session."""

    return current_user
