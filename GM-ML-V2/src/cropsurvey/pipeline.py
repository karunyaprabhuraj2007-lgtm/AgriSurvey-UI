"""
End-to-end survey pipeline.

One function, `run_survey`, takes a district and season and produces every
output the department needs. It is written so that the demo path (synthetic
data, no credentials) and the production path (Bhoonidhi + Sentinel-2 + drone)
run exactly the same code after the source adapter returns its stack. If the
demo works, the production path works too, modulo data access.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .config import (CODE_TO_CROP, MODEL, NON_CROP_CODES, OUTPUT_DIR,
                     PROCESSING, SEASONS)
from .estimate.area import adjusted_area, map_area
from .gis import export as gis_export
from .gis import webmap
from .models.classifier import CropClassifier
from .models.features import build_features, quality_mask
from .models.health import HealthMonitor
from .models.yield_model import relative_yield_index
from .sources.base import ObservationStack

log = logging.getLogger(__name__)


@dataclass
class SurveyResult:
    district: str
    season: str
    year: int
    parcels: pd.DataFrame
    area_estimate: object
    evaluation: object | None
    health: object
    outputs: dict[str, Path] = field(default_factory=dict)

    def headline(self) -> str:
        crops = self.parcels[self.parcels["crop_code"] > 0]
        top = (crops.groupby("crop_name")["area_ha"].sum()
               .sort_values(ascending=False).head(3))
        bits = ", ".join(f"{n} {v:,.0f} ha" for n, v in top.items())
        flagged = int(self.parcels["needs_field_check"].sum())
        line = (f"{self.district} {self.season} {self.year}: "
                f"{len(self.parcels):,} parcels, {bits}")
        if self.evaluation is not None:
            line += f" | kappa {self.evaluation.kappa:.3f}"
        line += f" | {flagged} for field check"
        return line


def run_survey(
    stack: ObservationStack,
    truth: pd.DataFrame | None = None,
    district: str = "Pune",
    season: str = "kharif",
    year: int | None = None,
    train_fraction: float = 0.6,
    reference_fraction: float = 0.2,
    output_dir: Path | None = None,
    make_map: bool = True,
    random_state: int = 42,
) -> SurveyResult:
    """
    Run the full survey.

    The sample is split three ways, and the split is the methodologically
    important part:

      * train      — fits the classifier
      * reference  — independent sample for the design-based area estimator
      * holdout    — never touched, reserved for honest reporting

    Reusing training points in the reference sample makes the area estimator
    certify its own errors as correct. Keeping them separate is what makes the
    confidence intervals mean anything.
    """
    year = year or datetime.now(timezone.utc).year
    output_dir = Path(output_dir or OUTPUT_DIR)
    output_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(random_state)

    if season not in SEASONS:
        raise ValueError(f"unknown season {season!r}")

    log.info("Survey: %s / %s %s", district, season, year)
    log.info("Stack: %s", stack.summary())

    # -- features ----------------------------------------------------------
    features, feature_names = build_features(stack)
    valid = quality_mask(stack, PROCESSING.min_valid_observations)

    outputs: dict[str, Path] = {}
    evaluation = None

    # -- classification ----------------------------------------------------
    if truth is not None and "crop_code" in truth.columns:
        truth = truth.set_index("parcel_id").reindex(features.index).reset_index()
        y = truth["crop_code"].to_numpy(dtype=int)

        n = len(features)
        order = rng.permutation(n)
        n_train = int(train_fraction * n)
        n_ref = int(reference_fraction * n)
        train_idx = order[:n_train]
        ref_idx = order[n_train:n_train + n_ref]
        hold_idx = order[n_train + n_ref:]

        clf = CropClassifier(MODEL)

        # Spatial blocking for CV. With real data, use village or grid-cell
        # ids; here we block on a coarse lat/lon grid so that neighbouring
        # parcels cannot straddle a fold boundary.
        groups = None
        if {"lon", "lat"}.issubset(truth.columns):
            groups = (np.floor(truth["lat"].to_numpy() * 20).astype(int) * 10_000
                      + np.floor(truth["lon"].to_numpy() * 20).astype(int))
            groups = groups[train_idx]

        evaluation = clf.cross_validate(
            features.iloc[train_idx], y[train_idx], groups=groups)
        log.info("\n%s", evaluation.text())

        clf.fit(features.iloc[train_idx], y[train_idx])
        result = clf.predict(features, valid_mask=valid)

        importance = clf.feature_importance(20)
        outputs["feature_importance"] = _write_csv(
            importance, output_dir / "feature_importance.csv")
        outputs["model"] = output_dir / "crop_classifier.pkl"
        clf.save(outputs["model"])
    else:
        raise ValueError(
            "run_survey needs labels. With no field data, generate "
            "pseudo-labels first with cropsurvey.labels.weak.WeakLabeller, "
            "then pass them as `truth`.")

    classified = result.to_frame()

    # -- assemble the parcel table ----------------------------------------
    parcels = classified.copy()
    for col in ("area_ha", "lon", "lat", "district"):
        if col in truth.columns:
            parcels[col] = truth[col].to_numpy()
    if "district" not in parcels.columns:
        parcels["district"] = district
    if "area_ha" not in parcels.columns:
        parcels["area_ha"] = 1.0

    # -- health ------------------------------------------------------------
    monitor = HealthMonitor()
    health = monitor.assess(
        stack,
        crop_codes=parcels["crop_code"].to_numpy(),
        districts=parcels["district"].to_numpy(),
        areas=parcels["area_ha"].to_numpy(),
    )
    log.info("Health: %s", health.summary())

    for col in ("severity", "vigour_zscore", "peak_ndvi", "ndvi_integral",
                "early_water_stress", "flag_reason"):
        if col in health.frame.columns:
            parcels[col] = health.frame[col].to_numpy()

    # -- relative yield ----------------------------------------------------
    if "ndvi_integral" in parcels.columns:
        yi = relative_yield_index(
            parcels["ndvi_integral"].to_numpy(),
            parcels["crop_code"].to_numpy(),
            parcels["district"].to_numpy(),
        )
        parcels["yield_index"] = yi["yield_index"].to_numpy()
        parcels["yield_percentile"] = yi["percentile"].to_numpy()

    # -- area estimation ---------------------------------------------------
    naive = map_area(parcels["crop_code"].to_numpy(),
                     parcels["area_ha"].to_numpy())
    try:
        estimate = adjusted_area(
            predicted_codes=parcels["crop_code"].to_numpy(),
            parcel_areas=parcels["area_ha"].to_numpy(),
            reference_predicted=parcels["crop_code"].to_numpy()[ref_idx],
            reference_true=y[ref_idx],
        )
        log.info("\n%s", estimate.text())
    except (ValueError, KeyError) as exc:
        log.warning("Design-based estimation unavailable (%s); "
                    "falling back to map counts", exc)
        estimate = naive

    # -- exports -----------------------------------------------------------
    outputs["parcels_csv"] = _write_csv(parcels, output_dir / "parcels.csv")
    outputs["area_csv"] = _write_csv(estimate.frame, output_dir / "crop_area.csv")
    outputs["health_csv"] = _write_csv(
        health.priority_list(200), output_dir / "inspection_queue.csv")

    if {"lon", "lat"}.issubset(parcels.columns):
        gdf = gis_export.to_geodataframe(
            parcels, lon=parcels["lon"].to_numpy(),
            lat=parcels["lat"].to_numpy())
        outputs["geojson"] = gis_export.export_geojson(
            gdf, output_dir / "crop_classification.geojson")
        if make_map:
            m = webmap.build_map(
                gdf, title=f"{district} · {season} {year}")
            outputs["map"] = webmap.save_map(
                m, output_dir / "crop_survey_map.html")

    outputs["report"] = gis_export.export_department_report(
        estimate,
        evaluation.text() if evaluation else "No accuracy assessment available.",
        health.summary(), district, season, year,
        output_dir / f"report_{district}_{season}_{year}.txt",
    )

    outputs["summary_json"] = gis_export.export_summary_json({
        "district": district, "season": season, "year": year,
        "generated": datetime.now(timezone.utc).isoformat(),
        "n_parcels": int(len(parcels)),
        "n_field_check": int(parcels["needs_field_check"].sum()),
        "accuracy": {
            "overall": evaluation.accuracy if evaluation else None,
            "kappa": evaluation.kappa if evaluation else None,
            "macro_f1": evaluation.macro_f1 if evaluation else None,
        },
        "area": estimate.frame.to_dict(orient="records"),
        "health": health.frame["severity"].value_counts().to_dict(),
    }, output_dir / "survey_summary.json")

    return SurveyResult(district, season, year, parcels, estimate,
                        evaluation, health, outputs)


def _write_csv(df: pd.DataFrame, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    log.info("Wrote %s (%d rows)", path, len(df))
    return path
