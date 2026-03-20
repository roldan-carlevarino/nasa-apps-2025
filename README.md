# Haze Guard

Visualizador web de calidad del aire y alertas de calima para municipios de España. Combina datos en tiempo real de [Open-Meteo](https://open-meteo.com/) con un mapa interactivo y un sistema de alertas por email.

## Estructura

```
services/
  api/   → API REST (FastAPI + Python)
  web/   → Frontend (React + Leaflet + Chart.js + Tailwind)
lib/
  dust-calima-model/              → Modelo de predicción de calima
  Air-Quality-Prediction-Model-main/ → Modelo de predicción de AQI
```

## Requisitos

- Python 3.11+
- Node.js 18+

---

## API (`services/api`)

### Instalación

```bash
cd services/api
python -m venv .venv
.venv\Scripts\activate       # Windows
# source .venv/bin/activate  # Mac/Linux
pip install -r requirements.txt
```

### Configuración

```bash
cp .env.example .env
# Edita .env con tus credenciales SMTP y demás variables
```

### Arrancar

```bash
uvicorn src.main:app --reload
```

La API quedará disponible en `http://localhost:8000`.  
Documentación interactiva: `http://localhost:8000/docs`

### Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Estado del servicio y número de suscriptores |
| `GET` | `/air-quality/keys` | Lista de claves de municipios disponibles |
| `POST` | `/air-quality/stations` | Datos de calidad del aire y meteorología |
| `POST` | `/subscribe` | Suscribirse a alertas por email |
| `POST` | `/trigger` | Enviar alerta manual (requiere token admin) |
| `POST` | `/calima/check` | Comprobar y disparar alerta de calima |

---

## Web (`services/web`)

### Instalación

```bash
cd services/web
npm install
```

### Arrancar en desarrollo

```bash
npm start
```

La app quedará disponible en `http://localhost:3000` y las llamadas a `/api` se redirigen automáticamente a la API en `http://localhost:8000`.

### Build de producción

```bash
npm run build
```

---

## Variables de entorno (API)

Ver [`services/api/.env.example`](services/api/.env.example) para la lista completa.

| Variable | Descripción | Por defecto |
|----------|-------------|-------------|
| `DATABASE_URL` | Cadena de conexión SQLAlchemy | `sqlite:///./data/subscriptions.db` |
| `ALERT_SMTP_HOST` | Servidor SMTP para emails | — |
| `ALERT_SMTP_USER` | Usuario SMTP | — |
| `ALERT_SMTP_PASS` | Contraseña SMTP | — |
| `ALERT_ADMIN_TOKEN` | Token para endpoints admin | — |
| `ALERT_DEV` | Si se define, desactiva el envío real de emails | — |
| `CALIMA_THRESHOLD` | Umbral PM2.5 (µg/m³) para alerta | `50` |
| `CALIMA_COOLDOWN_SECONDS` | Tiempo mínimo entre alertas | `1800` |
