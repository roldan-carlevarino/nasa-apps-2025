from pydantic import BaseModel, EmailStr, Field


# ── Alerts ──────────────────────────────────────────────────

class SubscribeRequest(BaseModel):
    email: EmailStr
    municipio: str | None = None

class TriggerRequest(BaseModel):
    subject: str
    body: str

class CalimaCheckRequest(BaseModel):
    max_pm25: float | None = Field(default=None)
    pm25_values: list[float] | None = Field(default=None)
    top_municipio: str | None = Field(default=None)
    predicted: bool | None = Field(default=None)


# ── Air Quality ─────────────────────────────────────────────

class StationRequest(BaseModel):
    """Request air quality for specific municipalities."""
    keys: list[str] = Field(description="List of 'comunidad|provincia|poblacion' keys")
    aq_past_days: int = 7
    aq_forecast_days: int = 0
    wx_past_days: int = 7
