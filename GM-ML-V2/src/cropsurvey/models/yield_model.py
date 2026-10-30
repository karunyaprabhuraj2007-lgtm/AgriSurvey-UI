"""
Yield forecasting.

Honest framing first, because yield is where remote-sensing projects most often
overclaim. Satellite data explains a meaningful share of yield variance — the
seasonal VI integral is a real biomass proxy — but yield is also driven by
variety, soil depth, management and the timing of rainfall relative to
flowering, none of which a satellite sees. Published district-scale studies
typically report R² around 0.5-0.75. A model claiming 0.95 is fitting noise or
leaking the target.

So this model is built to forecast at *district* scale, where errors average
out, and to report parcel-level output only as a relative index. That is the
scale at which the Maharashtra Agriculture Department actually plans.

Training targets come from published district crop statistics (season-wise area
and production), which is the data source you said you can obtain.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import LeaveOneGroupOut

log = logging.getLogger(__name__)


@dataclass
class YieldReport:
    r2: float
    mae: float
    rmse: float
    n_samples: int
    n_groups: int
    predictions: pd.DataFrame

    def text(self) -> str:
        lines = [
            "Yield model performance (leave-one-year-out)",
            "-" * 58,
            f"  R²   : {self.r2:.3f}",
            f"  MAE  : {self.mae:,.0f} kg/ha",
            f"  RMSE : {self.rmse:,.0f} kg/ha",
            f"  n    : {self.n_samples} district-seasons "
            f"across {self.n_groups} years",
        ]
        if self.r2 < 0.4:
            lines.append("  R² below 0.4 — report as indicative only, not as a "
                         "forecast. More seasons of history is the fix.")
        elif self.r2 > 0.92:
            lines.append("  R² above 0.92 is implausible for yield from imagery. "
                         "Check for target leakage before trusting this.")
        return "\n".join(lines)


class YieldForecaster:
    """
    District-scale yield regression on phenological and weather features.

    Validation is leave-one-year-out, never random k-fold. Random folds put
    the same year in train and test, and because all districts in a year share
    the same weather this inflates R² dramatically.
    """

    FEATURES = [
        "ndvi_integral", "ndvi_peak_value", "ndvi_peak_doy",
        "ndvi_season_length", "ndvi_greenup_rate",
        "ndmi_mean", "ndmi_min",
        "rainfall_total_mm", "rainfall_cv",
        "gdd_accumulated", "dry_spell_max_days",
        "area_ha",
    ]

    def __init__(self, n_estimators: int = 300, max_depth: int = 3,
                 learning_rate: float = 0.05, random_state: int = 42):
        self.model = GradientBoostingRegressor(
            n_estimators=n_estimators, max_depth=max_depth,
            learning_rate=learning_rate, subsample=0.85,
            random_state=random_state,
        )
        self.feature_names: list[str] = []
        self._fitted = False

    def _matrix(self, df: pd.DataFrame) -> tuple[np.ndarray, list[str]]:
        cols = [c for c in self.FEATURES if c in df.columns]
        if len(cols) < 3:
            raise ValueError(
                f"need at least 3 of {self.FEATURES}; got {cols}")
        X = df[cols].to_numpy(dtype=float)
        # GradientBoostingRegressor has no native NaN handling.
        medians = np.nanmedian(X, axis=0)
        medians = np.where(np.isfinite(medians), medians, 0.0)
        X = np.where(np.isfinite(X), X, medians)
        return X, cols

    def fit(self, df: pd.DataFrame, target: str = "yield_kg_ha"
            ) -> "YieldForecaster":
        if target not in df:
            raise ValueError(f"target column {target!r} not in frame")
        X, cols = self._matrix(df)
        self.feature_names = cols
        self.model.fit(X, df[target].to_numpy(dtype=float))
        self._fitted = True
        log.info("Yield model fitted on %d rows, %d features", len(df), len(cols))
        return self

    def validate(self, df: pd.DataFrame, target: str = "yield_kg_ha",
                 group_col: str = "year") -> YieldReport:
        if group_col not in df:
            raise ValueError(
                f"{group_col!r} required for leave-one-group-out validation. "
                "Random splits leak weather between folds and overstate R².")
        X, cols = self._matrix(df)
        y = df[target].to_numpy(dtype=float)
        groups = df[group_col].to_numpy()

        n_groups = len(np.unique(groups))
        if n_groups < 3:
            raise ValueError(
                f"only {n_groups} distinct {group_col} values — need at least 3 "
                "seasons of history for an honest yield validation.")

        oof = np.full(len(y), np.nan)
        for train_idx, test_idx in LeaveOneGroupOut().split(X, y, groups):
            m = GradientBoostingRegressor(**self.model.get_params())
            m.fit(X[train_idx], y[train_idx])
            oof[test_idx] = m.predict(X[test_idx])

        ok = np.isfinite(oof)
        resid = y[ok] - oof[ok]
        preds = df.loc[ok, [c for c in ("district", "year", "crop_name")
                            if c in df.columns]].copy()
        preds["actual_kg_ha"] = y[ok]
        preds["predicted_kg_ha"] = oof[ok]
        preds["error_kg_ha"] = resid

        return YieldReport(
            r2=float(r2_score(y[ok], oof[ok])),
            mae=float(mean_absolute_error(y[ok], oof[ok])),
            rmse=float(np.sqrt(np.mean(resid ** 2))),
            n_samples=int(ok.sum()),
            n_groups=n_groups,
            predictions=preds.reset_index(drop=True),
        )

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        if not self._fitted:
            raise RuntimeError("call fit() first")
        missing = set(self.feature_names) - set(df.columns)
        if missing:
            raise ValueError(f"missing features at prediction: {sorted(missing)}")
        X = df[self.feature_names].to_numpy(dtype=float)
        medians = np.nanmedian(X, axis=0)
        medians = np.where(np.isfinite(medians), medians, 0.0)
        return self.model.predict(np.where(np.isfinite(X), X, medians))

    def importance(self) -> pd.DataFrame:
        if not self._fitted:
            raise RuntimeError("model not fitted")
        return (pd.DataFrame({"feature": self.feature_names,
                              "importance": self.model.feature_importances_})
                .sort_values("importance", ascending=False)
                .reset_index(drop=True))


def relative_yield_index(ndvi_integral: np.ndarray,
                         crop_codes: np.ndarray,
                         districts: np.ndarray) -> pd.DataFrame:
    """
    Parcel-level relative yield potential, scaled 0-100.

    Not a yield figure in kg/ha. It says "this parcel is in the bottom decile
    of cotton fields in this district this season", which is both defensible
    from imagery alone and directly actionable for targeting field visits.
    Publishing a parcel-level kg/ha number from satellite data would not be
    defensible, so this module does not offer one.
    """
    df = pd.DataFrame({
        "ndvi_integral": ndvi_integral,
        "crop_code": crop_codes.astype(int),
        "district": districts,
    })
    df["yield_index"] = np.nan
    df["percentile"] = np.nan

    for _, grp in df.groupby(["crop_code", "district"], dropna=False):
        if len(grp) < 10:
            continue
        vals = grp["ndvi_integral"].to_numpy(dtype=float)
        finite = np.isfinite(vals)
        if finite.sum() < 10:
            continue
        lo, hi = np.nanpercentile(vals, [5, 95])
        if hi - lo < 1e-9:
            continue
        df.loc[grp.index, "yield_index"] = np.clip(
            100.0 * (vals - lo) / (hi - lo), 0, 100)
        ranks = pd.Series(vals).rank(pct=True).to_numpy() * 100
        df.loc[grp.index, "percentile"] = ranks

    return df
