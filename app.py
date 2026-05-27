"""
app.py
-------
Backend FastAPI:
  - GET  /            → sirve el frontend (static/index.html)
  - GET  /cities      → catálogo de ciudades disponibles
  - POST /run         → lanza el job con la configuración del formulario
  - GET  /download/{} → descarga el Excel generado

Ejecución local:
    pip install -r requirements.txt
    python app.py
    → abrir http://127.0.0.1:8000
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

from weather_job import (
    AVAILABLE_CITIES,
    ARCHIVE_DIR,
    JobConfig,
    run_job,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("app")

app = FastAPI(title="Informe Clima — Automatización", version="1.0")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"


# ----------------------------------------------------------------------------
# Modelos del request
# ----------------------------------------------------------------------------

class RunRequest(BaseModel):
    cities: list[str] = Field(..., min_length=1, description="Ciudades a consultar")
    forecast_days: int = Field(7, ge=1, le=16)
    # SMTP — opcional
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass: str = ""
    email_to: str | None = None


class RunResponse(BaseModel):
    ok: bool
    run_id: str
    total_records: int
    high_priority_days: int
    cities_ok: list[str]
    cities_failed: list[dict[str, str]]
    excel_filename: str | None
    email_sent: bool
    email_error: str | None = None


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------

@app.get("/cities")
def get_cities() -> dict[str, list[str]]:
    """Devuelve el catálogo de ciudades disponibles para el formulario."""
    return {"cities": list(AVAILABLE_CITIES.keys())}


@app.post("/run", response_model=RunResponse)
def run(req: RunRequest) -> RunResponse:
    """Ejecuta el job de automatización y devuelve el resultado."""
    cfg = JobConfig(
        cities=req.cities,
        forecast_days=req.forecast_days,
        smtp_host=req.smtp_host,
        smtp_port=req.smtp_port,
        smtp_user=req.smtp_user,
        smtp_pass=req.smtp_pass,
        email_to=req.email_to or "",
    )
    try:
        result = run_job(cfg)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Fallo en run_job")
        raise HTTPException(status_code=500, detail=str(exc))

    return RunResponse(
        ok=True,
        run_id=result.run_id,
        total_records=result.total_records,
        high_priority_days=result.high_priority_days,
        cities_ok=result.cities_ok,
        cities_failed=result.cities_failed,
        excel_filename=result.excel_file.name if result.excel_file else None,
        email_sent=result.email_sent,
        email_error=result.email_error,
    )


@app.get("/download/{filename}")
def download(filename: str) -> FileResponse:
    """Devuelve el fichero Excel generado para descarga directa."""
    # Buscar en cualquier subcarpeta de archivo_informes/
    for sub in ARCHIVE_DIR.iterdir():
        if sub.is_dir():
            candidate = sub / filename
            if candidate.exists():
                return FileResponse(
                    candidate,
                    media_type=(
                        "application/vnd.openxmlformats-officedocument."
                        "spreadsheetml.sheet"
                    ),
                    filename=filename,
                )
    raise HTTPException(status_code=404, detail="Fichero no encontrado")


# Servir el frontend estático en /
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
