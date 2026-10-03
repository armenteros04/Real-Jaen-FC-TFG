"""Generador de frases variadas para el informe de rendimiento por jugador.

Uso (desde analytics/player_analytics.py, donde hoy se calcula `insight`):

    from analytics.insight_phrases import generate_insight
    insight = generate_insight(
        rating=rating, avg_speed_kmh=avg_speed, distance_m=total_distance,
        max_speed_kmh=max_speed, impact=impact, fatigue=fatigue,
        seed=f"{video_stem}:{track_id}",
    )   # devuelve "" cuando toca no decir nada

- Las frases dependen de las métricas reales.
- Varias variantes por situación; se elige con una semilla estable
  (mismo clip/jugador -> misma frase, reproducible).
- Con probabilidad SILENCE_CHANCE no se genera frase.
"""
from __future__ import annotations

import random
from typing import Optional

SILENCE_CHANCE = 0.0   # 0 = siempre hay frase; sube (p. ej. 0.15) para permitir silencios
MAX_PARTS = 2

BANK = {
    "impactoAlto": [
        "Fue protagonista en la acción y participó de forma decisiva.",
        "Tuvo una influencia clara en el desarrollo de la jugada.",
        "Estuvo muy presente en el juego y marcó la diferencia.",
        "Su intervención condicionó el rumbo de la acción.",
        "Se le vio muy involucrado, siempre cerca del balón.",
    ],
    "impactoMedio": [
        "Participación constante durante la acción.",
        "Aportó de forma regular sin ser el foco principal.",
        "Estuvo correctamente integrado en la dinámica del equipo.",
        "Su presencia fue estable, sin grandes picos de protagonismo.",
        "Cumplió su función dentro del bloque.",
    ],
    "impactoBajo": [
        "Tuvo un papel discreto en esta acción.",
        "Intervino poco y desde posiciones secundarias.",
        "Su influencia en la jugada fue limitada.",
        "Estuvo más como apoyo que como protagonista.",
        "Participó de forma puntual.",
    ],
    "puntaAlta": [
        "Mostró una gran aceleración en el momento clave.",
        "Alcanzó una velocidad punta muy destacada.",
        "Su arrancada fue explosiva.",
        "Dejó un sprint de nivel élite.",
    ],
    "puntaMedia": [
        "Realizó algún cambio de ritmo apreciable.",
        "Alcanzó una velocidad punta sólida, sin llegar al máximo.",
        "Tuvo buenas progresiones a lo largo de la acción.",
    ],
    "puntaBaja": [
        "No necesitó acelerar a fondo.",
        "Se movió a un ritmo controlado, sin sprints.",
        "La acción se resolvió sin grandes explosiones de velocidad.",
    ],
    "distanciaAlta": [
        "Cubrió mucho terreno.",
        "Recorrió una distancia considerable.",
        "Fue un auténtico ida y vuelta.",
    ],
    "distanciaBaja": [
        "Se movió en un espacio reducido.",
        "Recorrió poca distancia en esta acción.",
        "Actuó sobre todo por posición, sin grandes desplazamientos.",
    ],
    "ritmoAlto": [
        "Mantuvo un ritmo medio muy elevado.",
        "Imprimió una intensidad alta de principio a fin.",
    ],
    "ritmoBajo": [
        "Ritmo medio tranquilo, más pausado que dinámico.",
        "Administró esfuerzos con un tempo bajo.",
    ],
    "fatigaAlta": [
        "La intensidad bajó en las etapas finales.",
        "Se apreciaron señales de cansancio hacia el final.",
        "Su rendimiento decayó conforme avanzaba la acción.",
    ],
    "fatigaBaja": [
        "Mantuvo el nivel de energía sin bajar el pistón.",
        "Llegó fresco al final de la acción.",
        "No mostró síntomas de desgaste.",
    ],
    "neutra": [
        "Su actuación en esta acción fue equilibrada.",
        "Sin rasgos destacables, mantuvo un rendimiento estándar.",
        "Participó de forma normal dentro de la dinámica del equipo.",
        "Actuación correcta, sin picos ni caídas notables.",
        "Estuvo en la acción con un nivel de esfuerzo medio.",
    ],
    "notaAlta": [
        "Valoración muy positiva de su actuación.",
        "Una de las actuaciones más completas del análisis.",
    ],
    "notaBaja": [
        "Actuación por debajo de lo esperado.",
        "Margen de mejora claro en esta acción.",
    ],
}


def generate_insight(
    rating: Optional[float] = None,
    avg_speed_kmh: Optional[float] = None,
    distance_m: Optional[float] = None,
    max_speed_kmh: Optional[float] = None,
    impact: Optional[str] = None,      # "Alto" / "Medio" / "Bajo"
    fatigue: Optional[str] = None,     # "Alto" / "Medio" / "Bajo"
    seed: str = "",
) -> str:
    rnd = random.Random(str(seed))
    if rnd.random() < SILENCE_CHANCE:
        return ""

    cands = []  # (peso, categoría)
    imp = (impact or "")[:3].lower()
    if imp == "alt": cands.append((3, "impactoAlto"))
    elif imp == "med": cands.append((2, "impactoMedio"))
    elif imp == "baj": cands.append((2, "impactoBajo"))

    if max_speed_kmh is not None:
        if max_speed_kmh >= 32: cands.append((3, "puntaAlta"))
        elif max_speed_kmh >= 27: cands.append((1, "puntaMedia"))
        else: cands.append((2, "puntaBaja"))
    if distance_m is not None:
        if distance_m >= 40: cands.append((2, "distanciaAlta"))
        elif distance_m < 15: cands.append((2, "distanciaBaja"))
    if avg_speed_kmh is not None:
        if avg_speed_kmh >= 18: cands.append((1, "ritmoAlto"))
        elif avg_speed_kmh < 8: cands.append((1, "ritmoBajo"))
    fat = (fatigue or "")[:3].lower()
    if fat == "alt": cands.append((3, "fatigaAlta"))
    elif fat == "baj": cands.append((1, "fatigaBaja"))
    if rating is not None:
        if rating >= 8.5: cands.append((1, "notaAlta"))
        elif rating <= 4.5: cands.append((1, "notaBaja"))

    if not cands:
        # Nunca dejar al jugador sin frase: si ninguna condición aplica,
        # se usa una frase neutra.
        cands.append((1, "neutra"))

    n = min(len(cands), 1 if rnd.random() < 0.5 else MAX_PARTS)
    parts = []
    for _ in range(n):
        cat = rnd.choices(cands, weights=[c[0] for c in cands])[0]
        cands.remove(cat)
        parts.append(rnd.choice(BANK[cat[1]]))
    return " ".join(parts)
