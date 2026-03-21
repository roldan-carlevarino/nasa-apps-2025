"""
Calima (Saharan dust event) prediction model.

Trains a RandomForestClassifier on synthetic data generated from the same
probabilistic rule used in lib/dust-calima-model/calima_prediction.py.
Features match variables available from Open-Meteo:
  dust         — atmospheric dust concentration (μg/m³)
  wind         — wind speed at 100 m (km/h)
  humidity     — relative humidity at 2 m (%)
  temp         — air temperature at 2 m (°C)
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

_model: RandomForestClassifier | None = None
_FEATURES = ["dust", "wind", "humidity", "temp"]


def _train_model() -> RandomForestClassifier:
    np.random.seed(42)
    N = 500
    dust = np.random.gamma(shape=2.0, scale=5.0, size=N)
    wind = np.random.uniform(0, 10, size=N)
    humidity = np.random.uniform(10, 90, size=N)
    temp = np.random.uniform(5, 35, size=N)
    # Logistic rule from the original model script
    prob_calima = 1 / (1 + np.exp(-(0.2 * (dust - 10) - 0.05 * (humidity - 50) - 0.1 * wind)))
    calima = (np.random.rand(N) < prob_calima).astype(int)
    df = pd.DataFrame({"dust": dust, "wind": wind, "humidity": humidity, "temp": temp, "calima": calima})
    X_train, _, y_train, _ = train_test_split(df[_FEATURES], df["calima"], test_size=0.2, random_state=0)
    clf = RandomForestClassifier(n_estimators=100, random_state=0)
    clf.fit(X_train, y_train)
    return clf


def _get_model() -> RandomForestClassifier:
    global _model
    if _model is None:
        _model = _train_model()
    return _model


def predict_calima(dust: float, wind: float, humidity: float, temp: float) -> dict:
    """Return calima classification and probability for a single observation."""
    model = _get_model()
    X = pd.DataFrame([[dust, wind, humidity, temp]], columns=_FEATURES)
    prediction = int(model.predict(X)[0])
    probability = float(model.predict_proba(X)[0][1])
    return {"calima": bool(prediction), "probability": round(probability, 3)}
