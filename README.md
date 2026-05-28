# 🌤️ Clima Automatización

> Proyecto de **Automatización de Procesos** — Universidad Nebrija
> Curso 2025–2026

Automatiza el proceso manual de consulta meteorológica que un analista agrícola realiza cada mañana para planificar el riego en distintas zonas de cultivo. Lo que antes tardaba **~20 minutos al día** (abrir varias webs del tiempo, anotar datos, volcarlos a Excel, decidir prioridades, enviar email) ahora se ejecuta en **menos de 15 segundos** pulsando un botón.

---

## 📊 Impacto

| Métrica              | Manual         | Automatizado    |
|----------------------|----------------|-----------------|
| Tiempo por ejecución | ~20 min        | < 15 seg        |
| Tasa de error        | 5–10%          | 0%              |
| Ciudades cubiertas   | 3–4 (límite humano) | 8 (escalable) |
| Reproducibilidad     | Baja           | Total           |
| Trazabilidad         | Ninguna        | Archivo por fecha |

---

## 🏗️ Stack (librerías del temario)

| Fase del proceso         | Recurso              | Librería              |
|--------------------------|----------------------|-----------------------|
| Obtención de datos       | API REST (Open-Meteo)| `requests`            |
| Consolidación en Excel   | DataFrame + hojas    | `pandas` + `openpyxl` |
| Renombrar y mover        | Sistema de ficheros  | `pathlib` + `shutil`  |
| Envío de informe         | Email SMTP           | `smtplib` + `email`   |
| Frontend / orquestación  | Aplicación web       | `FastAPI` + `uvicorn` |

---

## 🚀 Instalación y ejecución

### Requisitos previos

- **Python 3.10–3.12** ([descargar](https://www.python.org/downloads/)) — recomendado **3.12**. En Windows, evita 3.13/3.14: `pandas` aún no tiene *wheels* precompilados para esas versiones y la instalación intenta compilar y falla.
- Conexión a internet (la API de Open-Meteo es pública y gratuita, sin API key)

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/SubJ22/Clima_Automatizacion.git
cd Clima_Automatizacion

# 2. (Opcional pero recomendado) crear entorno virtual
python -m venv venv

# Activar el entorno virtual
# Windows (PowerShell):
venv\Scripts\Activate.ps1
# Windows (CMD):
venv\Scripts\activate.bat
# Linux / macOS:
source venv/bin/activate

# 3. Instalar dependencias
pip install -r requirements.txt

# 4. Lanzar la aplicación
python app.py
```

Abre el navegador en **http://127.0.0.1:8000** y listo.

---

## 🖱️ Uso

1. **Selecciona las ciudades** a consultar con los checkboxes (Madrid, Barcelona, Valencia, Sevilla, Bilbao, Zaragoza, Málaga, Palencia).
2. **Ajusta el horizonte de previsión** (entre 1 y 16 días).
3. **(Opcional) configura SMTP** si quieres recibir el Excel por email:
   - Servidor SMTP (p.ej. `smtp.gmail.com`)
   - Puerto (`587` para TLS)
   - Usuario (tu email)
   - Contraseña — **si usas Gmail, necesitas una App Password**, no tu contraseña normal: [cómo generarla](https://support.google.com/accounts/answer/185833)
   - Destinatario
4. Pulsa **Lanzar informe**.

Mientras se genera el informe, el formulario se aparta y aparece una **visualización a pantalla completa**: un mapa de España donde la cámara recorre, una a una, todas las ciudades seleccionadas, con un panel de progreso (`en cola` → `consultando…` → `listo`) y un contador de ciudades procesadas.

### Qué hace el sistema en ese clic

1. Consulta la API de Open-Meteo para cada ciudad seleccionada (con reintentos automáticos en caso de fallo puntual)
2. Aplica la regla de negocio de prioridad de riego
3. Consolida los datos en un Excel con dos hojas: `Datos_API` y `Resumen`
4. Renombra los ficheros con un `run_id` único y los archiva en `archivo_informes/YYYY-MM-DD/`
5. Envía el email con el Excel adjunto (si configuraste SMTP)
6. Muestra el resultado en pantalla con descarga directa del Excel

### Modo CLI (sin frontend)

Si prefieres ejecutarlo desde la terminal sin abrir el navegador:

```bash
# (Opcional) variables de entorno para el email
# Windows PowerShell:
$env:SMTP_HOST="smtp.gmail.com"
$env:SMTP_USER="tu_email@gmail.com"
$env:SMTP_PASS="tu_app_password"
$env:EMAIL_TO="destino@empresa.com"

# Linux / macOS:
export SMTP_HOST=smtp.gmail.com
export SMTP_USER=tu_email@gmail.com
export SMTP_PASS=tu_app_password
export EMAIL_TO=destino@empresa.com

python weather_job.py
```

---

## 📁 Estructura del proyecto
Clima_Automatizacion/
├── app.py                    # FastAPI: API + servidor de estáticos
├── weather_job.py            # Lógica del proceso de automatización
├── requirements.txt          # Dependencias Python
├── presentacion.pptx         # Presentación del proyecto
├── README.md                 # Este fichero
├── .gitignore
├── static/
│   ├── index.html            # Formulario web
│   ├── style.css             # Tema naranja/azul (cielo & sol)
│   └── script.js             # Lógica del cliente
├── datos_raw/                # JSONs crudos (auto-generado, no se commitea)
├── informes_generados/       # Excel pre-archivo (auto-generado)
└── archivo_informes/         # Archivo final por fecha (auto-generado)
└── 2026-05-27/
├── 20260527_103045_raw_madrid.json
└── 20260527_103045_informe_clima_riego.xlsx

---

## 🧠 Lógica de negocio

La regla que decide la prioridad de riego para cada día y ciudad:

| Condición                              | Prioridad | Recomendación                          |
|----------------------------------------|-----------|----------------------------------------|
| Temp máx ≥ 30°C **y** lluvia < 2 mm    | **Alta**  | Revisar aumento de riego               |
| Lluvia ≥ 5 mm                          | **Media** | Reducir riego / revisar drenaje        |
| Resto de casos                         | **Baja**  | Mantener estrategia actual             |

La función `classify_day(temp_max, rain)` en `weather_job.py` es una **función pura** sin efectos secundarios — fácil de testear sin red, sin Excel y sin SMTP.

---

## 🛡️ Robustez

- **Reintentos automáticos** (3 con backoff exponencial) en cada llamada a la API
- **Tolerancia a fallos por ciudad**: si una ciudad falla, el resto continúa y el fallo se reporta en la respuesta
- **Email desacoplado**: si SMTP falla o no está configurado, el Excel sigue disponible para descarga
- **Logging con timestamps** en cada paso del proceso

---

## 🌐 API endpoints

| Método | Endpoint              | Descripción                                  |
|--------|-----------------------|----------------------------------------------|
| GET    | `/`                   | Frontend (formulario)                        |
| GET    | `/cities`             | Lista de ciudades disponibles (JSON)         |
| POST   | `/run`                | Lanza el job de automatización               |
| GET    | `/download/{fichero}` | Descarga directa del Excel generado          |

---

## 👥 Autores

- **Bruno** ([@hibrusi-dev](https://github.com/hibrusi-dev))
- **SubJ22** ([@SubJ22](https://github.com/SubJ22))

Asignatura: **Automatización de Procesos**
Profesor: Francisco
Universidad Nebrija — Curso 2025/2026

---

## 📜 Licencia

Proyecto académico. Uso libre para fines educativos.
