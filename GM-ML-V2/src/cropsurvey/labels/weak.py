"""
Weak supervision from district crop statistics.

The situation you are in: no field-collected crop labels, but published
district-level area statistics from the Maharashtra Agriculture Department.
That is enough to bootstrap a classifier, and this module is how.

The method, in order of how much it matters:

1. Cluster parcels by their phenological signature. Crops separate into
   clusters without any labels, because the shape of a growth curve is
   intrinsic to the crop.
2. Assign crop identities to clusters by matching cluster area shares to the
   published district area shares, solving the assignment that minimises total
   discrepancy.
3. Keep only high-confidence cluster members as pseudo-labels.
4. Train on those, then correct with whatever real field points you gather.

What this buys you and what it does not: it gets a working classifier on day
one without a field campaign. It cannot discover a crop the statistics omit,
and it inherits any error in the published figures. Treat the result as a
starting point to be corrected by ground truth, never as validated output —
and never report accuracy computed against pseudo-labels, because that only
measures how well the model reproduced its own assumptions.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

from ..config import CODE_TO_CROP, NAME_TO_CROP

log = logging.getLogger(__name__)


@dataclass
class WeakLabelResult:
    parcel_ids: np.ndarray
    pseudo_code: np.ndarray
    confidence: np.ndarray
    cluster_id: np.ndarray
    assignment: dict[int, int]
    area_match_error: float

    def confident(self, threshold: float = 0.7) -> np.ndarray:
        return self.confidence >= threshold

    def summary(self) -> str:
        n_conf = int(self.confident().sum())
        names = {c: CODE_TO_CROP[v].name for c, v in self.assignment.items()}
        return (f"{len(self.parcel_ids)} parcels into {len(self.assignment)} "
                f"clusters | {n_conf} confident pseudo-labels "
                f"({n_conf / max(len(self.parcel_ids), 1):.0%}) | "
                f"area match error {self.area_match_error:.3f}\n"
                f"  cluster -> crop: {names}")


def load_district_statistics(path: str) -> pd.DataFrame:
    """
    Read published district crop statistics.

    Expected columns: district, season, crop_name, area_ha
    Sources: data.gov.in agriculture catalogues, the Maharashtra Economic
    Survey, or the department's season-wise area and production tables.
    """
    df = pd.read_csv(path)
    required = {"district", "season", "crop_name", "area_ha"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"statistics file missing columns: {sorted(missing)}")
    unknown = set(df["crop_name"]) - set(NAME_TO_CROP)
    if unknown:
        log.warning("Crop names not in the class list, will be ignored: %s",
                    sorted(unknown))
    df["crop_code"] = df["crop_name"].map(
        lambda n: NAME_TO_CROP[n].code if n in NAME_TO_CROP else np.nan)
    return df.dropna(subset=["crop_code"])


def area_shares(stats: pd.DataFrame, district: str,
                season: str) -> dict[int, float]:
    """Crop code -> share of cropped area for one district and season."""
    sel = stats[(stats["district"] == district) & (stats["season"] == season)]
    if sel.empty:
        raise ValueError(f"no statistics for {district}/{season}")
    total = float(sel["area_ha"].sum())
    if total <= 0:
        raise ValueError(f"zero total area for {district}/{season}")
    return {int(r.crop_code): float(r.area_ha) / total
            for r in sel.itertuples()}


class WeakLabeller:
    """Cluster parcels and assign crop identities from area statistics."""

    def __init__(self, random_state: int = 42, n_init: int = 10):
        self.random_state = random_state
        self.n_init = n_init
        self.scaler = StandardScaler()
        self.kmeans: KMeans | None = None

    @staticmethod
    def _cluster_phenology(features: pd.DataFrame, cluster_id: np.ndarray,
                           k: int) -> dict[str, np.ndarray]:
        """Mean observed phenology per cluster, used to identify the crop."""
        def col(*candidates):
            for c in candidates:
                if c in features.columns:
                    return features[c].to_numpy(dtype=float)
            return np.full(len(features), np.nan)

        peak = col("ndvi_peak_doy", "evi_peak_doy")
        amp = col("ndvi_amplitude", "evi_amplitude")
        length = col("ndvi_season_length", "evi_season_length")

        out = {kk: np.full(k, np.nan) for kk in ("peak_doy", "amplitude", "length")}
        for c in range(k):
            m = cluster_id == c
            if not m.any():
                continue
            with np.errstate(invalid="ignore"):
                out["peak_doy"][c] = np.nanmedian(peak[m])
                out["amplitude"][c] = np.nanmedian(amp[m])
                out["length"][c] = np.nanmedian(length[m])
        return out

    @staticmethod
    def _crop_phenology_priors(codes, season: str) -> dict[int, dict]:
        """
        Expected phenology per crop, from the agronomic constants in config.

        This is the prior knowledge that makes label-free bootstrapping work:
        we may not know which cluster is cotton, but we do know cotton peaks
        about 100 days after a mid-June sowing and holds canopy for 180 days,
        which no other kharif crop in the list does.
        """
        from ..config import SEASONS

        start = SEASONS[season].start_doy
        priors: dict[int, dict] = {}
        for code in codes:
            crop = CODE_TO_CROP[int(code)]
            has_cycle = crop.duration_days > 0 and crop.season != "any"
            priors[int(code)] = {
                "has_cycle": has_cycle,
                # Peak canopy sits a little past the midpoint of the cycle.
                "peak_doy": start + crop.sow_offset_days + 0.55 * crop.duration_days,
                "length": 0.78 * crop.duration_days,
                "amplitude": max(crop.peak_vi - 0.14, 0.02),
            }
        return priors

    def fit_transform(
        self,
        features: pd.DataFrame,
        target_shares: dict[int, float],
        parcel_areas: np.ndarray | None = None,
        feature_subset: list[str] | None = None,
        season: str = "kharif",
        area_weight: float = 1.0,
        phenology_weight: float = 2.0,
    ) -> WeakLabelResult:
        if not target_shares:
            raise ValueError("target_shares is empty")

        # Cluster on phenology, not on raw reflectance: phenology is what
        # distinguishes crops, reflectance is dominated by soil and haze.
        cols = feature_subset or [
            c for c in features.columns
            if any(k in c for k in ("peak", "sos", "eos", "integral",
                                    "amplitude", "season_length",
                                    "greenup", "senescence"))
        ]
        if len(cols) < 3:
            log.warning("Few phenology features found; falling back to all "
                        "features, which clusters less cleanly")
            cols = list(features.columns)

        X = features[cols].to_numpy(dtype=float)
        medians = np.nanmedian(X, axis=0)
        medians = np.where(np.isfinite(medians), medians, 0.0)
        X = np.where(np.isfinite(X), X, medians)
        Xs = self.scaler.fit_transform(X)

        codes = sorted(target_shares)
        k = len(codes)
        if k < 2:
            raise ValueError("need at least 2 crops in the statistics")
        if len(features) < k * 10:
            raise ValueError(
                f"{len(features)} parcels is too few for {k} clusters; "
                "need roughly 10 parcels per crop class at minimum")

        self.kmeans = KMeans(n_clusters=k, random_state=self.random_state,
                             n_init=self.n_init)
        cluster_id = self.kmeans.fit_predict(Xs)

        areas = (parcel_areas if parcel_areas is not None
                 else np.ones(len(features), dtype=float))
        total_area = float(areas.sum())
        cluster_shares = np.array([
            float(areas[cluster_id == c].sum()) / total_area for c in range(k)
        ])

        # Hungarian assignment on a combined cost.
        #
        # Area share alone is far too weak a signal: several Maharashtra crops
        # occupy similar shares of a district, so matching on share is close to
        # arbitrary and produces an assignment no better than chance. The fix is
        # to add what we independently know about each crop — when it peaks, how
        # long it grows, how much canopy it builds — and let the phenology carry
        # most of the decision, with area share breaking ties.
        target = np.array([target_shares[c] for c in codes])
        area_cost = np.abs(cluster_shares[:, None] - target[None, :])

        obs = self._cluster_phenology(features, cluster_id, k)
        exp = self._crop_phenology_priors(codes, season)

        peak_cost = np.zeros_like(area_cost)
        amp_cost = np.zeros_like(area_cost)
        len_cost = np.zeros_like(area_cost)

        for ci in range(k):
            for cj, code in enumerate(codes):
                e = exp[int(code)]
                # Perennial and non-crop classes have no sowing-to-harvest
                # cycle, so timing carries no information for them; they are
                # identified by their flat, low-amplitude profile instead.
                if e["has_cycle"] and np.isfinite(obs["peak_doy"][ci]):
                    peak_cost[ci, cj] = min(
                        abs(obs["peak_doy"][ci] - e["peak_doy"]) / 90.0, 1.5)
                    if np.isfinite(obs["length"][ci]):
                        len_cost[ci, cj] = min(
                            abs(obs["length"][ci] - e["length"]) / 150.0, 1.5)
                if np.isfinite(obs["amplitude"][ci]):
                    amp_cost[ci, cj] = min(
                        abs(obs["amplitude"][ci] - e["amplitude"]) / 0.6, 1.5)

        cost = (area_weight * area_cost
                + phenology_weight * (0.5 * peak_cost + 0.3 * amp_cost
                                      + 0.2 * len_cost))

        rows, cols_idx = linear_sum_assignment(cost)
        assignment = {int(r): int(codes[c]) for r, c in zip(rows, cols_idx)}
        match_error = float(area_cost[rows, cols_idx].sum())

        pseudo = np.array([assignment[int(c)] for c in cluster_id], dtype=int)

        # Confidence from relative distance to the assigned centroid: points
        # near their centre are far likelier to be correctly identified than
        # points on a cluster boundary.
        dists = self.kmeans.transform(Xs)
        own = dists[np.arange(len(dists)), cluster_id]
        partitioned = np.partition(dists, 1, axis=1)
        nearest_other = np.where(partitioned[:, 0] < own - 1e-12,
                                 partitioned[:, 0], partitioned[:, 1])
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = np.where(nearest_other > 1e-9, own / nearest_other, 1.0)
        confidence = np.clip(1.0 - ratio, 0.0, 1.0).astype(np.float32)

        result = WeakLabelResult(
            parcel_ids=np.asarray(features.index),
            pseudo_code=pseudo,
            confidence=confidence,
            cluster_id=cluster_id,
            assignment=assignment,
            area_match_error=match_error,
        )
        if match_error > 0.35:
            log.warning(
                "Area match error %.3f is high — the clusters do not line up "
                "with the published area shares. The pseudo-labels are "
                "probably wrong. Check the season, or collect real points.",
                match_error)
        log.info("Weak labelling: %s", result.summary())
        return result


def merge_with_field_labels(weak: WeakLabelResult,
                            field_labels: pd.DataFrame,
                            weak_confidence_threshold: float = 0.7,
                            field_weight: float = 10.0
                            ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Combine pseudo-labels with real field observations.

    Real points override pseudo-labels wherever both exist, and carry a much
    higher sample weight. `field_weight=10` means one visited field counts as
    ten inferred parcels during training — the right order of magnitude when
    pseudo-labels are maybe 70% correct and field points near 100%.

    Returns (parcel_ids, labels, sample_weights).
    """
    required = {"parcel_id", "crop_code"}
    missing = required - set(field_labels.columns)
    if missing:
        raise ValueError(f"field_labels missing {sorted(missing)}")

    keep = weak.confident(weak_confidence_threshold)
    ids = list(weak.parcel_ids[keep])
    labels = list(weak.pseudo_code[keep])
    weights = [1.0] * len(ids)

    truth = dict(zip(field_labels["parcel_id"],
                     field_labels["crop_code"].astype(int)))
    index = {pid: i for i, pid in enumerate(ids)}

    replaced = added = 0
    for pid, code in truth.items():
        if pid in index:
            i = index[pid]
            labels[i] = code
            weights[i] = field_weight
            replaced += 1
        else:
            ids.append(pid)
            labels.append(code)
            weights.append(field_weight)
            added += 1

    log.info("Merged labels: %d pseudo kept, %d corrected by field data, "
             "%d field-only added", len(ids) - replaced - added, replaced, added)
    return (np.array(ids), np.array(labels, dtype=int),
            np.array(weights, dtype=float))
