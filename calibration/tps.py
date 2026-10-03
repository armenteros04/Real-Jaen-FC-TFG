"""Thin-plate-spline residual correction for the pitch homography.

A single planar homography assumes an ideal pinhole camera (no lens
distortion) looking at a flat plane. Professional broadcast cameras (long
lens, corrected optics, far from the pitch) fit that model closely, but a
fixed, wide-angle camera — the kind commonly used to film lower-tier
Spanish football (Primera RFEF and below) — usually has visible barrel
distortion and a more oblique viewing angle. A pure homography then leaves
a systematic residual error that grows away from the pitch center, which
is exactly what makes minimap dots drift from the real player position
even though the homography "looks" solved correctly.

This module fits a thin-plate spline (TPS) on the SAME calibration
correspondences already collected (manual clicks or auto-detected
keypoints): it warps the homography's field-space output so that every
calibration point maps exactly onto its known field coordinate, and
points in between are corrected smoothly. It needs no camera intrinsics
and no extra clicks — just enough calibration points spread across the
image (8+ recommended; the existing calibration UI already asks for that).

Pure numpy/scipy-free implementation so it has no extra dependencies
beyond what the calibration package already uses.
"""

from __future__ import annotations

from typing import Tuple

import numpy as np

Point = Tuple[float, float]

# Below this many points a TPS is either impossible (needs >= 3 non-collinear
# points for the affine part) or too likely to overfit / wobble between
# sparse points. Below the threshold we silently skip refinement and keep
# the plain linear homography.
MIN_TPS_POINTS = 6


def _pairwise_u(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """U(r) = r^2 * log(r) kernel matrix between two point sets, r = ||a_i - b_j||."""
    diff = a[:, None, :] - b[None, :, :]
    r2 = np.sum(diff * diff, axis=-1)
    with np.errstate(divide="ignore", invalid="ignore"):
        u = np.where(r2 > 0, r2 * np.log(r2) * 0.5, 0.0)
    return u


class ThinPlateSpline:
    """2D -> 2D thin-plate-spline warp fitted from control-point correspondences.

    ``regularization`` (>= 0) trades exactness at the control points for a
    smoother warp; 0.0 interpolates them exactly (safe once there are
    several well-spread points), a small positive value (e.g. 1e-3 to 1e-2)
    is safer with few or noisy points since it prevents the spline from
    swinging wildly between them.
    """

    def __init__(self) -> None:
        self._src: np.ndarray | None = None
        self._wx: np.ndarray | None = None
        self._wy: np.ndarray | None = None

    @property
    def is_fitted(self) -> bool:
        return self._src is not None

    def fit(
        self,
        src_points: np.ndarray,
        dst_points: np.ndarray,
        regularization: float = 1e-3,
    ) -> "ThinPlateSpline":
        src = np.asarray(src_points, dtype=np.float64)
        dst = np.asarray(dst_points, dtype=np.float64)
        if src.shape != dst.shape or src.ndim != 2 or src.shape[1] != 2:
            raise ValueError("src_points and dst_points must be matching (N, 2)")
        n = len(src)
        if n < MIN_TPS_POINTS:
            raise ValueError(f"need at least {MIN_TPS_POINTS} points, got {n}")

        k = _pairwise_u(src, src)
        if regularization > 0:
            k += np.eye(n) * regularization
        p = np.hstack([np.ones((n, 1)), src])          # (n, 3): [1, x, y]

        # Full system:
        #   [K  P] [w]   [dst]
        #   [P^T 0] [a] = [0]
        top = np.hstack([k, p])
        bottom = np.hstack([p.T, np.zeros((3, 3))])
        lhs = np.vstack([top, bottom])
        rhs_x = np.concatenate([dst[:, 0], np.zeros(3)])
        rhs_y = np.concatenate([dst[:, 1], np.zeros(3)])

        # lstsq (not solve): stays robust if points are near-degenerate
        # (e.g. nearly collinear), which a plain solve would blow up on.
        wx, *_ = np.linalg.lstsq(lhs, rhs_x, rcond=None)
        wy, *_ = np.linalg.lstsq(lhs, rhs_y, rcond=None)

        self._src = src
        self._wx = wx
        self._wy = wy
        return self

    def transform(self, points: np.ndarray) -> np.ndarray:
        if not self.is_fitted:
            raise RuntimeError("ThinPlateSpline is not fitted yet")
        pts = np.atleast_2d(np.asarray(points, dtype=np.float64))
        u = _pairwise_u(pts, self._src)                 # (m, n)
        n = len(self._src)
        ones = np.ones((len(pts), 1))
        affine_block = np.hstack([ones, pts])            # (m, 3)
        full = np.hstack([u, affine_block])               # (m, n+3)
        out_x = full @ self._wx
        out_y = full @ self._wy
        return np.stack([out_x, out_y], axis=-1)

    def transform_point(self, point: Point) -> Point:
        result = self.transform(np.array([point]))[0]
        return float(result[0]), float(result[1])

    def residual_rms(self, src_points: np.ndarray, dst_points: np.ndarray) -> float:
        """RMS error (dst units) after fitting — sanity check against overfitting."""
        predicted = self.transform(src_points)
        return float(np.sqrt(np.mean(np.sum((predicted - dst_points) ** 2, axis=-1))))


def fit_residual_correction(
    linear_field_points: np.ndarray,
    true_field_points: np.ndarray,
    regularization: float = 1e-3,
) -> ThinPlateSpline | None:
    """Fit a TPS that corrects the homography's field-space output.

    ``linear_field_points`` are the calibration image points already run
    through the plain homography; ``true_field_points`` are their known
    real field coordinates. Returns ``None`` (caller should fall back to
    the plain homography) when there aren't enough points to fit safely.
    """
    if len(linear_field_points) < MIN_TPS_POINTS:
        return None
    tps = ThinPlateSpline()
    try:
        tps.fit(linear_field_points, true_field_points, regularization)
    except (ValueError, np.linalg.LinAlgError):
        return None
    return tps
