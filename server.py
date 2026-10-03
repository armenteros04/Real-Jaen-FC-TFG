import os
import subprocess
import sys
import glob
import shutil
import shlex
from pathlib import Path
from typing import Dict, Optional
from fastapi import FastAPI, BackgroundTasks, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from pydantic import BaseModel

# Asegura que el paquete "manual_correction" (junto a main.py) sea
# importable independientemente de cómo se haya lanzado server.py
# (python server.py, uvicorn server:app, etc.).
_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

import database as db  # capa SQLite: jornadas, estadísticas y carrusel

app = FastAPI(title="Real Jaén AI - Backend Bridge")

# Crea las tablas si no existen (los datos se cargan con migrate_to_db.py).
db.init_db()

# Permitir solicitudes CORS desde la WebApp
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directorio donde está ubicado server.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Carpeta de resultados del proyecto
OUTPUTS_DIR = os.path.join(BASE_DIR, "OUTPUTS")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

# Servir estáticamente OUTPUTS
app.mount("/outputs", StaticFiles(directory=OUTPUTS_DIR), name="outputs")

# Estado global de la ejecución
execution_status = {
    "is_running": False,
    "last_command": "",
    "logs": []
}

def is_browser_compatible(path: str) -> bool:
    """Comprueba si el vídeo está codificado en H.264."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=codec_name",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip().lower() == "h264"
    except FileNotFoundError:
        execution_status["logs"].append(
            "⚠️ ffmpeg/ffprobe no está instalado: no se pueden comprobar/convertir los vídeos generados."
        )
        return True
    except subprocess.CalledProcessError:
        return False


def convert_to_h264(path: str) -> None:
    """Recodifica el vídeo a H.264 + AAC con faststart."""
    tmp_path = path + ".tmp.mp4"
    cmd = [
        "ffmpeg", "-y", "-i", path,
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "128k",
        tmp_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise RuntimeError(result.stderr[-600:])
    shutil.move(tmp_path, path)


def fix_output_videos():
    """Recorre OUTPUTS y recodifica los .mp4 que no sean H.264."""
    videos = glob.glob(os.path.join(OUTPUTS_DIR, "**", "*.mp4"), recursive=True)
    for path in videos:
        rel = os.path.relpath(path, OUTPUTS_DIR)
        try:
            if is_browser_compatible(path):
                continue
            execution_status["logs"].append(f"🎞️ Recodificando {rel} para el navegador…")
            convert_to_h264(path)
            execution_status["logs"].append(f"✅ {rel} recodificado a H.264.")
        except Exception as e:
            execution_status["logs"].append(f"❌ No se pudo recodificar {rel}: {e}")


def run_pipeline_task(cmd: list):
    global execution_status
    execution_status["is_running"] = True
    execution_status["logs"] = [f"Iniciando ejecución: {shlex.join(cmd)}"]

    try:
        process = subprocess.Popen(
            cmd,
            shell=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=BASE_DIR
        )

        for line in process.stdout:
            execution_status["logs"].append(line.strip())

        process.wait()
        if process.returncode == 0:
            execution_status["logs"].append("✅ Análisis completado con éxito.")
            fix_output_videos()
        else:
            execution_status["logs"].append(f"❌ Error en la ejecución (Código {process.returncode}).")
    except Exception as e:
        execution_status["logs"].append(f"❌ Excepción en ejecución: {str(e)}")
    finally:
        execution_status["is_running"] = False


@app.get("/", response_class=HTMLResponse)
def serve_index():
    """Sirve index.html desde la carpeta del proyecto."""
    index_path = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Servidor iniciado. No se encontró el archivo index.html.</h1>"


@app.post("/api/run")
def run_analysis(
        video: str = Query("match.mp4"),
        device: str = Query("cuda:0"),
        background_tasks: BackgroundTasks = None
):
    if execution_status["is_running"]:
        return JSONResponse(status_code=400, content={"message": "Ya hay un análisis en ejecución."})

    # Se pasa como lista de argumentos (sin shell=True) para que los nombres
    # de vídeo con espacios u otros caracteres especiales no rompan el comando.
    cmd = [sys.executable, "main.py", "--video", video, "--all", "--device", device]
    cmd_display = shlex.join(cmd)
    execution_status["last_command"] = cmd_display

    background_tasks.add_task(run_pipeline_task, cmd)
    return {"message": "Proceso iniciado", "command": cmd_display}


@app.get("/api/status")
def get_status():
    return execution_status


@app.get("/api/results")
def list_results():
    """Devuelve todos los archivos de OUTPUTS, incluyendo subcarpetas."""
    files = glob.glob(os.path.join(OUTPUTS_DIR, "**", "*"), recursive=True)
    relative_files = [
        os.path.relpath(f, OUTPUTS_DIR).replace(os.sep, "/")
        for f in files
        if os.path.isfile(f)
    ]
    return {
        "output_dir": OUTPUTS_DIR,
        "files": relative_files
    }


def _review_gate():
    """WebReviewGate bound to this server's OUTPUTS_DIR (see manual_correction/web_review.py)."""
    from manual_correction.web_review import WebReviewGate
    return WebReviewGate(OUTPUTS_DIR)


