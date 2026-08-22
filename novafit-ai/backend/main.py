"""
Novafit AI — Backend Nivel 3 (AI Virtual Try-On fotorrealista)

Qué hace este servicio, honestamente:
  - Recibe una foto de la persona + el id de una prenda del catálogo.
  - Llama a un modelo de difusión (IDM-VTON) para generar el resultado
    fotorrealista. Soporta DOS proveedores intercambiables vía la variable
    de entorno PROVIDER:

      PROVIDER=huggingface (por defecto, GRATIS)
        Usa la demo pública de yisol/IDM-VTON en Hugging Face Spaces,
        corriendo sobre ZeroGPU (GPU compartida subvencionada por HF).
        LIMITACIONES REALES: puede haber cola (a veces minutos), el Space es
        mantenido por un tercero y puede estar caído/pausado sin aviso, y el
        modelo tiene licencia CC BY-NC-SA 4.0 — SOLO USO NO COMERCIAL.

      PROVIDER=replicate (de pago, ~$0.024 usd/generación)
        Mismo modelo IDM-VTON pero alojado de forma dedicada en Replicate.
        Sin cola compartida, disponibilidad mucho más confiable, apto para
        producción/uso comercial (revisa igual los términos del modelo).

  - Devuelve la imagen generada (URL o archivo, según el proveedor).

Qué NO hace en ningún caso:
  - No es tiempo real (~15-30s por generación, más si hay cola en el modo
    gratuito).
  - No corre "gratis de verdad y sin límites" — alguien siempre paga la GPU;
    en el modo gratuito ese "alguien" es Hugging Face vía ZeroGPU, con cuotas
    y disponibilidad de terceros, no garantizadas.
"""
import base64
import json
import mimetypes
import os
import tempfile
from pathlib import Path
from typing import Optional

import asyncio
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

PROVIDER = os.environ.get("PROVIDER", "huggingface").strip().lower()

REPLICATE_API_TOKEN = os.environ.get("REPLICATE_API_TOKEN", "").strip()
REPLICATE_MODEL = "cuuupid/idm-vton"
REPLICATE_BASE_URL = "https://api.replicate.com/v1"

# Space público que corre IDM-VTON gratis sobre ZeroGPU. Si este Space
# estuviera caído, hay duplicados de la comunidad que exponen la misma app
# (mismo modelo, mismo formato de API) — puedes cambiar esto sin tocar el
# resto del código: kadirnar/IDM-VTON, jjlealse/IDM-VTON, AI-Platform/Virtual-Try-On.
HF_SPACE_ID = os.environ.get("HF_SPACE_ID", "yisol/IDM-VTON").strip()
HF_TOKEN = os.environ.get("HF_TOKEN", "").strip() or None  # opcional: mejora la cuota de ZeroGPU

# Carpeta de prendas del frontend — reutilizamos las mismas imágenes y el
# mismo catalog.json UNIFICADO que ya usa el MVP Nivel 1/2 (multi-categoría:
# camisetas, camisas, chaquetas, hoodies, jeans), para no duplicar datos.
GARMENTS_ROOT = Path(__file__).resolve().parent.parent / "garments"
_CATALOG_CACHE = None


def _load_catalog() -> dict:
    """Carga garments/catalog.json una sola vez y lo cachea en memoria."""
    global _CATALOG_CACHE
    if _CATALOG_CACHE is None:
        with open(GARMENTS_ROOT / "catalog.json", "r", encoding="utf-8") as f:
            _CATALOG_CACHE = json.load(f)
    return _CATALOG_CACHE


def _find_garment_entry(garment_id: str) -> dict:
    for item in _load_catalog()["items"]:
        if item["id"] == garment_id:
            return item
    raise HTTPException(status_code=404, detail=f"Prenda no encontrada en el catálogo: {garment_id}")

