import asyncio
import polars as pl
from datetime import datetime, timedelta

from ..config import REGISTRY_CSV
from ..clients.open_meteo import make_client, fetch_air_quality, fetch_weather_history
from .calima_model import predict_calima

_registry: pl.DataFrame | None = None

# ── In-memory cache ─────────────────────────────────────────
# Structure: { cache_key: {"data": [...], "expires_at": datetime} }
_cache: dict = {}
CACHE_TTL_SECONDS = 1800  # 30 minutes


def _make_cache_key(keys: list[str], aq_past_days: int, aq_forecast_days: int, wx_past_days: int) -> str:
    return "|".join(sorted(keys)) + f"#{aq_past_days}#{aq_forecast_days}#{wx_past_days}"


def _get_cached(cache_key: str) -> list[dict] | None:
    entry = _cache.get(cache_key)
    if entry and datetime.utcnow() < entry["expires_at"]:
        return entry["data"]
    if entry:
        del _cache[cache_key]  # expired, remove
    return None


def _set_cache(cache_key: str, data: list[dict]) -> None:
    _cache[cache_key] = {
        "data": data,
        "expires_at": datetime.utcnow() + timedelta(seconds=CACHE_TTL_SECONDS),
    }


def _load_registry() -> pl.DataFrame:
    global _registry
    if _registry is None:
        _registry = pl.read_csv(REGISTRY_CSV, encoding="utf8")
    return _registry


def get_all_keys() -> list[str]:
    df = _load_registry()
    return [
        f"{r['Comunidad']}|{r['Provincia']}|{r['Población']}"
        for r in df.iter_rows(named=True)
    ]


async def fetch_stations(
    keys: list[str],
    aq_past_days: int,
    aq_forecast_days: int,
    wx_past_days: int,
) -> list[dict]:
    cache_key = _make_cache_key(keys, aq_past_days, aq_forecast_days, wx_past_days)
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached
    df = _load_registry()

    lookup: dict[str, dict] = {
        f"{r['Comunidad']}|{r['Provincia']}|{r['Población']}": r
        for r in df.iter_rows(named=True)
    }

    for k in keys:
        if k not in lookup:
            raise KeyError(f"Municipality key not found: {k}")

    today = datetime.utcnow().date()
    wx_end = today - timedelta(days=1)
    wx_start = wx_end - timedelta(days=max(wx_past_days - 1, 0))

    async with make_client() as client:
        tasks = [
            _fetch_one(
                client, key, lookup[key],
                aq_past_days, aq_forecast_days,
                wx_start.isoformat(), wx_end.isoformat(),
            )
            for key in keys
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    out = []
    for key, result in zip(keys, results):
        if isinstance(result, Exception):
            out.append({"key": key, "error": str(result)})
        else:
            out.append(result)

    _set_cache(cache_key, out)
    return out


async def _fetch_one(
    client, key: str, row: dict,
    aq_past_days: int, aq_forecast_days: int,
    wx_start: str, wx_end: str,
) -> dict:
    lat = float(row["Latitud"])
    lon = float(row["Longitud"])

    aq_data, wx_data = await asyncio.gather(
        fetch_air_quality(client, lat, lon, aq_past_days, aq_forecast_days),
        fetch_weather_history(client, lat, lon, wx_start, wx_end),
    )

    calima_prediction = _compute_calima_prediction(aq_data, wx_data)

    return {
        "key": key,
        "comunidad": row["Comunidad"],
        "provincia": row["Provincia"],
        "municipio": row["Población"],
        "lat": lat,
        "lon": lon,
        "air_quality": aq_data,
        "weather": wx_data,
        "calima_prediction": calima_prediction,
    }


def _latest(series: list | None) -> float | None:
    """Return the last non-null value in a list, or None."""
    if not series:
        return None
    for v in reversed(series):
        if v is not None:
            return float(v)
    return None


def _compute_calima_prediction(aq_data: dict, wx_data: dict) -> dict | None:
    """Extract current feature values and run the calima model."""
    try:
        # Prefer current values from the air-quality response; fall back to latest hourly
        aq_current = aq_data.get("current", {}) or {}
        dust = aq_current.get("dust")
        if dust is None:
            dust = _latest((aq_data.get("hourly") or {}).get("dust"))

        hourly_wx = wx_data.get("hourly") or {}
        wind = _latest(hourly_wx.get("wind_speed_100m"))
        humidity = _latest(hourly_wx.get("relative_humidity_2m"))
        temp = _latest(hourly_wx.get("temperature_2m"))

        if any(v is None for v in (dust, wind, humidity, temp)):
            return None

        return predict_calima(dust, wind, humidity, temp)
    except Exception:
        return None
