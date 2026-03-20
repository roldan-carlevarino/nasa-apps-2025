# Dust Calima Model

Ejemplo de modelo para predecir eventos de 'calima' (polvo en suspensión) usando la variable `dust` y otras variables meteorológicas sintéticas.

Archivos:
- `calima_prediction.py`: script principal que entrena un RandomForestClassifier sobre datos sintéticos y muestra métricas.
- `requirements.txt`: dependencias necesarias.

Uso:
1. Crear un entorno virtual.
2. Instalar dependencias: `pip install -r requirements.txt`
3. Ejecutar: `python calima_prediction.py`

Notas:
- Si tienes datos reales, reemplaza la sección de generación sintética por `pd.read_csv()` o cargar la fuente correspondiente y asegúrate de que la columna `calima` exista (0/1) o conviértela usando un umbral sobre `dust`.
