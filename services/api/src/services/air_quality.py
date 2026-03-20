import asyncio
import polars as pl
from datetime import datetime, timedelta

from ..config import REGISTRY_CSV
from ..clients.open_meteo import make_client, fetch_air_quality, fetch_weather_history

_registry: pl.DataFrame | None = None


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

    return {
        "key": key,
        "comunidad": row["Comunidad"],
        "provincia": row["Provincia"],
        "municipio": row["Población"],
        "lat": lat,
        "lon": lon,
        "air_quality": aq_data,
        "weather": wx_data,
    }
