from fastapi import APIRouter, HTTPException, Header, Request
from typing import Optional
from ..config import ALERT_ADMIN_TOKEN, ALERT_DEV, CALIMA_THRESHOLD
from ..schemas.models import SubscribeRequest, TriggerRequest, CalimaCheckRequest
from ..services.notifications import (
    save_subscription, send_confirmation, load_subscriptions,
    calima_should_fire, send_calima_alert, _send_email,
)
from ..limiter import limiter

router = APIRouter()


# 20 suscripciones por IP por hora — evita spam de registros
@router.post("/subscribe")
@limiter.limit("20/hour")
async def subscribe(request: Request, req: SubscribeRequest):
    municipio = (req.municipio or "").strip() or None
    try:
        save_subscription(req.email, municipio)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if ALERT_DEV:
        return {"status": "ok", "email": req.email, "note": "dev mode - email not sent"}

    try:
        send_confirmation(req.email)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Saved but failed to send email: {e}")

    return {"status": "ok", "email": req.email}


# 10 triggers por IP por hora (demo pública, sin token)
@router.post("/trigger")
@limiter.limit("10/hour")
async def trigger(request: Request, req: TriggerRequest, x_admin_token: Optional[str] = Header(None)):
    if not ALERT_ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="Admin token not configured on server")
    if x_admin_token != ALERT_ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid admin token")

    subs = load_subscriptions()
    emails = [s["email"] for s in subs]
    if not emails:
        raise HTTPException(status_code=400, detail="No subscribers to notify")

    if ALERT_DEV:
        return {"status": "ok", "notified": len(emails), "dev": True}

    try:
        _send_email(emails, req.subject, req.body)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed sending alert: {e}")

    return {"status": "ok", "notified": len(emails)}


# 20 checks por IP por hora (lo llama el frontend automáticamente)
@router.post("/calima/check")
@limiter.limit("20/hour")
async def calima_check(request: Request, req: CalimaCheckRequest, x_admin_token: Optional[str] = Header(None)):
    if not ALERT_ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="Admin token not configured on server")
    if x_admin_token != ALERT_ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid admin token")

    max_value = None
    if req.pm25_values:
        filtered = [v for v in req.pm25_values if isinstance(v, (int, float))]
        if filtered:
            max_value = max(filtered)
    if max_value is None and req.max_pm25 is not None:
        max_value = req.max_pm25
    if max_value is None:
        raise HTTPException(status_code=400, detail="No PM2.5 values provided")

    subs = load_subscriptions()
    if not subs:
        return {"status": "no-subscribers", "max_pm25": max_value}

    if max_value < CALIMA_THRESHOLD:
        return {"status": "below-threshold", "max_pm25": max_value, "threshold": CALIMA_THRESHOLD}

    if not calima_should_fire():
        return {"status": "cooldown", "max_pm25": max_value, "threshold": CALIMA_THRESHOLD}

    target = subs
    if req.top_municipio:
        scoped = [s for s in subs if (s.get("municipio") or "").lower() == req.top_municipio.lower()]
        if scoped:
            target = scoped

    emails = [s["email"] for s in target]
    if not emails:
        return {"status": "no-subscribers-for-municipio", "municipio": req.top_municipio, "max_pm25": max_value}

    try:
        result = send_calima_alert(emails, max_value, req.top_municipio, req.predicted)
        return {"status": "alert-sent", "notified": len(emails), "max_pm25": max_value, "threshold": CALIMA_THRESHOLD, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed sending calima alert: {e}")
