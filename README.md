# SICOP – Consolidación y reportes

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/streamlit run app.py          # dashboard
.venv/bin/python -m sicop.cli a.xlsx b.xlsx -o reporte.pdf   # solo PDF
.venv/bin/python -m unittest discover tests                  # tests
```
Reglas: Vencido ≤ 0 días · Por vencer 1–15 · Pendiente = indicador `1` a la izquierda de la fecha · Al día > 15.
La empresa se toma del nombre del archivo (texto previo a " F-1").
