"""
weather_job.py
---------------
Lógica del proceso de automatización (Fase 3: librerías del temario):
- requests   → obtención de datos vía API (Open-Meteo, sin API key)
- pandas + openpyxl → consolidar datos en Excel con varias hojas
- pathlib + shutil  → renombrar y mover ficheros a carpeta por fecha
- smtplib + email   → envío del informe por correo

Se invoca desde app.py (FastAPI) pasando la configuración del formulario.
También se puede ejecutar como CLI: `python weather_job.py`.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import smtplib
from dataclasses import dataclass, field
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


# ----------------------------------------------------------------------------
# Configuración global
# ----------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
RAW_DIR = BASE_DIR / "datos_raw"
OUTPUT_DIR = BASE_DIR / "informes_generados"
ARCHIVE_DIR = BASE_DIR / "archivo_informes"

logger = logging.getLogger("weather_job")


# Catálogo de ciudades disponibles para el formulario.
# (Coordenadas oficiales — fuente: GeoNames.)
AVAILABLE_CITIES: dict[str, tuple[float, float]] = {
    "Madrid": (40.4168, -3.7038),
    "Barcelona": (41.3874, 2.1686),
    "Valencia": (39.4699, -0.3763),
    "Sevilla": (37.3891, -5.9845),
    "Bilbao": (43.2630, -2.9350),
    "Zaragoza": (41.6488, -0.8891),
    "Málaga": (36.7213, -4.4214),
    "Palencia": (42.0096, -4.5288),  # cercana a Baños de Cerrato (caso del invernadero)
}


@dataclass
class Location:
    name: str
    latitude: float
    longitude: float


@dataclass
class JobConfig:
    """Configuración de una ejecución del job."""

    cities: list[str]
    forecast_days: int = 7
    # SMTP (opcional — si falta algo, no se envía email)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass: str = ""
    email_to: str = ""


@dataclass
class JobResult:
    """Resultado de la ejecución, devuelto a la API."""

    run_id: str
    excel_file: Path | None = None
    total_records: int = 0
    high_priority_days: int = 0
    cities_ok: list[str] = field(default_factory=list)
    cities_failed: list[dict[str, str]] = field(default_factory=list)
    email_sent: bool = False
    email_error: str | None = None
    log_lines: list[str] = field(default_factory=list)


# ----------------------------------------------------------------------------
# Sesión HTTP con reintentos (resiliencia ante fallos puntuales de la API)
# ----------------------------------------------------------------------------

def _build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


# ----------------------------------------------------------------------------
# Pasos del proceso
# ----------------------------------------------------------------------------

def ensure_folders() -> None:
    """Crea las carpetas de trabajo si no existen."""
    for folder in (RAW_DIR, OUTPUT_DIR, ARCHIVE_DIR):
        folder.mkdir(parents=True, exist_ok=True)


def fetch_weather(location: Location, session: requests.Session, forecast_days: int) -> dict[str, Any]:
    """Obtiene previsión diaria desde Open-Meteo (sin API key)."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": location.latitude,
        "longitude": location.longitude,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max",
        "timezone": "Europe/Madrid",
        "forecast_days": forecast_days,
    }
    response = session.get(url, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()
    data["location_name"] = location.name
    return data


def save_raw_json(data: dict[str, Any], location_name: str, run_id: str) -> Path:
    """Guarda la respuesta cruda de la API (auditoría / depuración)."""
    raw_file = RAW_DIR / f"raw_{location_name.lower()}_{run_id}.json"
    with raw_file.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return raw_file


def classify_day(temp_max: float, rain: float) -> tuple[str, str]:
    """
    Regla de negocio: prioridad y recomendación de riego.
    Función pura (testeable de forma aislada).
    """
    if temp_max >= 30 and rain < 2:
        return "Alta", "Revisar aumento de riego"
    if rain >= 5:
        return "Media", "Reducir riego / revisar drenaje"
    return "Baja", "Mantener estrategia actual"


def build_dataframe(all_data: list[dict[str, Any]]) -> pd.DataFrame:
    """Construye el DataFrame consolidado a partir de las respuestas de la API."""
    rows = []
    for item in all_data:
        city = item["location_name"]
        daily = item["daily"]
        for i, date in enumerate(daily["time"]):
            temp_max = daily["temperature_2m_max"][i]
            temp_min = daily["temperature_2m_min"][i]
            rain = daily["precipitation_sum"][i]
            wind = daily["windspeed_10m_max"][i]

            priority, recommendation = classify_day(temp_max, rain)

            rows.append({
                "ciudad": city,
                "fecha": date,
                "temp_max_c": temp_max,
                "temp_min_c": temp_min,
                "lluvia_mm": rain,
                "viento_max_kmh": wind,
                "prioridad": priority,
                "recomendacion": recommendation,
            })
    return pd.DataFrame(rows)


def export_excel(df: pd.DataFrame, run_id: str) -> Path:
    """Exporta el DataFrame a Excel con hoja de datos + hoja resumen."""
    output_file = OUTPUT_DIR / f"informe_clima_riego_{run_id}.xlsx"
    summary = (
        df.groupby(["ciudad", "prioridad"], as_index=False)
        .size()
        .rename(columns={"size": "dias"})
    )

    with pd.ExcelWriter(output_file, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Datos_API")
        summary.to_excel(writer, index=False, sheet_name="Resumen")

    return output_file


def move_files_to_archive(files: list[Path], run_id: str) -> list[Path]:
    """Mueve los ficheros a la carpeta del día. Si el nombre no contiene el run_id,
    se le añade como prefijo (caso de los JSON crudos que sí lo necesitan)."""
    dated_folder = ARCHIVE_DIR / datetime.now().strftime("%Y-%m-%d")
    dated_folder.mkdir(parents=True, exist_ok=True)

    moved = []
    for file_path in files:
        # Evitar duplicar el run_id si ya está en el nombre
        new_name = file_path.name if run_id in file_path.name else f"{run_id}_{file_path.name}"
        destination = dated_folder / new_name
        shutil.move(str(file_path), str(destination))
        moved.append(destination)
    return moved


def send_email_report(cfg: JobConfig, excel_file: Path, result: JobResult) -> None:
    """Envía el informe por email usando smtplib (TLS)."""
    if not all([cfg.smtp_host, cfg.smtp_user, cfg.smtp_pass, cfg.email_to]):
        logger.info("Email no enviado: faltan parámetros SMTP.")
        result.email_error = "Faltan parámetros SMTP"
        return

    msg = EmailMessage()
    msg["Subject"] = "Informe automático de clima y riego"
    msg["From"] = cfg.smtp_user
    msg["To"] = cfg.email_to

    body = (
        "Hola,\n\n"
        "El proceso automático ha finalizado correctamente.\n\n"
        f"Ciudades procesadas: {', '.join(result.cities_ok)}\n"
        f"Registros consolidados: {result.total_records}\n"
        f"Días con prioridad alta: {result.high_priority_days}\n"
        f"Archivo generado: {excel_file.name}\n\n"
    )
    if result.cities_failed:
        body += "Ciudades con error:\n"
        for f in result.cities_failed:
            body += f"  - {f['city']}: {f['error']}\n"
        body += "\n"
    body += "Se adjunta el informe Excel.\n\nUn saludo."

    msg.set_content(body)

    with excel_file.open("rb") as f:
        msg.add_attachment(
            f.read(),
            maintype="application",
            subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=excel_file.name,
        )

    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=30) as server:
        server.starttls()
        server.login(cfg.smtp_user, cfg.smtp_pass)
        server.send_message(msg)

    result.email_sent = True
    logger.info("Email enviado correctamente a %s", cfg.email_to)


# ----------------------------------------------------------------------------
# Orquestador
# ----------------------------------------------------------------------------

def run_job(cfg: JobConfig) -> JobResult:
    """Punto de entrada principal — invocado desde la API o desde CLI."""
    ensure_folders()
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    result = JobResult(run_id=run_id)

    # Validar ciudades
    locations = []
    for city in cfg.cities:
        if city not in AVAILABLE_CITIES:
            result.cities_failed.append({"city": city, "error": "Ciudad no soportada"})
            continue
        lat, lon = AVAILABLE_CITIES[city]
        locations.append(Location(city, lat, lon))

    if not locations:
        raise ValueError("No hay ciudades válidas para procesar")

    session = _build_session()
    raw_files: list[Path] = []
    all_data: list[dict[str, Any]] = []

    # 1) Obtener datos por API (con manejo de error por ciudad)
    for loc in locations:
        try:
            logger.info("Obteniendo datos de %s...", loc.name)
            data = fetch_weather(loc, session, cfg.forecast_days)
            all_data.append(data)
            raw_files.append(save_raw_json(data, loc.name, run_id))
            result.cities_ok.append(loc.name)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Fallo obteniendo datos de %s", loc.name)
            result.cities_failed.append({"city": loc.name, "error": str(exc)})

    if not all_data:
        raise RuntimeError("Todas las ciudades fallaron — no hay datos para informar")

    # 2) Consolidar en DataFrame y exportar a Excel
    df = build_dataframe(all_data)
    excel_file = export_excel(df, run_id)

    # 3) Renombrar y mover a archivo del día
    moved = move_files_to_archive(raw_files + [excel_file], run_id)
    final_excel = next(f for f in moved if f.suffix == ".xlsx")

    result.excel_file = final_excel
    result.total_records = len(df)
    result.high_priority_days = int((df["prioridad"] == "Alta").sum())

    # 4) Enviar email (si hay configuración)
    try:
        send_email_report(cfg, final_excel, result)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Fallo enviando email")
        result.email_error = str(exc)

    logger.info("Proceso completado. Informe: %s", final_excel)
    return result


# ----------------------------------------------------------------------------
# CLI (uso opcional sin frontend)
# ----------------------------------------------------------------------------

def _cli() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    cfg = JobConfig(
        cities=["Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao"],
        smtp_host=os.getenv("SMTP_HOST", ""),
        smtp_port=int(os.getenv("SMTP_PORT", "587")),
        smtp_user=os.getenv("SMTP_USER", ""),
        smtp_pass=os.getenv("SMTP_PASS", ""),
        email_to=os.getenv("EMAIL_TO", ""),
    )
    result = run_job(cfg)
    print(f"\nProceso completado. Informe: {result.excel_file}")
    print(f"Registros: {result.total_records} | Prioridad alta: {result.high_priority_days}")
    if result.cities_failed:
        print(f"Ciudades con error: {result.cities_failed}")


if __name__ == "__main__":
    _cli()
