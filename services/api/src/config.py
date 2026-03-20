import os
from dotenv import load_dotenv

load_dotenv()

# ── Open-Meteo ──────────────────────────────────────────────
AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WX_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
TIMEOUT_S = 20
MAX_CONNECTIONS = 100
MAX_KEEPALIVE = 40
TIMEZONE = "UTC"

HOURLY_AQ_VARS = [
    "pm10", "pm2_5", "carbon_monoxide", "carbon_dioxide",
    "nitrogen_dioxide", "sulphur_dioxide", "ozone",
    "aerosol_optical_depth", "dust", "uv_index", "uv_index_clear_sky",
]
HOURLY_WX_VARS = [
    "temperature_2m", "relative_humidity_2m",
    "wind_speed_100m", "wind_direction_100m",
]

AQ_PAST_DAYS = 7
AQ_FORECAST_DAYS = 0
WX_PAST_DAYS = 7

# ── Alerts ──────────────────────────────────────────────────
ALERT_ADMIN_TOKEN = os.getenv("ALERT_ADMIN_TOKEN")
ALERT_DEV = bool(os.getenv("ALERT_DEV"))

SMTP_HOST = os.getenv("ALERT_SMTP_HOST")
SMTP_PORT = int(os.getenv("ALERT_SMTP_PORT", "587"))
SMTP_USER = os.getenv("ALERT_SMTP_USER")
SMTP_PASS = os.getenv("ALERT_SMTP_PASS")
SMTP_FROM = os.getenv("ALERT_FROM")
SMTP_SECURE = os.getenv("ALERT_SMTP_SECURE", "starttls").lower()

CALIMA_THRESHOLD = float(os.getenv("CALIMA_THRESHOLD", "50"))
CALIMA_COOLDOWN_SECONDS = int(os.getenv("CALIMA_COOLDOWN_SECONDS", "1800"))

# ── Data ────────────────────────────────────────────────────
REGISTRY_CSV = os.path.join(os.path.dirname(__file__), "..", "data", "municipios.csv")

# ── Database ────────────────────────────────────────────────
_db_url = os.getenv("DATABASE_URL", "sqlite:///./data/subscriptions.db")
# Railway uses 'postgres://' but SQLAlchemy needs 'postgresql://'
DATABASE_URL = _db_url.replace("postgres://", "postgresql://", 1) if _db_url.startswith("postgres://") else _db_url
