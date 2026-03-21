from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    from ..services.notifications import load_subscriptions
    from ..services.air_quality import _cache, CACHE_TTL_SECONDS
    from datetime import datetime
    subs = load_subscriptions()
    now = datetime.utcnow()
    cache_entries = [
        {
            "key": k,
            "expires_in_s": max(0, int((v["expires_at"] - now).total_seconds())),
        }
        for k, v in _cache.items()
    ]
    return {
        "status": "ok",
        "subscriptions": len(subs),
        "cache": {"ttl_s": CACHE_TTL_SECONDS, "entries": len(cache_entries), "detail": cache_entries},
    }
