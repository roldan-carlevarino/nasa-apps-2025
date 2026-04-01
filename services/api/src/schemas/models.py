from pydantic import BaseModel, EmailStr, Field


# ── Alerts ──────────────────────────────────────────────────

class SubscribeRequest(BaseModel):
    email: EmailStr
    municipio: str | None = None

class TriggerRequest(BaseModel):
    subject: str = Field(..., max_length=200)
    body: str = Field(..., max_length=5000)

class CalimaCheckRequest(BaseModel):
    max_pm25: float | None = Field(default=None)
    pm25_values: list[float] | None = Field(default=None)
    top_municipio: str | None = Field(default=None)
    predicted: bool | None = Field(default=None)


# ── Air Quality ─────────────────────────────────────────────

class StationRequest(BaseModel):
    """Request air quality for specific municipalities."""
    keys: list[str] = Field(..., description="List of 'comunidad|provincia|poblacion' keys", min_length=1, max_length=60)
    aq_past_days: int = Field(default=7, ge=1, le=14)
    aq_forecast_days: int = Field(default=0, ge=0, le=3)
    wx_past_days: int = Field(default=7, ge=1, le=14)
