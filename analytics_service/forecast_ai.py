from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fallback(response: dict[str, Any]) -> dict[str, Any]:
    explanation = response.get("explanation") or {}
    paragraphs = explanation.get("paragraphs") or []
    return {
        "available": False,
        "source": "fallback",
        "headline": str(explanation.get("headline") or "Lecture automatique disponible."),
        "interpretation": str(paragraphs[0] if paragraphs else explanation.get("confidenceNote") or ""),
        "why": [str(item) for item in paragraphs[1:4]],
        "risks": [str(explanation.get("confidenceNote") or "Interprétation IA indisponible.")],
        "generatedAt": _now_iso(),
    }


def _compact_context(response: dict[str, Any], target: str) -> dict[str, Any]:
    model = response.get("model") or {}
    summary = response.get("summary") or {}
    explanation = response.get("explanation") or {}
    forecast = response.get("forecast") or []
    historical = response.get("historical") or []
    return {
        "target": target,
        "scope": response.get("scope"),
        "summary": {
            "nextMonth": summary.get("nextMonthMedianDays", summary.get("nextMonthTickets")),
            "sixMonthAverage": summary.get("sixMonthAverageDays", summary.get("sixMonthAverageTickets")),
            "recentBaseline": summary.get(
                "recentThreeMonthMedianDays",
                summary.get("recentThreeMonthAverageTickets"),
            ),
            "changePct": summary.get("changePct"),
            "trend": summary.get("trend"),
            "qualityTargetMet": summary.get("qualityTargetMet"),
            "qualityWarning": summary.get("qualityWarning"),
        },
        "model": {
            "trainingStart": model.get("trainingStart"),
            "trainingEnd": model.get("trainingEnd"),
            "historyMonths": model.get("historyMonths"),
            "observations": model.get("resolvedTickets", model.get("tickets")),
            "targetRangePct": model.get("targetRangePct"),
            "targetAccuracyPct": model.get("targetAccuracyPct"),
            "weightedWithin10Accuracy": model.get("weightedWithin10Accuracy"),
            "backtestMae": model.get("backtestMaeDays", model.get("backtestMaeTickets")),
            "metricsByHorizon": model.get("metricsByHorizon"),
        },
        "currentMonth": response.get("currentMonth"),
        "historicalLast24": historical[-24:],
        "forecast": forecast,
        "contributors": explanation.get("contributors") or [],
        "deterministicExplanation": {
            "headline": explanation.get("headline"),
            "paragraphs": explanation.get("paragraphs"),
            "evidence": explanation.get("evidence"),
            "confidenceNote": explanation.get("confidenceNote"),
        },
    }


def _system_prompt() -> str:
    return (
        "Tu es un analyste opérationnel support. "
        "Réponds en français clair, style business. "
        "Explique pourquoi la prévision évolue ainsi. "
        "Utilise uniquement les données JSON fournies. "
        "N'invente pas de causes, de chiffres, ni de projets. "
        "Ne cite pas de jargon modèle sauf si nécessaire. "
        "Retourne uniquement du JSON valide avec les clés: headline, interpretation, why, risks. "
        "why et risks doivent être des tableaux de chaînes courtes."
    )


def _messages(context: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "role": "user",
            "content": (
                "Génère une interprétation métier de cette prévision. "
                "Explique le pourquoi avec les tendances, la saisonnalité, la qualité backtest "
                "et les contributeurs observés.\n\n"
                + json.dumps(context, ensure_ascii=False, separators=(",", ":"))
            ),
        }
    ]


def _post_json(url: str, headers: dict[str, str], body: dict[str, Any], timeout: float) -> dict[str, Any]:
    request = Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _call_lovable(context: dict[str, Any], timeout: float) -> str:
    api_key = os.getenv("LOVABLE_API_KEY")
    if not api_key:
        raise RuntimeError("LOVABLE_API_KEY is not configured")
    payload = _post_json(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {"Authorization": f"Bearer {api_key}"},
        {
            "model": "google/gemini-3-flash-preview",
            "messages": [{"role": "system", "content": _system_prompt()}, *_messages(context)],
            "stream": False,
            "temperature": 0.25,
            "max_tokens": 900,
        },
        timeout,
    )
    content = payload.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise RuntimeError("Lovable returned an empty response")
    return str(content)


def _call_groq(context: dict[str, Any], timeout: float) -> str:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not configured")
    payload = _post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        {"Authorization": f"Bearer {api_key}"},
        {
            "model": os.getenv("GROQ_MODEL") or DEFAULT_GROQ_MODEL,
            "messages": [{"role": "system", "content": _system_prompt()}, *_messages(context)],
            "stream": False,
            "temperature": 0.25,
            "max_tokens": 900,
        },
        timeout,
    )
    content = payload.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise RuntimeError("Groq returned an empty response")
    return str(content)


def _parse_ai_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    payload = json.loads(text)
    headline = str(payload.get("headline") or "").strip()
    interpretation = str(payload.get("interpretation") or "").strip()
    why = [str(item).strip() for item in payload.get("why") or [] if str(item).strip()]
    risks = [str(item).strip() for item in payload.get("risks") or [] if str(item).strip()]
    if not headline or not interpretation:
        raise ValueError("AI interpretation missing headline or interpretation")
    return {
        "headline": headline,
        "interpretation": interpretation,
        "why": why[:4],
        "risks": risks[:3],
    }


def build_ai_interpretation(response: dict[str, Any], target: str) -> dict[str, Any]:
    if os.getenv("FORECAST_AI_ENABLED", "").lower() not in {"1", "true", "yes"}:
        return _fallback(response)

    context = _compact_context(response, target)
    cache_seconds = int(os.getenv("FORECAST_AI_CACHE_SECONDS", "3600"))
    cache_key = hashlib.sha256(json.dumps(context, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < cache_seconds:
        return cached[1]

    timeout = float(os.getenv("FORECAST_AI_TIMEOUT_SECONDS", "8"))
    providers = [
        item.strip().lower()
        for item in os.getenv("AI_PROVIDER_ORDER", "lovable,groq").split(",")
        if item.strip()
    ]
    for provider in providers:
        try:
            if provider in {"lovable", "gemini"}:
                raw = _call_lovable(context, timeout)
            elif provider == "groq":
                raw = _call_groq(context, timeout)
            else:
                continue
            parsed = _parse_ai_json(raw)
            result = {
                "available": True,
                "source": "lovable" if provider in {"lovable", "gemini"} else "groq",
                **parsed,
                "generatedAt": _now_iso(),
            }
            _cache[cache_key] = (time.time(), result)
            return result
        except (HTTPError, URLError, TimeoutError, ValueError, RuntimeError, json.JSONDecodeError, OSError) as exc:
            print(f"[forecast-ai] provider failed: {provider}: {exc}")

    return _fallback(response)