def _team_names_store(stem: str):
    """TeamNamesStore for a given video stem (see manual_correction/correction_store.py).

    Lives as a flat "<stem>_team_names.json" next to the other per-video
    outputs (corrections file, *_team_tactical.txt, ...) in OUTPUTS_DIR, so
    the tactical-analysis view can fetch it as a plain static file once
    it's saved -- no separate GET endpoint needed for reading it back.
    """
    from manual_correction.correction_store import TeamNamesStore
    # Path(...).name strips any accidental "/" or ".." from the stem before
    # it's used to build a path inside OUTPUTS_DIR.
    safe_stem = Path(stem).name
    return TeamNamesStore(Path(OUTPUTS_DIR) / f"{safe_stem}_team_names.json")


def _correction_session(gate_data: dict):
    """Tk-free session/logic reused as-is from correction_tk_ui.py."""
    from manual_correction.correction_tk_ui import CorrectionSession
    try:
        return CorrectionSession(
            gate_data["manifest"], corrections_path=gate_data["corrections_file"]
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"No se encontró el manifiesto de revisión: {exc}",
        )


class JornadaUpdate(BaseModel):
    goles_jaen: Optional[int] = None
    goles_rival: Optional[int] = None
    notas: Optional[str] = None
    flashscore_url: Optional[str] = None
    estadio: Optional[str] = None
    campo: Optional[str] = None
    fecha: Optional[str] = None  # dd/mm/yyyy


class TeamNamesPayload(BaseModel):
    names: Dict[str, str]  # {"0": "Real Jaén CF", "1": "SD Huesca"}


class CorrectionPayload(BaseModel):
    track_id: int
    role: str
    team_id: Optional[int] = None
    id_switch: bool = False
    switch_note: str = ""
    merge_with_track_id: Optional[int] = None
    switch_frame: Optional[int] = None
    player_name: Optional[str] = None


@app.get("/api/correction/review")
def correction_review():
    """Estado de la revisión manual pendiente (si la hay) + candidatos."""
    gate_data = _review_gate().read()
    if not gate_data:
        return {"active": False}
    if gate_data.get("status") != "pending":
        # Ya resuelta pero el pipeline todavía no ha limpiado el fichero.
        return {"active": False, "status": gate_data.get("status")}

    session = _correction_session(gate_data)
    candidates = []
    for cand in session.candidates:
        track_id = int(cand["track_id"])
        correction = session.corrections.get(track_id)
        candidates.append({
            **cand,
            "correction": correction.to_dict() if correction else None,
        })
    team_legend = {str(k): v for k, v in session.team_legend.items()}
    frame_size = session.manifest.get("metadata", {}).get("frame_size")
    stem = gate_data.get("stem")
    try:
        team_names = (
            {str(k): v for k, v in _team_names_store(stem).load().items()}
            if stem else {}
        )
    except Exception:
        team_names = {}

    return {
        "active": True,
        "stem": stem,
        "n_candidates": gate_data.get("n_candidates"),
        "opened_at": gate_data.get("opened_at"),
        "frame_size": frame_size,
        "team_legend": team_legend,
        "team_names": team_names,
        "candidates": candidates,
        "summary": session.summary(),
    }


