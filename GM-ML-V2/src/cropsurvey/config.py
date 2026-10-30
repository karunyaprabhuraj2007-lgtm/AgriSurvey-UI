"""
Configuration and domain constants for the Maharashtra crop survey system.

Everything that encodes a decision about Maharashtra agriculture lives here, so
that adapting the system to another state means editing one file.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("CROPSURVEY_DATA", PROJECT_ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"
INTERIM_DIR = DATA_DIR / "interim"
OUTPUT_DIR = Path(os.environ.get("CROPSURVEY_OUT", PROJECT_ROOT / "outputs"))

for _d in (DATA_DIR, RAW_DIR, INTERIM_DIR, OUTPUT_DIR):
    _d.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------
# Cropping seasons
#
# Maharashtra runs three seasons. Getting these boundaries right matters more
# than any model choice: a classifier fed a Jan-Dec window learns the average
# of two unrelated crops grown on the same parcel.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Season:
    name: str
    start_doy: int          # day-of-year the observation window opens
    end_doy: int            # day-of-year it closes
    spans_year_end: bool    # True when the window crosses 31 December
    note: str

    @property
    def length_days(self) -> int:
        if self.spans_year_end:
            return (365 - self.start_doy) + self.end_doy
        return self.end_doy - self.start_doy


SEASONS = {
    "kharif": Season(
        name="kharif",
        start_doy=152,   # 1 June
        end_doy=319,     # 15 November
        spans_year_end=False,
        note="Monsoon-sown. Persistent cloud June-September makes optical "
             "imagery unreliable; SAR carries the classification.",
    ),
    "rabi": Season(
        name="rabi",
        start_doy=288,   # 15 October
        end_doy=105,     # 15 April
        spans_year_end=True,
        note="Post-monsoon, irrigated. Clear skies — optical works well.",
    ),
    "summer": Season(
        name="summer",
        start_doy=60,    # 1 March
        end_doy=166,     # 15 June
        spans_year_end=False,
        note="Irrigated only. Small area, dominated by fodder and groundnut.",
    ),
}


# --------------------------------------------------------------------------
# Crop classes
#
# Ordered by area under cultivation in Maharashtra. `code` values are stable
# and must not be renumbered once a model is trained against them.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class CropClass:
    code: int
    name: str
    season: str
    duration_days: int       # sowing to harvest
    peak_vi: float           # typical peak NDVI at full canopy
    colour: str              # map colour

    # Double-logistic phenology parameters used by the synthetic generator
    # and as priors in the weak-supervision step.
    sow_offset_days: int = 0   # days after season start that sowing typically begins
    greenup_rate: float = 0.12
    senesce_rate: float = 0.14


CROP_CLASSES = [
    CropClass(1,  "Cotton",       "kharif", 180, 0.78, "#e07b39", sow_offset_days=10),
    CropClass(2,  "Soybean",      "kharif", 105, 0.82, "#6aa84f", sow_offset_days=12),
    CropClass(3,  "Sugarcane",    "annual", 330, 0.86, "#38761d", sow_offset_days=0,
              greenup_rate=0.06, senesce_rate=0.05),
    CropClass(4,  "Tur (pigeon pea)", "kharif", 165, 0.72, "#a64d79", sow_offset_days=14),
    CropClass(5,  "Jowar (sorghum)",  "kharif", 115, 0.68, "#bf9000", sow_offset_days=8),
    CropClass(6,  "Bajra (pearl millet)", "kharif", 90, 0.62, "#d4a017", sow_offset_days=6),
    CropClass(7,  "Gram (chickpea)",  "rabi",   110, 0.70, "#8e7cc3", sow_offset_days=15),
    CropClass(8,  "Wheat",         "rabi",   120, 0.80, "#f1c232", sow_offset_days=20),
    CropClass(9,  "Onion",         "rabi",   140, 0.66, "#cc4125", sow_offset_days=18),
    CropClass(10, "Grapes",        "annual", 300, 0.74, "#741b47", sow_offset_days=0,
              greenup_rate=0.09, senesce_rate=0.08),
    CropClass(11, "Fallow / bare", "any",     0,  0.16, "#b7b7b7",
              greenup_rate=0.01, senesce_rate=0.01),
    CropClass(12, "Non-crop",      "any",     0,  0.30, "#999999",
              greenup_rate=0.01, senesce_rate=0.01),
]

CODE_TO_CROP = {c.code: c for c in CROP_CLASSES}
NAME_TO_CROP = {c.name: c for c in CROP_CLASSES}
CROP_COLOURS = {c.code: c.colour for c in CROP_CLASSES}

#: Classes that are not crops. Excluded from area statistics reported to the
#: department, but kept in the classifier so it has somewhere to put them.
NON_CROP_CODES = {11, 12}


# --------------------------------------------------------------------------
# Spectral bands
#
# Named generically so that Sentinel-2, Resourcesat LISS-III and the MAPIR
# Survey3 all map onto the same feature vector.
# --------------------------------------------------------------------------

BANDS = ["blue", "green", "red", "red_edge", "nir", "swir1", "swir2"]

#: Which bands each sensor actually provides. The feature builder fills
#: missing bands with NaN and the models handle them natively.
SENSOR_BANDS = {
    "sentinel2":   ["blue", "green", "red", "red_edge", "nir", "swir1", "swir2"],
    "liss3":       ["green", "red", "nir", "swir1"],
    "liss4":       ["green", "red", "nir"],
    "awifs":       ["green", "red", "nir", "swir1"],
    "mapir_s3_ocn": ["blue", "green", "nir"],       # MAPIR Survey3 OCN filter
    "mapir_s3_rgn": ["red", "green", "nir"],        # MAPIR Survey3 RGN filter
}

#: SAR channels, kept separate because they are not reflectance.
SAR_BANDS = ["vv", "vh"]


# --------------------------------------------------------------------------
# Imagery source settings
# --------------------------------------------------------------------------

@dataclass
class BhoonidhiConfig:
    """ISRO Bhoonidhi (NRSC) EO data hub."""
    base_url: str = "https://bhoonidhi-api.nrsc.gov.in"
    user_id: str | None = field(default_factory=lambda: os.environ.get("BHOONIDHI_USER"))
    password: str | None = field(default_factory=lambda: os.environ.get("BHOONIDHI_PASS"))
    # Token requests are rate-limited to 20/hour/IP — cache aggressively.
    token_cache: Path = INTERIM_DIR / "bhoonidhi_token.json"
    max_concurrent_downloads: int = 4   # portal limit is 5; stay under it


@dataclass
class CopernicusConfig:
    """Copernicus Data Space — Sentinel-2 and Sentinel-1."""
    stac_url: str = "https://catalogue.dataspace.copernicus.eu/stac"
    token_url: str = ("https://identity.dataspace.copernicus.eu/auth/realms/CDSE/"
                      "protocol/openid-connect/token")
    username: str | None = field(default_factory=lambda: os.environ.get("CDSE_USER"))
    password: str | None = field(default_factory=lambda: os.environ.get("CDSE_PASS"))


@dataclass
class BhuvanConfig:
    """Bhuvan WMS — basemaps and thematic layers, no authentication."""
    wms_url: str = "https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms"
    wms_version: str = "1.1.1"


# --------------------------------------------------------------------------
# Processing parameters
# --------------------------------------------------------------------------

@dataclass
class ProcessingConfig:
    #: Composite window. 10 days balances cloud gaps against phenological detail.
    composite_days: int = 10

    #: Maximum share of a parcel that may be cloudy before the observation is
    #: dropped rather than averaged.
    max_cloud_fraction: float = 0.35

    #: Minimum valid observations in a season for a parcel to be classified.
    #: Below this the parcel is reported as "insufficient data" rather than
    #: given a guess — which matters when the output drives subsidy decisions.
    min_valid_observations: int = 6

    #: Savitzky-Golay smoothing of the VI time series.
    smooth_window: int = 5
    smooth_polyorder: int = 2

    #: Speckle filter window for SAR.
    speckle_window: int = 5

    #: Target grid resolution in metres for the analysis stack.
    target_resolution_m: int = 10


@dataclass
class ModelConfig:
    n_estimators: int = 400
    learning_rate: float = 0.05
    num_leaves: int = 63
    min_child_samples: int = 20
    subsample: float = 0.85
    colsample_bytree: float = 0.8
    random_state: int = 42

    #: Confidence below which a parcel prediction is flagged for field check
    #: instead of being published.
    low_confidence_threshold: float = 0.55


PROCESSING = ProcessingConfig()
MODEL = ModelConfig()
BHOONIDHI = BhoonidhiConfig()
COPERNICUS = CopernicusConfig()
BHUVAN = BhuvanConfig()


# --------------------------------------------------------------------------
# Maharashtra reference geography
#
# Representative district centroids, used for demo AOIs and for joining
# district-level crop statistics. Replace with the official boundary
# shapefile from the state remote sensing centre for production use.
# --------------------------------------------------------------------------

MAHARASHTRA_DISTRICTS = {
    "Pune":        (18.5204, 73.8567),
    "Ahmednagar":  (19.0948, 74.7480),
    "Nashik":      (19.9975, 73.7898),
    "Solapur":     (17.6599, 75.9064),
    "Aurangabad":  (19.8762, 75.3433),
    "Nagpur":      (21.1458, 79.0882),
    "Amravati":    (20.9320, 77.7523),
    "Yavatmal":    (20.3888, 78.1204),
    "Jalgaon":     (21.0077, 75.5626),
    "Kolhapur":    (16.7050, 74.2433),
    "Satara":      (17.6805, 74.0183),
    "Latur":       (18.4088, 76.5604),
}

#: Approximate bounding box of Maharashtra (minx, miny, maxx, maxy) in EPSG:4326.
MAHARASHTRA_BBOX = (72.6, 15.6, 80.9, 22.1)
