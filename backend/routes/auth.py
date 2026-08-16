"""Authentication API routes for secure browser sign-in."""

import os
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm

from backend.auth import SESSION_COOKIE_NAME, DatabaseSession, authenticate_user, get_current_user
from backend.schemas import TokenResponse, UserResponse
from backend.utils.jwt_handler import ACCESS_TOKEN_EXPIRE_MINUTES, create_access_token


router = APIRouter(prefix="/api/auth", tags=["Authentication"])
LoginForm = Annotated[OAuth2PasswordRequestForm, Depends()]


@router.post("/login", response_model=TokenResponse)
def login(
    form_data: LoginForm,
    database_session: DatabaseSession,
    response: Response,
) -> TokenResponse:
    """Validate credentials and issue a short-lived JWT bearer token."""

    user = authenticate_user(database_session, form_data.username, form_data.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token(user.username, expires_at=expires_at)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=os.getenv("APP_ENV", "development").strip().casefold() == "production",
        samesite="lax",
        path="/",
    )
    return TokenResponse(access_token=token, expires_at=expires_at, user=user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    """Clear the browser session cookie; bearer clients remain backward-compatible."""

    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: Annotated[object, Depends(get_current_user)]) -> object:
    """Return safe account details for the signed-in browser session."""

    return current_user