@app.post("/api/correction/team-names")
def correction_team_names_save(payload: TeamNamesPayload):
    """Guarda los nombres reales de Equipo 0 / Equipo 1 para la revisión activa.

    Se escriben en '<stem>_team_names.json' junto al resto de resultados del
    vídeo, para que la vista de Análisis táctico los recoja automáticamente
    (sin tener que asumir Real Jaén CF + botón de intercambiar equipos).
    """
    gate_data = _review_gate().read()
    if not gate_data or gate_data.get("status") != "pending":
        raise HTTPException(status_code=400, detail="No hay ninguna revisión activa.")

    stem = gate_data.get("stem")
    if not stem:
        raise HTTPException(status_code=400, detail="La revisión activa no tiene 'stem'.")

    try:
        names = {int(k): v for k, v in payload.names.items()}
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="team_id inválido en 'names'.")

    try:
        store = _team_names_store(stem)
        store.save(names)
        saved = {str(k): v for k, v in store.load().items()}
    except HTTPException:
        raise
    except Exception as exc:
        # No dejar que esto se convierta en un 500 mudo: si falta la clase
        # TeamNamesStore (p. ej. no se actualizó manual_correction/
        # correction_store.py), o hay un problema de permisos al escribir
        # en OUTPUTS_DIR, el motivo real llega al frontend y se puede ver.
        raise HTTPException(
            status_code=500,
            detail=f"No se pudieron guardar los nombres de equipo: {exc}",
        )

    return {"ok": True, "team_names": saved}


@app.get("/api/correction/image")
def correction_image(path: str = Query(...)):
    """Sirve un crop/frame de la revisión manual desde disco (con validación)."""
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = Path(_PROJECT_ROOT) / candidate
    try:
        resolved = candidate.resolve()
        resolved.relative_to(Path(_PROJECT_ROOT).resolve())
    except (OSError, ValueError):
        raise HTTPException(status_code=400, detail="Ruta de imagen no válida.")
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="Imagen no encontrada.")
    return FileResponse(str(resolved))


@app.post("/api/correction/save")
def correction_save(payload: CorrectionPayload):
    """Guarda/actualiza la corrección de un track (equivalente a 'Save' en Tk)."""
    gate_data = _review_gate().read()
    if not gate_data or gate_data.get("status") != "pending":
        raise HTTPException(status_code=400, detail="No hay ninguna revisión activa.")

    session = _correction_session(gate_data)
    try:
        correction = session.save_correction(
            track_id=payload.track_id,
            role=payload.role,
            team_id=payload.team_id,
            id_switch=payload.id_switch,
            switch_note=payload.switch_note,
            merge_with_track_id=payload.merge_with_track_id,
            switch_frame=payload.switch_frame,
            player_name=payload.player_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"ok": True, "correction": correction.to_dict(), "summary": session.summary()}


@app.post("/api/correction/delete")
def correction_delete(track_id: int = Query(...)):
    """Elimina la corrección de un track (vuelve al rol automático)."""
    gate_data = _review_gate().read()
    if not gate_data or gate_data.get("status") != "pending":
        raise HTTPException(status_code=400, detail="No hay ninguna revisión activa.")

    session = _correction_session(gate_data)
    removed = session.delete_correction(track_id)
    return {"ok": removed, "summary": session.summary()}


