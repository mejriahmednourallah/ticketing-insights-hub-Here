from __future__ import annotations

import pytest
from fastapi import HTTPException

from analytics_service.auth import require_analytics_token


def test_auth_can_be_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANALYTICS_AUTH_DISABLED", "true")
    require_analytics_token(None)


def test_auth_accepts_configured_anon_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANALYTICS_AUTH_DISABLED", raising=False)
    monkeypatch.setenv("SUPABASE_ANON_KEY", "expected-token")
    require_analytics_token("Bearer expected-token")


def test_auth_rejects_missing_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANALYTICS_AUTH_DISABLED", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    with pytest.raises(HTTPException) as error:
        require_analytics_token(None)
    assert error.value.status_code == 401