app = FastAPI(title="Novafit AI — VTO Backend", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PhotorealRequest(BaseModel):
    person_image_base64: str  # data URI completo, ej: "data:image/png;base64,...."
    garment_id: str
    garment_description: Optional[str] = None  # ej: "Basic Black Tee, algodón"


class PhotorealResponse(BaseModel):
    status: str
    image_url: Optional[str] = None
    image_base64: Optional[str] = None
    provider: Optional[str] = None
    prediction_id: Optional[str] = None
    error: Optional[str] = None


def _garment_path(garment_id: str) -> Path:
    entry = _find_garment_entry(garment_id)
    # entry["image"] es una ruta relativa a la raíz del proyecto, ej.
    # "garments/jackets/olive.png" — la resolvemos contra la raíz real.
    path = GARMENTS_ROOT.parent / entry["image"]
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Archivo de prenda no encontrado en disco: {entry['image']}")
    return path


def _load_garment_bytes(garment_id: str) -> bytes:
    return _garment_path(garment_id).read_bytes()


def _data_uri_to_bytes(data_uri: str) -> bytes:
    if "," in data_uri and data_uri.strip().startswith("data:"):
        data_uri = data_uri.split(",", 1)[1]
    return base64.b64decode(data_uri)


def _load_garment_as_data_uri(garment_id: str) -> str:
    path = _garment_path(garment_id)
    mime, _ = mimetypes.guess_type(str(path))
    mime = mime or "image/png"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


# ─────────────────────────────────────────────────────────────────────────
# PROVIDER: Hugging Face Spaces (gratis, vía gradio_client)
# ─────────────────────────────────────────────────────────────────────────
def _run_huggingface_tryon_sync(person_bytes: bytes, garment_bytes: bytes, garment_des: str) -> bytes:
    """
    Llama al Space público de IDM-VTON usando gradio_client. Es una llamada
    SÍNCRONA y bloqueante (así es como funciona gradio_client), por eso se
    ejecuta en threadpool desde el endpoint async (ver run_in_threadpool).

    Si esta función empieza a fallar porque Hugging Face cambió la firma del
    Space, el primer paso para diagnosticar es correr en una consola Python:
        from gradio_client import Client
        Client("yisol/IDM-VTON").view_api()
    eso imprime el contrato de entrada/salida real y actualizado del Space.
    """
    from gradio_client import Client, handle_file

    with tempfile.TemporaryDirectory() as tmp:
        person_path = os.path.join(tmp, "person.png")
        garment_path = os.path.join(tmp, "garment.png")
        with open(person_path, "wb") as f:
            f.write(person_bytes)
        with open(garment_path, "wb") as f:
            f.write(garment_bytes)

        client = Client(HF_SPACE_ID, token=HF_TOKEN)

        result = client.predict(
            {"background": handle_file(person_path), "layers": [], "composite": handle_file(person_path)},
            handle_file(garment_path),
            garment_des,
            True,   # is_checked -> auto-mask automático del torso
            False,  # is_checked_crop -> no recortar automáticamente
            30,     # denoise_steps
            42,     # seed
            api_name="/tryon",
        )

        # El Space devuelve típicamente una tupla (imagen_resultado, imagen_mascara);
        # nos interesa el primer elemento, que es una ruta local a la imagen generada.
        output_path = result[0] if isinstance(result, (list, tuple)) else result
        with open(output_path, "rb") as f:
            return f.read()


async def _generate_via_huggingface(person_bytes: bytes, garment_bytes: bytes, garment_des: str) -> bytes:
    try:
        return await run_in_threadpool(
            _run_huggingface_tryon_sync, person_bytes, garment_bytes, garment_des
        )
    except Exception as exc:  # las excepciones de gradio_client son variadas (cola, timeout, cambios de API)
        raise HTTPException(
            status_code=502,
            detail=(
                f"El Space gratuito de Hugging Face ({HF_SPACE_ID}) falló o no respondió: {exc}. "
                "Puede estar saturado, pausado, o haber cambiado su API. Prueba de nuevo en unos "
                "minutos, cambia HF_SPACE_ID en backend/.env por otro duplicado del modelo, o usa "
                "PROVIDER=replicate para el camino de pago (más confiable)."
            ),
        )


# ─────────────────────────────────────────────────────────────────────────
# PROVIDER: Replicate (de pago, ver sección Nivel 3 del README)
# ─────────────────────────────────────────────────────────────────────────
def _require_replicate_token():
    if not REPLICATE_API_TOKEN:
        raise HTTPException(
            status_code=500,
            detail=(
                "PROVIDER=replicate pero falta REPLICATE_API_TOKEN. Genera uno en "
                "replicate.com/account/api-tokens y colócalo en backend/.env."
            ),
        )


async def _create_replicate_prediction(human_data_uri: str, garment_data_uri: str, garment_des: str, category: str) -> dict:
    payload = {
        "input": {
            "human_img": human_data_uri,
            "garm_img": garment_data_uri,
            "garment_des": garment_des,
            "category": category,  # "upper_body" | "lower_body" — según la prenda (ver catalog.json -> region)
            "crop": False,
            "steps": 30,
        }
    }
    headers = {
        "Authorization": f"Token {REPLICATE_API_TOKEN}",
        "Content-Type": "application/json",
        "Prefer": "wait=25",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{REPLICATE_BASE_URL}/models/{REPLICATE_MODEL}/predictions",
            json=payload,
            headers=headers,
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(
            status_code=502,
            detail=f"Replicate rechazó la solicitud ({resp.status_code}): {resp.text[:500]}",
        )
    return resp.json()


async def _poll_replicate_prediction(prediction_id: str, max_wait_s: int = 90, interval_s: float = 2.0) -> dict:
    headers = {"Authorization": f"Token {REPLICATE_API_TOKEN}"}
    elapsed = 0.0
    async with httpx.AsyncClient(timeout=30) as client:
        while elapsed < max_wait_s:
            resp = await client.get(f"{REPLICATE_BASE_URL}/predictions/{prediction_id}", headers=headers)
            data = resp.json()
            status = data.get("status")
            if status in ("succeeded", "failed", "canceled"):
                return data
            await asyncio.sleep(interval_s)
            elapsed += interval_s
    raise HTTPException(status_code=504, detail="Tiempo de espera agotado esperando a Replicate.")


async def _generate_via_replicate(person_data_uri: str, garment_id: str, garment_des: str) -> str:
    _require_replicate_token()
    entry = _find_garment_entry(garment_id)
    category = "lower_body" if entry.get("region") == "lower_body" else "upper_body"
    garment_data_uri = _load_garment_as_data_uri(garment_id)
    prediction = await _create_replicate_prediction(person_data_uri, garment_data_uri, garment_des, category)

    status = prediction.get("status")
    if status not in ("succeeded", "failed", "canceled"):
        prediction = await _poll_replicate_prediction(prediction["id"])
        status = prediction.get("status")

    if status in ("failed", "canceled"):
        raise HTTPException(status_code=502, detail=str(prediction.get("error") or "La generación falló en Replicate."))

    output = prediction.get("output")
    image_url = output if isinstance(output, str) else (output[0] if isinstance(output, list) and output else None)
    if not image_url:
        raise HTTPException(status_code=502, detail="Replicate no devolvió una imagen de salida.")
    return image_url


# ─────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "provider": PROVIDER,
        "huggingface_space": HF_SPACE_ID if PROVIDER == "huggingface" else None,
        "replicate_configured": bool(REPLICATE_API_TOKEN) if PROVIDER == "replicate" else None,
    }


@app.post("/api/vto/photoreal", response_model=PhotorealResponse)
async def generate_photoreal(req: PhotorealRequest):
    garment_des = req.garment_description or "T-shirt de algodón, corte clásico"

    if PROVIDER == "replicate":
        image_url = await _generate_via_replicate(req.person_image_base64, req.garment_id, garment_des)
        return PhotorealResponse(status="succeeded", image_url=image_url, provider="replicate")

    # Default: huggingface (gratis)
    person_bytes = _data_uri_to_bytes(req.person_image_base64)
    garment_bytes = _load_garment_bytes(req.garment_id)
    result_bytes = await _generate_via_huggingface(person_bytes, garment_bytes, garment_des)
    result_b64 = base64.b64encode(result_bytes).decode("ascii")
    return PhotorealResponse(
        status="succeeded",
        image_base64=f"data:image/png;base64,{result_b64}",
        provider="huggingface",
    )

