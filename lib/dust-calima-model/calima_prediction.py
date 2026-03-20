import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report

"""
Script de ejemplo para predecir 'calima' (evento de polvo) usando una variable 'dust'.
genera datos sintéticos si no hay datos reales disponibles.
Entrada esperada (DataFrame): columnas ['dust', ...otras features opcionales...]
Salida: etiqueta 'calima' (0/1) indicando ausencia/presencia.
"""

# generar datos sintéticos
np.random.seed(42)
N = 200
# 'dust' en microgramos/m3 u otra escala - simulamos valores
dust = np.random.gamma(shape=2.0, scale=5.0, size=N)
# otras variables meteorológicas útiles ????
wind = np.random.uniform(0, 10, size=N)  # m/s
humidity = np.random.uniform(10, 90, size=N)  # %
temp = np.random.uniform(5, 35, size=N)  # °C

# generar etiqueta 'calima' determinística con ruido: alta dust y baja humedad ????
prob_calima = 1 / (1 + np.exp(-(0.2 * (dust - 10) - 0.05 * (humidity - 50) - 0.1 * wind)))
calima = (np.random.rand(N) < prob_calima).astype(int)

df = pd.DataFrame({'dust': dust, 'wind': wind, 'humidity': humidity, 'temp': temp, 'calima': calima})

print("Primeras filas del dataset sintético:")
print(df.head())

# features
X = df[['dust', 'wind', 'humidity', 'temp']]
y = df['calima']

# split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=0)

# concetti
model = RandomForestClassifier(n_estimators=100, random_state=0)
model.fit(X_train, y_train)

# predicción
y_pred = model.predict(X_test)
acc = accuracy_score(y_test, y_pred)
print(f"\nAccuracy: {acc:.3f}")
print("\nClassification report:")
print(classification_report(y_test, y_pred))

# esempio
new = pd.DataFrame({'dust': [5, 30, 15], 'wind': [3, 1, 5], 'humidity': [60, 15, 40], 'temp': [20, 28, 18]})
print("\nEjemplo de predicciones (0=no calima, 1=calima):")
print(new)
print(model.predict(new))
