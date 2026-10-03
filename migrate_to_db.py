"""Migra los datos incrustados en app.js a la base de datos SQLite.

Uso:
    python migrate_to_db.py                # lee ./app.js  (o ./js/app.js)
    python migrate_to_db.py ruta/app.js
    python migrate_to_db.py --reset        # borra y recrea las tablas antes

Lee JORNADAS_DATA, JORNADA_STATS y DETECTION_EXAMPLES directamente del
código JavaScript (sin necesitar Node) y los inserta en realjaen.db.
Es idempotente: se puede ejecutar varias veces sin duplicar datos.
"""
import json
import os
import re
import sys
from datetime import datetime

import database as db


# ---------- Parser mínimo JS-literal -> Python ----------
def _extract_literal(source: str, name: str) -> str:
    m = re.search(rf"\b(?:const|let|var)\s+{name}\s*=\s*", source)
    if not m:
        raise SystemExit(f"No se encontró '{name}' en el fichero JS.")
    start = m.end()
    open_ch = source[start]
    close_ch = {"[": "]", "{": "}"}[open_ch]
    depth, i, in_str = 0, start, None
    while i < len(source):
        c = source[i]
        if in_str:
            if c == "\\":
                i += 1
            elif c == in_str:
                in_str = None
        elif c in "\"'`":
            in_str = c
        elif c == "/" and source[i:i + 2] == "//":
            i = source.index("\n", i) - 1
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return source[start:i + 1]
        i += 1
    raise SystemExit(f"Literal de '{name}' sin cerrar.")


def _js_to_json(text: str) -> str:
    """Convierte un literal JS (claves sin comillas, comas finales,
    comentarios //) a JSON, sin tocar el contenido de las cadenas."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c in "\"'":
            j = i + 1
            while text[j] != c:
                j += 2 if text[j] == "\\" else 1
            s = text[i + 1:j]
            out.append(json.dumps(s.replace("\\'", "'") if c == "'" else json.loads(f'"{s}"')))
            i = j + 1
        elif text.startswith("//", i):
            i = text.find("\n", i)
            i = n if i == -1 else i
        elif c.isalpha() or c == "_":
            j = i
            while j < n and (text[j].isalnum() or text[j] == "_"):
                j += 1
            word, k = text[i:j], j
            while k < n and text[k].isspace():
                k += 1
            if k < n and text[k] == ":":
                out.append(json.dumps(word))
            else:
                out.append(word)  # true / false / null
            i = j
        elif c.isdigit():
            j = i
            while j < n and (text[j].isdigit() or text[j] == "."):
                j += 1
            k = j
            while k < n and text[k].isspace():
                k += 1
            num = text[i:j]
            out.append(json.dumps(num) if k < n and text[k] == ":" else num)
            i = j
        else:
            out.append(c)
            i += 1
    js = "".join(out)
    return re.sub(r",(\s*[\]}])", r"\1", js)  # comas finales


def load_js_const(source: str, name: str):
    return json.loads(_js_to_json(_extract_literal(source, name)))


# ---------- Migración ----------
def migrate(js_path: str, reset: bool = False) -> None:
    with open(js_path, "r", encoding="utf-8") as f:
        source = f.read()

    jornadas = load_js_const(source, "JORNADAS_DATA")
    stats = load_js_const(source, "JORNADA_STATS")
    carrusel = load_js_const(source, "DETECTION_EXAMPLES")

    if not jornadas:
        raise SystemExit(
            "JORNADAS_DATA está vacío en este fichero. ¿Es la versión de app.js que ya "
            "carga los datos desde la API? Usa el app.js ORIGINAL (con los datos incrustados)."
        )

    if reset and os.path.exists(db.DB_PATH):
        os.remove(db.DB_PATH)
    db.init_db()

    warnings = []
    prev_date = None
    with db.get_conn() as conn:
        # Equipos rivales (sin duplicados)
        for j in jornadas:
            conn.execute(
                "INSERT INTO equipos (nombre, escudo) VALUES (?, ?) "
                "ON CONFLICT(nombre) DO UPDATE SET escudo = excluded.escudo",
                (j["rival"], j.get("escudo_rival")),
            )
        ids = {r["nombre"]: r["id"] for r in conn.execute("SELECT id, nombre FROM equipos")}

        # Jornadas
        for j in jornadas:
            iso = db.es_to_iso(j.get("fecha", ""))
            if iso and prev_date and iso < prev_date:
                warnings.append(
                    f"Jornada {j['numero']}: fecha {j['fecha']} anterior a la jornada previa "
                    f"(¿año mal escrito?)."
                )
            prev_date = iso or prev_date
            conn.execute(
                """INSERT INTO jornadas
                   (numero, rival_id, estadio, fecha, campo, goles_jaen, goles_rival, notas, flashscore_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(numero) DO UPDATE SET
                     rival_id=excluded.rival_id, estadio=excluded.estadio, fecha=excluded.fecha,
                     campo=excluded.campo, goles_jaen=excluded.goles_jaen,
                     goles_rival=excluded.goles_rival, notas=excluded.notas,
                     flashscore_url=excluded.flashscore_url""",
                (j["numero"], ids[j["rival"]], j.get("estadio"), iso, j["campo"],
                 j.get("goles_jaen"), j.get("goles_rival"), j.get("notas", ""),
                 j.get("flashscore_url")),
            )

        # Estadísticas
        conn.execute("DELETE FROM jornada_stats")
        for num, per_stat in stats.items():
            for key, (jaen, rival) in per_stat.items():
                conn.execute(
                    "INSERT INTO jornada_stats VALUES (?, ?, ?, ?)",
                    (int(num), key, float(jaen), float(rival)),
                )

        # Carrusel
        conn.execute("DELETE FROM carrusel")
        for i, item in enumerate(carrusel):
            conn.execute(
                "INSERT INTO carrusel (orden, src, titulo, sub) VALUES (?, ?, ?, ?)",
                (i, item["src"], item.get("title", ""), item.get("sub", "")),
            )

    print(f"✅ Base de datos: {db.DB_PATH}")
    print(f"   equipos rivales : {len(ids)}")
    print(f"   jornadas        : {len(jornadas)}")
    print(f"   estadísticas    : {sum(len(v) for v in stats.values())} filas "
          f"({len(stats)} jornadas)")
    print(f"   carrusel        : {len(carrusel)} imágenes")
    for w in warnings:
        print(f"⚠️  {w}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = args[0] if args else next(
        (p for p in ("app.js", os.path.join("js", "app.js")) if os.path.exists(p)), None)
    if not path:
        sys.exit("No encuentro app.js. Pásalo como argumento.")
    migrate(path, reset="--reset" in sys.argv)
