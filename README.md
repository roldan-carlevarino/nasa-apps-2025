# Haze Guard

**Real-time air quality monitoring for 8,200+ Spanish municipalities.**

Built by [Rodrigo Roldan Carlevarino](https://github.com/roldan-carlevarino) and [Augusto Zerpa](https://github.com/v3natio) for the [NASA International Space Apps Challenge 2025](https://www.spaceappschallenge.org) — challenge: *"Cloud Computing with Earth Observation Data for Predicting Cleaner, Safer Skies"*.

**Live demo:** https://roldan-carlevarino.github.io/nasa-apps-2025  
**API docs:** https://nasa-apps-2025-production.up.railway.app/docs

---

## What it does

- **Interactive map** — all Spanish municipalities colored by current PM2.5 level, updated in real time from Open-Meteo
- **Particle vector layer** — animated PM2.5 spatial and temporal gradients across 16 reference stations
- **Historical time slider** — scrub through 7 days of hourly air quality data
- **ML calima predictor** — RandomForestClassifier (100 estimators) that outputs atmospheric risk probability (0–100%) based on dust, wind, humidity, and temperature
- **Email alert system** — subscribe to a municipality and receive alerts when air quality deteriorates

---

## Architecture

```
services/
  api/        FastAPI (Python) — deployed on Railway
  web/        React + Leaflet + Tailwind — deployed on GitHub Pages
lib/
  dust-calima-model/                Reference calima prediction model
  Air-Quality-Prediction-Model-main/ Reference AQI model
```

Data flows from **Open-Meteo API** → **FastAPI backend** (applies calima ML model, caches for 30 min) → **React frontend** (renders map, particles, popups).

---

## Running locally

### Requirements

- Python 3.11+
- Node.js 18+

### 1. API

```bash
cd services/api
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Mac/Linux
pip install -r requirements.txt
uvicorn src.main:app --reload
```

API available at `http://localhost:8000` — interactive docs at `http://localhost:8000/docs`.

No environment variables are required to run locally. The database defaults to SQLite (`data/subscriptions.db`, created automatically on first run). Email alerts are disabled unless SMTP variables are configured.

### 2. Frontend

```bash
cd services/web
npm install
npm start
```

App available at `http://localhost:3000`. Calls the API at `http://localhost:8000` by default — no configuration needed.

---

## API reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Service status, subscriber count, cache state |
| `GET` | `/air-quality/keys` | List all available municipality keys |
| `POST` | `/air-quality/stations` | Fetch air quality + weather + calima prediction |
| `POST` | `/alerts/subscribe` | Subscribe email to municipality alerts |
| `POST` | `/alerts/trigger` | Send alert manually (requires admin token) |

---

## Environment variables (API)

All optional for local development.

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | SQLAlchemy connection string | `sqlite:///./data/subscriptions.db` |
| `ALERT_SMTP_HOST` | SMTP server for outgoing email | — |
| `ALERT_SMTP_PORT` | SMTP port | `587` |
| `ALERT_SMTP_USER` | SMTP username | — |
| `ALERT_SMTP_PASS` | SMTP password | — |
| `ALERT_FROM` | Sender email address | — |
| `ALERT_ADMIN_TOKEN` | Token for admin endpoints | — |
| `ALERT_DEV` | Set to any value to disable real email sending | — |
| `CALIMA_THRESHOLD` | Risk probability threshold (%) for alerts | `50` |
| `CALIMA_COOLDOWN_SECONDS` | Minimum interval between alerts per municipality | `1800` |

---

## ML model

The calima predictor uses a `RandomForestClassifier` trained on 500 synthetic samples generated from the probabilistic rule:

$$P(\text{risk}) = \sigma\bigl(0.2(\text{dust}-10) - 0.05(\text{humidity}-50) - 0.1 \cdot \text{wind}\bigr)$$

Features: `dust` (μg/m³), `wind_speed_100m` (km/h), `relative_humidity_2m` (%), `temperature_2m` (°C).

The model predicts atmospheric particle risk — both Saharan dust events (calima) and wildfires produce elevated readings, which is the intended behavior. Validation against real labeled events is left as future work.

---

## Tech stack

| Layer | Technologies |
|-------|-------------|
| Backend | FastAPI, Python 3.13, SQLAlchemy, SQLite / PostgreSQL |
| Frontend | React 18, Leaflet, react-leaflet, Chart.js, Tailwind CSS |
| Data | Open-Meteo (no API key required) |
| Deployment | Railway (API), GitHub Pages (frontend) |

---

## License

MIT
