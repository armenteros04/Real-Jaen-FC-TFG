"""Web-based replacement for the Tkinter manual-correction popup.

``main.py --all`` used to call :class:`manual_correction.correction_tk_ui.
CorrectionApp`, which opens a native Tkinter window and blocks until the
reviewer closes it. That works on a local desktop run, but not when the
pipeline is launched from ``server.py`` as a background subprocess for the
webapp: there is no display attached to that process, and even if there
were, the user is looking at a browser, not the server's desktop.

This module lets the pipeline process (``main.py``) and the API process
(``server.py``) coordinate the same review over a small JSON "gate" file
on disk instead of a shared window:

* ``main.py`` builds the review dataset as before, then calls
  :meth:`WebReviewGate.open` and blocks in :meth:`WebReviewGate.
  wait_for_decision`, polling the gate file.
* ``server.py`` exposes ``/api/correction/*`` endpoints that read the same
  gate file, read/write corrections through the existing
  :class:`~manual_correction.correction_store.CorrectionStore`, and — once
  the reviewer finishes in the webapp — flip the gate's status, which wakes
  ``main.py`` back up.

Only one review is open at a time (the pipeline processes one video per
run), so a fixed filename per output directory is enough.
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

GATE_FILENAME = "web_review_gate.json"

STATUS_PENDING = "pending"
STATUS_SUBMITTED = "submitted"
STATUS_SKIPPED = "skipped"


class WebReviewGate:
    """Opens a manual-review request for the webapp and waits on it.

    ``output_dir`` must be the same directory the webapp backend serves
    (``server.py``'s ``OUTPUTS_DIR``), so both processes agree on where the
    gate file lives regardless of which one writes it.
    """

    def __init__(self, output_dir: str | Path) -> None:
        self.path = Path(output_dir) / GATE_FILENAME

    # ------------------------------------------------------------------
    # Called from main.py (the pipeline process)
    # ------------------------------------------------------------------
    def open(
        self,
        stem: str,
        manifest_path: str | Path,
        corrections_file: str | Path,
        n_candidates: int,
    ) -> None:
        """Publish a pending review for the webapp to pick up."""
        payload = {
            "stem": stem,
            "status": STATUS_PENDING,
            "manifest": str(manifest_path),
            "corrections_file": str(corrections_file),
            "n_candidates": int(n_candidates),
            "opened_at": datetime.now().isoformat(timespec="seconds"),
            "resolved_at": None,
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._write(payload)

    def wait_for_decision(self, poll_interval: float = 1.5) -> str:
        """Block until the webapp resolves the review.

        Returns :data:`STATUS_SUBMITTED` or :data:`STATUS_SKIPPED`. If the
        gate file disappears (e.g. manually deleted) the review is treated
        as skipped so the pipeline never hangs forever.
        """
        while True:
            data = self.read()
            if data is None:
                return STATUS_SKIPPED
            status = data.get("status", STATUS_PENDING)
            if status != STATUS_PENDING:
                return status
            time.sleep(poll_interval)

    def close(self) -> None:
        """Remove the gate file once the pipeline has consumed the decision."""
        try:
            self.path.unlink(missing_ok=True)
        except OSError:
            pass

    # ------------------------------------------------------------------
    # Called from server.py (the API process)
    # ------------------------------------------------------------------
    def read(self) -> Optional[dict]:
        if not self.path.is_file():
            return None
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (json.JSONDecodeError, OSError):
            return None

    def resolve(self, status: str) -> Optional[dict]:
        """Flip a pending gate to ``submitted``/``skipped``; wakes main.py.

        Returns the updated payload, or ``None`` if there was no pending
        review to resolve.
        """
        data = self.read()
        if data is None or data.get("status") != STATUS_PENDING:
            return None
        data["status"] = status
        data["resolved_at"] = datetime.now().isoformat(timespec="seconds")
        self._write(data)
        return data

    # ------------------------------------------------------------------
    def _write(self, payload: dict) -> None:
        # Write to a temp file and rename so a concurrent reader (the API
        # process) never sees a half-written JSON file.
        tmp = self.path.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        tmp.replace(self.path)
