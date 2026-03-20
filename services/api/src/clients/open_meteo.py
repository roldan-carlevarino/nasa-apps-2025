import httpx
import orjson
from ..config import AQ_URL, WX_ARCHIVE_URL, TIMEOUT_S, TIMEZONE, HOURLY_AQ_VARS, HOURLY_WX_VARS, MAX_CONNECTIONS, MAX_KEEPALIVE


def make_client() -> httpx.AsyncClient:
    limits = httpx.Limits(max_connections=MAX_CONNECTIONS, max_keepalive_connections=MAX_KEEPALIVE)
    return httpx.AsyncClient(limits=limits, timeout=TIMEOUT_S)


async def fetch_air_quality(client: httpx.AsyncClient, lat: float, lon: float, past_days: int, forecast_days: int) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(HOURLY_AQ_VARS),
        "current": ",".join(HOURLY_AQ_VARS),
        "past_days": past_days,
        "forecast_days": forecast_days,
        "timezone": TIMEZONE,
    }
    r = await client.get(AQ_URL, params=params)
    r.raise_for_status()
    return orjson.loads(r.content)


async def fetch_weather_history(client: httpx.AsyncClient, lat: float, lon: float, start_date: str, end_date: str) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": ",".join(HOURLY_WX_VARS),
        "timezone": TIMEZONE,
    }
    r = await client.get(WX_ARCHIVE_URL, params=params)
    r.raise_for_status()
    return orjson.loads(r.content)
