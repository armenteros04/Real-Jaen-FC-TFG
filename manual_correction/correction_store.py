"""Load and persist manual role corrections.

The corrections file is the single source of truth for human input and is
deliberately separate from the automatic results, so:

* automatic results are never overwritten, and
* a correction is reversible — delete an entry (or the whole file) and the
  track reverts to its automatic role.

On-disk format (``outputs/manual_role_corrections.json``):

    {
      "1":   {"role": "player",  "team_id": 0},
      "107": {"role": "referee", "team_id": null},
      "119": {"role": "referee", "team_id": null}
    }

Keys are track ids as strings (JSON object keys must be strings).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Optional

from manual_correction.correction_models import Correction
from utils.logger import get_logger

logger = get_logger("manual_correction.correction_store")


class CorrectionStore:
    """Reads/writes the manual corrections JSON, keyed by integer track id."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    # ------------------------------------------------------------------
    def load(self) -> Dict[int, Correction]:
        """Return ``{track_id: Correction}``; empty dict if the file is absent.

        Malformed individual entries are skipped with a warning rather than
        aborting the whole load — a half-finished review should still apply.
        """
        if not self.path.is_file():
            logger.info("No corrections file at %s (using auto roles only)", self.path)
            return {}
        with self.path.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)
        if not isinstance(raw, dict):
            raise ValueError(
                f"Corrections file {self.path} must be a JSON object, "
                f"got {type(raw).__name__}"
            )

        corrections: Dict[int, Correction] = {}
        for key, value in raw.items():
            try:
                track_id = int(key)
                corrections[track_id] = Correction.from_dict(value)
            except (ValueError, KeyError, TypeError) as exc:
                logger.warning("Skipping invalid correction for '%s': %s", key, exc)
        logger.info("Loaded %d corrections from %s", len(corrections), self.path)
        return corrections

    def save(self, corrections: Dict[int, Correction]) -> Path:
        """Write the corrections map to disk (sorted by track id)."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            str(track_id): corrections[track_id].to_dict()
            for track_id in sorted(corrections)
        }
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        logger.info("Saved %d corrections to %s", len(payload), self.path)
        return self.path

    # ------------------------------------------------------------------
    # Convenience mutators (used by the UI)
    # ------------------------------------------------------------------
    def upsert(
        self, track_id: int, role: str, team_id: Optional[int] = None
    ) -> Dict[int, Correction]:
        """Set/replace one correction and persist the whole file."""
        corrections = self.load()
        corrections[int(track_id)] = Correction(role=role, team_id=team_id)
        self.save(corrections)
        return corrections

    def remove(self, track_id: int) -> Dict[int, Correction]:
        """Delete one correction (reverting that track to its auto role)."""
        corrections = self.load()
        corrections.pop(int(track_id), None)
        self.save(corrections)
        return corrections


class TeamNamesStore:
    """Reads/writes the user-typed real team names, keyed by team id (0/1).

    A team name is a decision about the whole match, not about a single
    track, so it is kept in its own small file instead of living inside
    :class:`CorrectionStore`'s per-track map -- that way it survives even
    if the track corrections are reset, and old corrections files don't
    need to change shape.

    Written from the web review panel (the reviewer already has the team
    legend crops on screen and knows which color is which real team), and
    read back by the webapp's tactical-analysis view so it can label
    "Equipo 0" / "Equipo 1" with the real names instead of guessing.

    On-disk format (``<video>_team_names.json``)::

        {"0": "Real Jaén CF", "1": "SD Huesca"}
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def load(self) -> Dict[int, str]:
        """Return ``{team_id: name}``; empty dict if absent/unreadable."""
        if not self.path.is_file():
            return {}
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Could not read team names at %s: %s", self.path, exc)
            return {}
        if not isinstance(raw, dict):
            return {}

        names: Dict[int, str] = {}
        for key, value in raw.items():
            try:
                team_id = int(key)
            except (TypeError, ValueError):
                logger.warning("Skipping invalid team id '%s' in %s", key, self.path)
                continue
            name = str(value).strip()
            if name:
                names[team_id] = name
        return names

    def save(self, names: Dict[int, str]) -> Path:
        """Write the team names map to disk (sorted by team id).

        Blank names are dropped, so clearing an input and saving removes
        that team's override.
        """
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            str(team_id): name.strip()
            for team_id, name in names.items()
            if str(name).strip()
        }
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
        logger.info("Saved %d team name(s) to %s", len(payload), self.path)
        return self.path
