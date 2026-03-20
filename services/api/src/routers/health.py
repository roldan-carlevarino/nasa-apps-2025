from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    from ..services.notifications import load_subscriptions
    subs = load_subscriptions()
    return {"status": "ok", "subscriptions": len(subs)}
