"""
Mobile geo-tagged field data collection.

The schema and validation for ground-truth points collected on a phone. This
closes the loop the problem statement asks for: satellite classifies, field
staff verify, verification retrains the model.

Two design decisions worth defending:

1. **The app records what the surveyor saw, not what the model predicted.**
   Showing the prediction before capture biases the surveyor toward confirming
   it, and a reference sample contaminated that way makes the accuracy
   assessment meaningless. Prediction is revealed only after submission.

2. **GPS accuracy is recorded and enforced.** A point with 30 m accuracy on a
   0.4 ha plot may be in the neighbour's field. Points above the threshold are
   kept but excluded from the reference sample.
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import NAME_TO_CROP, SEASONS

log = logging.getLogger(__name__)

#: Above this GPS error, a point cannot be trusted to fall in the intended
#: parcel given Maharashtra's typical holding size.
MAX_GPS_ACCURACY_M = 10.0

GROWTH_STAGES = ["sowing", "vegetative", "flowering", "grain_filling",
                 "maturity", "harvested", "fallow"]

CONDITIONS = ["healthy", "water_stress", "pest_damage", "disease",
              "nutrient_deficiency", "waterlogged", "damaged_other"]


@dataclass
class FieldObservation:
    """One ground-truth record captured in the field."""
    observation_id: str
    surveyor_id: str
    recorded_at: str                 # ISO 8601 with timezone
    lon: float
    lat: float
    gps_accuracy_m: float
    crop_name: str
    season: str
    growth_stage: str = "vegetative"
    condition: str = "healthy"
    irrigated: bool | None = None
    parcel_id: str | None = None
    plot_area_ha: float | None = None
    photo_paths: list[str] = field(default_factory=list)
    notes: str = ""

    # Set by the pipeline, never by the surveyor.
    predicted_crop: str | None = None
    agrees_with_model: bool | None = None

    def validate(self) -> list[str]:
        """Return a list of problems; empty means the record is usable."""
        problems: list[str] = []

        if self.crop_name not in NAME_TO_CROP:
            problems.append(
                f"unknown crop {self.crop_name!r}; "
                f"must be one of {sorted(NAME_TO_CROP)}")
        if self.season not in SEASONS:
            problems.append(f"unknown season {self.season!r}")
        if self.growth_stage not in GROWTH_STAGES:
            problems.append(f"unknown growth stage {self.growth_stage!r}")
        if self.condition not in CONDITIONS:
            problems.append(f"unknown condition {self.condition!r}")

        # Maharashtra's extent, with a small margin.
        if not (72.0 <= self.lon <= 81.5):
            problems.append(f"longitude {self.lon} outside Maharashtra")
        if not (15.0 <= self.lat <= 22.5):
            problems.append(f"latitude {self.lat} outside Maharashtra")

        if self.gps_accuracy_m > MAX_GPS_ACCURACY_M:
            problems.append(
                f"GPS accuracy {self.gps_accuracy_m:.0f} m exceeds "
                f"{MAX_GPS_ACCURACY_M:.0f} m — usable for training, "
                f"not for the reference sample")

        try:
            datetime.fromisoformat(self.recorded_at.replace("Z", "+00:00"))
        except ValueError:
            problems.append(f"unparseable timestamp {self.recorded_at!r}")

        if not self.photo_paths:
            problems.append("no photograph attached — a disputed "
                            "classification cannot be adjudicated without one")
        return problems

    @property
    def crop_code(self) -> int:
        return NAME_TO_CROP[self.crop_name].code


class FieldSurveyStore:
    """Collect, validate and export field observations."""

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else None
        self.observations: list[FieldObservation] = []
        if self.path and self.path.exists():
            self.load()

    def add(self, obs: FieldObservation, strict: bool = False) -> list[str]:
        problems = obs.validate()
        if problems:
            msg = f"{obs.observation_id}: " + "; ".join(problems)
            if strict:
                raise ValueError(msg)
            log.warning(msg)
        self.observations.append(obs)
        return problems

    def load(self) -> None:
        if not self.path or not self.path.exists():
            return
        blob = json.loads(self.path.read_text())
        self.observations = [FieldObservation(**r) for r in blob]
        log.info("Loaded %d field observations", len(self.observations))

    def save(self) -> Path:
        if not self.path:
            raise ValueError("no path set on this store")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(
            [asdict(o) for o in self.observations], indent=2))
        log.info("Saved %d observations to %s", len(self.observations), self.path)
        return self.path

    def to_frame(self, reference_grade_only: bool = False) -> pd.DataFrame:
        """
        Export as a DataFrame.

        `reference_grade_only=True` keeps only records fit for the accuracy
        assessment: clean validation and GPS accuracy within threshold.
        """
        rows = []
        for o in self.observations:
            problems = o.validate()
            gps_ok = o.gps_accuracy_m <= MAX_GPS_ACCURACY_M
            if reference_grade_only and (problems or not gps_ok):
                continue
            rows.append({
                "observation_id": o.observation_id,
                "parcel_id": o.parcel_id,
                "surveyor_id": o.surveyor_id,
                "recorded_at": o.recorded_at,
                "lon": o.lon, "lat": o.lat,
                "gps_accuracy_m": o.gps_accuracy_m,
                "crop_name": o.crop_name,
                "crop_code": (o.crop_code if o.crop_name in NAME_TO_CROP
                              else np.nan),
                "season": o.season,
                "growth_stage": o.growth_stage,
                "condition": o.condition,
                "irrigated": o.irrigated,
                "plot_area_ha": o.plot_area_ha,
                "n_photos": len(o.photo_paths),
                "reference_grade": bool(not problems and gps_ok),
            })
        df = pd.DataFrame(rows)
        if reference_grade_only:
            log.info("%d/%d observations are reference grade",
                     len(df), len(self.observations))
        return df

    def surveyor_quality(self) -> pd.DataFrame:
        """
        Per-surveyor data quality.

        Worth watching: a surveyor whose points systematically disagree with
        the model is either finding real errors or recording carelessly, and
        the difference shows up as a pattern across their whole set rather
        than in any single point.
        """
        df = self.to_frame()
        if df.empty:
            return df
        agg = df.groupby("surveyor_id").agg(
            n_observations=("observation_id", "count"),
            mean_gps_accuracy_m=("gps_accuracy_m", "mean"),
            pct_reference_grade=("reference_grade", "mean"),
            mean_photos=("n_photos", "mean"),
        ).reset_index()
        agg["pct_reference_grade"] = (agg["pct_reference_grade"] * 100).round(1)
        return agg.sort_values("n_observations", ascending=False)


def plan_field_campaign(parcels: pd.DataFrame,
                        n_points: int = 400,
                        min_per_class: int = 30,
                        random_state: int = 42) -> pd.DataFrame:
    """
    Choose which parcels to visit.

    Allocation is stratified by predicted crop, with a floor per class, and
    within a stratum it favours low-confidence parcels. This is the allocation
    that most reduces the uncertainty on the final area estimate per kilometre
    driven — which is the thing a department is actually buying when it funds
    a field campaign.
    """
    required = {"parcel_id", "crop_code"}
    missing = required - set(parcels.columns)
    if missing:
        raise ValueError(f"parcels missing {sorted(missing)}")

    rng = np.random.default_rng(random_state)
    crops = parcels[parcels["crop_code"] > 0]
    if crops.empty:
        raise ValueError("no classified parcels to sample")

    classes = sorted(crops["crop_code"].unique())
    shares = crops["crop_code"].value_counts(normalize=True)

    picks = []
    for code in classes:
        pool = crops[crops["crop_code"] == code]
        want = max(min_per_class, int(round(shares.get(code, 0) * n_points)))
        want = min(want, len(pool))
        if "confidence" in pool.columns:
            # Weight toward uncertain parcels — visiting an obvious sugarcane
            # field teaches the model nothing.
            w = (1.0 - pool["confidence"].fillna(0.5).to_numpy())
            w = np.clip(w, 0.05, None)
            w = w / w.sum()
            idx = rng.choice(len(pool), size=want, replace=False, p=w)
        else:
            idx = rng.choice(len(pool), size=want, replace=False)
        picks.append(pool.iloc[idx])

    plan = pd.concat(picks, ignore_index=True)
    plan["visit_priority"] = (
        plan["confidence"].rank() if "confidence" in plan.columns
        else range(len(plan))
    )
    log.info("Field campaign: %d parcels across %d crops",
             len(plan), len(classes))
    return plan.sort_values("visit_priority").reset_index(drop=True)


MOBILE_APP_SCHEMA = {
    "form_version": "1.0",
    "offline_capable": True,
    "fields": [
        {"id": "gps", "type": "location", "required": True,
         "capture": "automatic", "min_accuracy_m": MAX_GPS_ACCURACY_M,
         "note": "Block submission until accuracy is within threshold."},
        {"id": "photo_canopy", "type": "photo", "required": True,
         "note": "Looking down at the canopy, roughly 1 m above."},
        {"id": "photo_field", "type": "photo", "required": True,
         "note": "Wide shot showing the whole plot and its boundary."},
        {"id": "crop_name", "type": "select", "required": True,
         "options": sorted(NAME_TO_CROP)},
        {"id": "growth_stage", "type": "select", "required": True,
         "options": GROWTH_STAGES},
        {"id": "condition", "type": "select", "required": True,
         "options": CONDITIONS},
        {"id": "irrigated", "type": "boolean", "required": False},
        {"id": "plot_area_ha", "type": "number", "required": False},
        {"id": "notes", "type": "text", "required": False},
    ],
    "rules": [
        "Do not display the model prediction before submission.",
        "Queue submissions offline and sync when a connection returns; "
        "field staff work where there is no signal.",
        "Stamp each record with the app version and form version so that a "
        "schema change is traceable in the training data.",
    ],
}
