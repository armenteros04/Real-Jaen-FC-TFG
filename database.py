"""Capa de acceso a datos (SQLite) para Real Jaén AI.

Sustituye a las estructuras que estaban incrustadas en app.js
(JORNADAS_DATA, JORNADA_STATS, DETECTION_EXAMPLES). Solo usa la
librería estándar (sqlite3), sin dependencias nuevas.
"""
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from typing import Dict, List, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("REALJAEN_DB", os.path.join(BASE_DIR, "realjaen.db"))

# Claves de estadística permitidas (mismas que STAT_LABELS en app.js).
STAT_KEYS = (
    "posesion", "tiros", "tiros_puerta", "corners", "faltas",
    "fuera_de_juego", "amarillas", "rojas", "paradas",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS equipos (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre  TEXT NOT NULL UNIQUE,
    escudo  TEXT
);

CREATE TABLE IF NOT EXISTS jornadas (
    numero         INTEGER PRIMARY KEY CHECK (numero >= 1),
    rival_id       INTEGER NOT NULL REFERENCES equipos(id),
    estadio        TEXT,
    fecha          TEXT,                       -- ISO 8601: YYYY-MM-DD
    campo          TEXT NOT NULL CHECK (campo IN ('local', 'visitante')),
    goles_jaen     INTEGER,                    -- NULL = aún no jugada
    goles_rival    INTEGER,
    notas          TEXT NOT NULL DEFAULT '',
    flashscore_url TEXT
);

CREATE TABLE IF NOT EXISTS jornada_stats (
    jornada_numero INTEGER NOT NULL REFERENCES jornadas(numero) ON DELETE CASCADE,
    stat_key       TEXT NOT NULL,
    valor_jaen     REAL NOT NULL,
    valor_rival    REAL NOT NULL,
    PRIMARY KEY (jornada_numero, stat_key)
);

CREATE TABLE IF NOT EXISTS carrusel (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    orden   INTEGER NOT NULL,
    src     TEXT NOT NULL,
    titulo  TEXT,
    sub     TEXT
);

CREATE INDEX IF NOT EXISTS idx_jornadas_rival ON jornadas(rival_id);
"""


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)


# ---------- helpers ----------
def _iso_to_es(iso: Optional[str]) -> str:
    """'2026-08-30' -> '30/08/2026' (formato que espera el frontend)."""
    if not iso:
        return ""
    try:
        return datetime.strptime(iso, "%Y-%m-%d").strftime("%d/%m/%Y")
    except ValueError:
        return iso


def es_to_iso(fecha: str) -> Optional[str]:
    """'30/08/2026' -> '2026-08-30'."""
    if not fecha:
        return None
    return datetime.strptime(fecha, "%d/%m/%Y").strftime("%Y-%m-%d")


def _jornada_row_to_dict(r: sqlite3.Row) -> dict:
    """Misma forma que los objetos de JORNADAS_DATA en app.js."""
    d = {
        "numero": r["numero"],
        "rival": r["rival"],
        "escudo_rival": r["escudo_rival"],
        "estadio": r["estadio"],
        "fecha": _iso_to_es(r["fecha"]),
        "campo": r["campo"],
        "goles_jaen": r["goles_jaen"],
        "goles_rival": r["goles_rival"],
        "notas": r["notas"] or "",
    }
    if r["flashscore_url"]:
        d["flashscore_url"] = r["flashscore_url"]
    return d


_JORNADA_SELECT = """
    SELECT j.numero, e.nombre AS rival, e.escudo AS escudo_rival, j.estadio,
           j.fecha, j.campo, j.goles_jaen, j.goles_rival, j.notas, j.flashscore_url
    FROM jornadas j JOIN equipos e ON e.id = j.rival_id
"""


# ---------- lecturas ----------
def get_jornadas() -> List[dict]:
    with get_conn() as conn:
        rows = conn.execute(_JORNADA_SELECT + " ORDER BY j.numero").fetchall()
    return [_jornada_row_to_dict(r) for r in rows]


def get_jornada(numero: int) -> Optional[dict]:
    with get_conn() as conn:
        r = conn.execute(_JORNADA_SELECT + " WHERE j.numero = ?", (numero,)).fetchone()
    return _jornada_row_to_dict(r) if r else None


def get_all_stats() -> Dict[str, Dict[str, List[float]]]:
    """{ "1": {"posesion": [46, 54], ...}, ... } (igual que JORNADA_STATS)."""
    out: Dict[str, Dict[str, List[float]]] = {}
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT jornada_numero, stat_key, valor_jaen, valor_rival "
            "FROM jornada_stats ORDER BY jornada_numero, rowid"
        ).fetchall()
    for r in rows:
        pair = [_num(r["valor_jaen"]), _num(r["valor_rival"])]
        out.setdefault(str(r["jornada_numero"]), {})[r["stat_key"]] = pair
    return out


def get_carrusel() -> List[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT src, titulo, sub FROM carrusel ORDER BY orden, id"
        ).fetchall()
    return [{"src": r["src"], "title": r["titulo"] or "", "sub": r["sub"] or ""} for r in rows]


def _num(v: float):
    return int(v) if float(v).is_integer() else v


# ---------- escrituras ----------
def update_jornada(numero: int, fields: dict) -> Optional[dict]:
    """Actualiza resultado / notas / url / estadio / fecha de una jornada."""
    allowed = {"goles_jaen", "goles_rival", "notas", "flashscore_url", "estadio", "campo"}
    sets, params = [], []
    for k, v in fields.items():
        if k == "fecha":
            sets.append("fecha = ?")
            params.append(es_to_iso(v) if v else None)
        elif k in allowed:
            sets.append(f"{k} = ?")
            params.append(v)
    if sets:
        with get_conn() as conn:
            cur = conn.execute(
                f"UPDATE jornadas SET {', '.join(sets)} WHERE numero = ?", (*params, numero)
            )
            if cur.rowcount == 0:
                return None
    return get_jornada(numero)


def set_stats(numero: int, stats: Dict[str, List[float]]) -> None:
    """Reemplaza las estadísticas de una jornada. Lanza ValueError si son inválidas."""
    for key, pair in stats.items():
        if key not in STAT_KEYS:
            raise ValueError(f"Estadística desconocida: {key}")
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise ValueError(f"'{key}' debe ser [valor_jaen, valor_rival].")
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM jornadas WHERE numero = ?", (numero,)).fetchone():
            raise LookupError(f"La jornada {numero} no existe.")
        conn.execute("DELETE FROM jornada_stats WHERE jornada_numero = ?", (numero,))
        conn.executemany(
            "INSERT INTO jornada_stats VALUES (?, ?, ?, ?)",
            [(numero, k, float(v[0]), float(v[1])) for k, v in stats.items()],
        )
