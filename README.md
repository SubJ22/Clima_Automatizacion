# Informe automático de clima · Automatización de Procesos

Proyecto de la asignatura **Automatización de Procesos** (Universidad Nebrija).

Automatiza un proceso manual de consulta meteorológica que un analista de campo
realiza cada mañana para planificar el riego en distintas zonas. Lo que antes
tardaba ~20 minutos al día (abrir varias webs del tiempo, anotar valores,
copiarlos a Excel, decidir prioridades, mandar email al equipo) se ejecuta ahora
en segundos pulsando un botón.

---

## Stack (librerías del temario)

| Fase | Recurso | Librería usada |
|------|---------|----------------|
| Obtención de datos | API REST (Open-Meteo) | `requests` |
| Consolidación en Excel | Excel + hojas | `pandas` + `openpyxl` |
| Renombrar + mover | Sistema de ficheros | `pathlib` + `shutil` |
| Envío de informe | Email SMTP | `smtplib` + `email` |
| Frontend / orquestación | Aplicación web | `FastAPI` + HTML/CSS/JS |

---

## Instalación

Requisitos: **Python 3.10+**

```bash
# 1. Clonar / descomprimir el proyecto
cd proyecto

# 2. (Opcional) crear entorno virtual
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux / Mac:
source venv/bin/activate

# 3. Instalar dependencias
pip install -r requirements.txt
```

---

## Ejecución

```bash
python app.py
```

Abrir el navegador en **http://127.0.0.1:8000**.

### Uso

1. Selecciona las ciudades a consultar (Madrid, Barcelona, Palencia, etc.).
2. Ajusta el horizonte de previsión (1–16 días).
3. (Opcional) introduce los datos SMTP para recibir el Excel por email.
   - Si usas Gmail: necesitas una **App Password**
     (ajustes de Google → Seguridad → Contraseñas de aplicaciones).
4. Pulsa **Lanzar informe**.

El sistema:
- Consulta Open-Meteo para cada ciudad
- Aplica la regla de negocio de prioridad de riego
- Genera un Excel con dos hojas (`Datos_API` y `Resumen`)
- Mueve los ficheros a `archivo_informes/YYYY-MM-DD/`
- Envía el email con el Excel adjunto (si hay SMTP)
- Muestra el resultado en pantalla con enlace de descarga directa

### Modo CLI (sin frontend)

```bash
# Con variables de entorno opcionales para email
export SMTP_HOST=smtp.gmail.com
export SMTP_USER=tu_email@gmail.com
export SMTP_PASS=app_password
export EMAIL_TO=destino@empresa.com
python weather_job.py
```

---

## Estructura del proyecto

```
proyecto/
├── app.py                  # FastAPI: API + servidor de estáticos
├── weather_job.py          # Lógica del proceso de automatización
├── requirements.txt
├── README.md
├── static/
│   ├── index.html          # Formulario
│   ├── style.css           # Tema naranja/azul
│   └── script.js           # Lógica del cliente
├── datos_raw/              # JSONs crudos (se crea automáticamente)
├── informes_generados/     # Excel antes de archivar
└── archivo_informes/       # Archivo final por fecha
    └── 2026-05-27/
        ├── 20260527_103045_raw_madrid_*.json
        └── 20260527_103045_informe_clima_riego_*.xlsx
```

---

## Lógica de negocio

| Condición | Prioridad | Recomendación |
|-----------|-----------|---------------|
| Temp máx ≥ 30°C y lluvia < 2mm | **Alta** | Revisar aumento de riego |
| Lluvia ≥ 5mm | **Media** | Reducir riego / revisar drenaje |
| Resto | **Baja** | Mantener estrategia actual |

---

## Medición de impacto

| Métrica | Manual | Automatizado |
|---------|--------|--------------|
| Tiempo por ejecución | ~20 min | < 15 seg |
| Tasa de error | 5–10% (transcripción) | 0% |
| Ciudades cubiertas | 3–4 (límite de tiempo) | 8 (escalable) |
| Reproducibilidad | Baja | Total |
