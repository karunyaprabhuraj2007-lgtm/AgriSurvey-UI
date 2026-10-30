"""
Sequence tensors for the deep temporal models.

Gradient boosting consumes hand-built phenology features. Deep temporal models
consume the raw series and learn their own, which is their whole advantage —
but they need a fixed-length, regularly spaced, NaN-free tensor, and satellite
time series are none of those things.

This module does that conversion honestly. The important decision: rather than
silently imputing cloud gaps and letting the model treat invented values as
observations, every channel is paired with a validity mask channel. The model
sees both what was measured and whether it was measured, and learns to
discount the filled stretches itself. Hiding the gaps is how a model becomes
confidently wrong over a monsoon.
"""
from __future__ import annotations

import logging

import numpy as np

from ..preprocess.indices import compute_indices, compute_sar_features
from ..preprocess.timeseries import interpolate_gaps, smooth_series
from ..sources.base import ObservationStack

log = logging.getLogger(__name__)

#: Channels fed to the deep models, in a fixed order. Order is part of the
#: model contract — changing it invalidates every saved checkpoint.
SEQUENCE_CHANNELS = ("ndvi", "evi", "ndmi", "ndwi", "gcvi",
                     "sar_ratio", "sar_vh")


def build_sequences(
    stack: ObservationStack,
    channels: tuple[str, ...] = SEQUENCE_CHANNELS,
    n_steps: int = 36,
    smooth: bool = True,
    with_mask: bool = True,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    Build a (n_samples, n_steps, n_channels) tensor on a regular time grid.

    Returns (X, time_positions, channel_names). `time_positions` is the day
    index of each step, which the attention model uses for positional
    encoding — a crop is defined by *when* things happen, so the model must be
    told the calendar, not just the order.
    """
    series: dict[str, np.ndarray] = {}
    series.update(compute_indices(stack))
    series.update(compute_sar_features(stack))

    available = [c for c in channels if c in series]
    if not available:
        raise ValueError(
            f"none of {channels} could be computed from bands "
            f"{stack.band_names}")
    missing = [c for c in channels if c not in series]
    if missing:
        log.info("Sequence channels unavailable for this sensor: %s", missing)

    grid = np.linspace(float(stack.doys[0]), float(stack.doys[-1]), n_steps)
    n = stack.n_parcels
    n_ch = len(available) * (2 if with_mask else 1)
    X = np.zeros((n, n_steps, n_ch), dtype=np.float32)

    names: list[str] = []
    for ci, name in enumerate(available):
        raw = series[name]
        observed = np.isfinite(raw)

        filled = interpolate_gaps(raw, stack.doys)
        if smooth:
            filled = smooth_series(filled)

        for i in range(n):
            valid = np.isfinite(filled[i])
            if valid.sum() >= 2:
                X[i, :, ci] = np.interp(grid, stack.doys[valid],
                                        filled[i][valid]).astype(np.float32)
            elif valid.sum() == 1:
                X[i, :, ci] = float(filled[i][valid][0])
            # else leaves zeros, and the mask channel records that

        if with_mask:
            mi = len(available) + ci
            for i in range(n):
                if observed[i].any():
                    X[i, :, mi] = np.interp(
                        grid, stack.doys, observed[i].astype(np.float32)
                    ).astype(np.float32)
        names.append(name)

    channel_names = list(names) + ([f"{c}_observed" for c in names]
                                   if with_mask else [])

    # Per-channel standardisation using robust statistics, so a handful of
    # extreme pixels cannot set the scale for everything else.
    for c in range(X.shape[2]):
        v = X[:, :, c]
        med = np.median(v)
        iqr = np.percentile(v, 75) - np.percentile(v, 25)
        scale = iqr if iqr > 1e-6 else (v.std() if v.std() > 1e-6 else 1.0)
        X[:, :, c] = (v - med) / scale

    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    log.info("Sequences: %s, channels %s", X.shape, channel_names)
    return X, grid.astype(np.float32), channel_names


def augment_sequences(
    X: np.ndarray,
    y: np.ndarray,
    n_augment: int = 2,
    jitter_std: float = 0.03,
    time_shift_max: int = 2,
    dropout_prob: float = 0.12,
    rng: np.random.Generator | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Augment a small labelled set.

    Three transformations, each chosen because it mimics a real source of
    variation rather than just adding noise:

      * **value jitter** — sensor noise and atmospheric correction residual
      * **time shift** — farmers in the same village sow days apart
      * **observation dropout** — extra cloud, the dominant real-world nuisance

    This matters here specifically because ground truth is scarce. With a few
    hundred field points a deep model overfits almost immediately; augmentation
    is what makes training one defensible at all.
    """
    rng = rng or np.random.default_rng(42)
    Xs, ys = [X], [y]

    for _ in range(n_augment):
        Xa = X.copy()
        Xa += rng.normal(0, jitter_std, Xa.shape).astype(np.float32)

        shifts = rng.integers(-time_shift_max, time_shift_max + 1, len(Xa))
        for i, s in enumerate(shifts):
            if s:
                Xa[i] = np.roll(Xa[i], int(s), axis=0)

        drop = rng.random(Xa.shape[:2]) < dropout_prob
        n_half = Xa.shape[2] // 2
        for i in range(len(Xa)):
            steps = np.flatnonzero(drop[i])
            if steps.size:
                # Zero the value channels and mark the mask channels as
                # unobserved, exactly as real cloud would present.
                Xa[i, steps, :n_half] = 0.0
                if Xa.shape[2] > n_half:
                    Xa[i, steps, n_half:] = 0.0
        Xs.append(Xa)
        ys.append(y)

    Xo, yo = np.concatenate(Xs), np.concatenate(ys)
    log.info("Augmented %d -> %d samples", len(X), len(Xo))
    return Xo, yo