@app.post("/api/correction/finish")
def correction_finish(action: str = Query(...)):
    """Cierra la revisión: 'submit' aplica las correcciones guardadas,
    'skip' continúa el pipeline con los roles automáticos."""
    if action not in ("submit", "skip"):
        raise HTTPException(status_code=400, detail="Acción no válida.")
    status = "submitted" if action == "submit" else "skipped"
    updated = _review_gate().resolve(status)
    if updated is None:
        raise HTTPException(status_code=400, detail="No hay ninguna revisión activa.")
    return {"ok": True, "status": status}


# ---------------------------------------------------------------------------
# Datos de la temporada (SQLite): jornadas, estadísticas y carrusel
# ---------------------------------------------------------------------------
@app.get("/api/jornadas")
def api_list_jornadas():
    """Calendario completo (antes JORNADAS_DATA en app.js)."""
    return {"jornadas": db.get_jornadas()}


@app.get("/api/jornadas/{numero}")
def api_get_jornada(numero: int):
    jornada = db.get_jornada(numero)
    if jornada is None:
        raise HTTPException(status_code=404, detail=f"La jornada {numero} no existe.")
    return jornada


@app.put("/api/jornadas/{numero}")
def api_update_jornada(numero: int, payload: JornadaUpdate):
    """Actualiza resultado, notas, enlace, etc. Solo se tocan los campos enviados."""
    fields = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") \
        else payload.dict(exclude_unset=True)
    if fields.get("campo") not in (None, "local", "visitante"):
        raise HTTPException(status_code=400, detail="'campo' debe ser 'local' o 'visitante'.")
    try:
        updated = db.update_jornada(numero, fields)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Dato no válido: {exc}")
    if updated is None:
        raise HTTPException(status_code=404, detail=f"La jornada {numero} no existe.")
    return updated


@app.get("/api/jornada-stats")
def api_all_stats():
    """Estadísticas de todas las jornadas (antes JORNADA_STATS en app.js)."""
    return {"stats": db.get_all_stats()}


@app.put("/api/jornadas/{numero}/stats")
def api_set_stats(numero: int, stats: Dict[str, list]):
    """Reemplaza las estadísticas de una jornada: {"posesion": [46, 54], ...}"""
    try:
        db.set_stats(numero, stats)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "stats": db.get_all_stats().get(str(numero), {})}


@app.get("/api/carrusel")
def api_carrusel():
    """Imágenes del carrusel del dashboard (antes DETECTION_EXAMPLES)."""
    return {"items": db.get_carrusel()}


@app.get("/api/jornadas/{jornada}/clips")
def list_jornada_clips(jornada: int):
    """Devuelve los clips MP4 de OUTPUTS/primeraref/jornadaN.

    Se busca directamente en la carpeta de la jornada para que la WebApp
    no dependa de cómo se enumeren los resultados generales de OUTPUTS.
    """
    if jornada < 1:
        raise HTTPException(status_code=400, detail="La jornada debe ser mayor o igual que 1.")

    jornada_dir = Path(OUTPUTS_DIR) / "primeraref" / f"jornada{jornada}"

    if not jornada_dir.is_dir():
        return {
            "jornada": jornada,
            "folder": str(jornada_dir),
            "clips": []
        }

    clips = []
    for path in sorted(jornada_dir.rglob("*.mp4"), key=lambda p: p.name.lower()):
        if path.is_file():
            relative_path = path.relative_to(OUTPUTS_DIR).as_posix()
            clips.append({
                "name": path.name,
                "path": relative_path,
                "url": f"/outputs/{relative_path}"
            })

    return {
        "jornada": jornada,
        "folder": str(jornada_dir),
        "clips": clips
    }


if __name__ == "__main__":
    import uvicorn
    print(f"Servidor iniciado en http://localhost:8000")
    print(f"Carpeta del proyecto: {BASE_DIR}")
    print(f"Carpeta OUTPUTS vinculada: {OUTPUTS_DIR}")
    uvicorn.run(app, host="127.0.0.1", port=8000)
