from fastapi import APIRouter, HTTPException
from ..schemas.models import StationRequest
from ..services.air_quality import fetch_stations, get_all_keys

router = APIRouter()


@router.post("/stations")
async def get_stations(req: StationRequest):
    """Fetch air quality + weather data for specific municipalities."""
    try:
        data = await fetch_stations(
            keys=req.keys,
            aq_past_days=req.aq_past_days,
            aq_forecast_days=req.aq_forecast_days,
            wx_past_days=req.wx_past_days,
        )
        return data
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Open-Meteo error: {e}")


@router.get("/keys")
async def list_keys():
    """List all available municipality keys from the registry."""
    return get_all_keys()
