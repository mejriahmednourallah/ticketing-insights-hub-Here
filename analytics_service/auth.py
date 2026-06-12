from __future__ import annotations

import os

import jwt
from fastapi import Header, HTTPException


def require_analytics_token(authorization: str | None = Header(default=None)) -> None:
    if os.getenv("ANALYTICS_AUTH_DISABLED", "").lower() in {"1", "true", "yes"}:
        return

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    configured_anon = os.getenv("SUPABASE_ANON_KEY", "").strip()
    if configured_anon and token == configured_anon:
        return

    secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=401, detail="Analytics authentication is not configured")

    try:
        jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid bearer token") from exc
