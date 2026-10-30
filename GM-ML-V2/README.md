# GM-ML-V2

## Geospatial & GIS-Based Crop Survey System — Maharashtra

End-to-end crop mapping from satellite, SAR and drone imagery: crop area
estimation with confidence intervals, crop classification, health monitoring,
yield indexing, and GIS outputs a state department can open in QGIS.

Runs with **no credentials and no internet** on synthetic data, so it always
demos:

```bash
pip install -r requirements.txt
PYTHONPATH=src python3 -m cropsurvey.cli demo --district Pune --season kharif
```

---

## Part 1 — How to get satellite imagery of crops

This was the first half of the question, so it is answered in full.

### 1. ISRO Bhoonidhi — the Indian source, and your primary one

**Register:** https://bhoonidhi.nrsc.gov.in (free, individual accounts)
**API spec:** https://bhoonidhi.nrsc.gov.in/bhoonidhi-api/

| Sensor | Resolution | Revisit | Use it for |
|---|---|---|---|
| Resourcesat-2/2A LISS-III | 23.5 m | 5 days | Regional crop mapping, the workhorse optical archive |
| Resourcesat-2/2A AWiFS | 56 m | 5 days | District and state-scale area statistics |
| Resourcesat-2A LISS-IV | 5.8 m | On tasking | Parcel-level detail, limited swath |
| **EOS-04 C-band SAR** | 6–25 m | ~12 days | **Kharif under monsoon cloud** |

The API is STAC-compatible. Authentication is `POST /auth/token` with your
user ID and password; search is `POST /data/search`; download is
`GET /download?id=…&collection=…`. Two limits that will bite you if you ignore
them: **20 token requests per hour per IP** (so cache the token — this client
does, to disk) and **5 concurrent downloads**. Only products with `Online: "Y"`
can be pulled through the API; the rest are in deep archive.

```bash
export BHOONIDHI_USER="your_user_id"
export BHOONIDHI_PASS="your_password"
PYTHONPATH=src python3 -m cropsurvey.cli search --district Pune --season kharif
```

### 2. Copernicus Sentinel-2 — the fusion partner you still want

**Register:** https://dataspace.copernicus.eu (free)

10 m resolution, 5-day revisit, 13 bands including red edge and SWIR.

Be clear-eyed about why this matters alongside Bhoonidhi. Maharashtra's average
operational holding is small, and many plots are well under a hectare. At
23.5 m, a one-hectare square field is about 18 pixels and most of them touch a
boundary — so a large share of your signal is mixed with the neighbouring crop.
At 10 m it is roughly 100 pixels. **For regional statistics LISS-III is fine;
for parcel-level decisions that feed a subsidy, the resolution gap is the
single biggest driver of error.** Use Bhoonidhi for the state picture and the
institutional story, Sentinel-2 where the parcel boundary decides the answer,
and say so openly — a judge who knows Indian field sizes will ask.

### 3. Bhuvan WMS — basemaps and thematic layers, no login

`https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms`

Land-use/land-cover and administrative layers. Already wired into the web map
in `gis/webmap.py` as a toggleable overlay.

### 4. Your MAPIR Survey3 drone

The part no competing team has. Its real value is not extra imagery, it is
three things satellites cannot give you:

- **Ground truth at scale.** One flight over 40 ha yields thousands of labelled
  pixels at 2–5 cm, far more training data than a day of walking.
- **A measured mixed-pixel error.** Classify at full drone resolution, degrade
  to 10 m and 23.5 m, classify again, and report how much accuracy you lose.
  `sources/drone.py::degrade_to_satellite_grid` does this. That number is the
  honest answer to "can satellite data resolve our field sizes", and no
  satellite-only team can produce it.
- **Dispute resolution.** When a farmer contests a classification, you fly
  that parcel. That is an operational answer, not a demo.

**Calibrate it.** The Survey3 is a filtered camera, not a radiometer. Raw DN
drifts with sunlight, so NDVI from an uncalibrated Survey3 is not comparable
between flights. Photograph the MAPIR target each flight and run the empirical
line fit in `sources/drone.py::MapirCalibrator`. Skip this and your time series
is noise.

### 5. No credentials yet

The synthetic source models Maharashtra crop phenology with a double-logistic
curve, monsoon cloud loss, and SAR continuing through it. The whole pipeline
runs today.

---

## Coordinate in, analysis out

```bash
# check the data hosts are reachable (no account needed)
PYTHONPATH=src python3 -m cropsurvey.cli selftest

# then analyse any point on earth
PYTHONPATH=src python3 -m cropsurvey.cli analyze --lat 18.5204 --lon 73.8567 \
    --radius 2 --season kharif --year 2025
```

**No credentials.** This path uses Sentinel-2 L2A from AWS Open Data via
Element 84's Earth Search catalogue — no account, no API key, no token. Only
the AOI window is fetched by HTTP range request, so a 2 km radius costs a few
megabytes instead of the 1.2 GB a full tile would.

What you get in `outputs/point_<lat>_<lon>/`:

| File | What it is |
|---|---|
| `truecolor.png` | Real RGB satellite image of your coordinate |
| `ndvi.png` | Peak-of-season NDVI map with colour scale |
| `ndvi_timeseries.png` | Growth curve with start, peak and end of season marked |
| `crop_match.png` | Crop identification scores |
| `ndvi_peak.tif` | Georeferenced NDVI for QGIS |
| `analysis.json` | Every number, machine-readable |
| `report.txt` | The written summary |

### On "100% perfect"

I can't give you that, and neither can anyone else — so here is exactly what
you do get, and where the limits are.

**Measured, and correct:** the imagery itself, surface reflectance (including
the baseline-04.00 offset most code gets wrong), per-pixel cloud and shadow
masking from the scene classification layer, NDVI and the other indices, land
cover fractions, and phenology. These are measurements and the radiometry is
handled properly.

**Inferred, with a stated confidence:** the crop type. It is matched from the
shape of the growth curve, and the report gives a *fit* and a *margin over the
runner-up*. Measured on four planted test crops with a matched observation
window, the single-point matcher got 3 of 4 correct and flagged the fourth as
ambiguous rather than guessing.

**Where it will be wrong, and says so:**

- *Crops with similar cycles.* Cotton and tur peak within days of each other
  and run to similar lengths. Phenology alone cannot separate them, and the
  report prints `ambiguous — Tur fits almost as well`. For an actual decision
  use the trained classifier, which reads SWIR, red edge and SAR as well and
  reaches kappa 0.94.
- *Windows shorter than the crop.* Sugarcane runs 330 days; a kharif window is
  170. The curve is then truncated, every long crop looks short, and the system
  detects this and refuses to answer confidently rather than reporting
  sugarcane as sorghum. Widen `--start` and `--end`.
- *Cloud.* Kharif is sown into the monsoon. If too few dates survive masking
  the report says so instead of interpolating a growth curve that was never
  observed.
- *Stress is relative to your AOI.* A uniformly poor area shows nothing; a
  mixed one flags its weaker fields. It is a targeting tool, not a diagnosis.

A system that reported 100% confidence would not be more accurate than this
one. It would be the same accuracy with the errors hidden.

### Two bugs this code avoids that most pipelines have

**The baseline 04.00 offset.** From January 2022, Sentinel-2 L2A carries a
−1000 offset. Reflectance is `(DN − 1000) / 10000`, not `DN / 10000`. Miss it
and every index shifts — NDVI still looks plausible, it is simply wrong. The
offset is read per scene from the STAC metadata, not assumed.

**Day-of-year wraps at 31 December.** Any window crossing the year end — which
is *every rabi season* — has its time series scrambled if you sort on
day-of-year. This code indexes days from the window start instead. Verified on
a 15 Oct → 15 Apr window.

---

## Part 2 — The software

```
src/cropsurvey/
├── config.py              Crops, seasons, sensors, thresholds — one file to adapt
├── sources/
│   ├── base.py            ImagerySource interface, ObservationStack
│   ├── bhoonidhi.py       ISRO Bhoonidhi client (real API, token caching)
│   ├── drone.py           MAPIR Survey3 ingest + empirical-line calibration
│   ├── raster.py          Raster → parcel mean extraction
│   └── synthetic.py       Credential-free demo data
├── preprocess/
│   ├── indices.py         NDVI, EVI, SAVI, NDWI, NDMI, NDRE, GCVI, SAR ratio, RVI
│   └── timeseries.py      Gap filling, SG smoothing, phenology metrics
├── labels/
│   ├── weak.py            Pseudo-labels from district crop statistics
│   └── field_survey.py    Mobile geo-tagged schema, campaign planning
├── models/
│   ├── features.py        Stack → model matrix
│   ├── classifier.py      LightGBM crop classifier, spatially blocked CV
│   ├── health.py          Peer-relative stress detection
│   └── yield_model.py     District yield regression, parcel yield index
├── estimate/area.py       Design-based area estimation with confidence intervals
├── gis/                   GeoJSON, Shapefile, COG, web map, department report
├── pipeline.py            run_survey() — the whole thing
└── cli.py
```

### What it produces

| Output | What it is |
|---|---|
| `crop_area.csv` | Area per crop, **map area vs adjusted area with 95% CI** |
| `parcels.csv` | Per-parcel crop, confidence, health, yield index |
| `inspection_queue.csv` | Field-check list, worst and largest parcels first |
| `crop_classification.geojson` | For QGIS/ArcGIS |
| `crop_survey_map.html` | Interactive map: crop, condition, field-check layers |
| `report_<district>_<season>_<year>.txt` | Department-readable summary |
| `survey_summary.json` | For a dashboard or API |

---

## The four decisions that make this defensible

**1. Area estimates are design-based, not pixel counts.**
Counting classified parcels and summing their area gives a *biased* number with
no uncertainty. `estimate/area.py` implements the stratified estimator from
Olofsson et al. (2014), the accepted good practice in land-cover accounting: it
corrects the map count using an independent reference sample and attaches a
standard error. The difference is between *"cotton covers 412,000 ha"* and
*"cotton covers 412,000 ha, 95% CI 389,000–435,000"*. Only the second can
justify a subsidy allocation, and only the second tells the department how far
to trust it.

**2. The model abstains instead of guessing.**
Parcels with too few cloud-free observations are reported as *insufficient
data*, and low-confidence predictions are flagged for field check rather than
published. In a system that feeds payments, abstaining is a feature.

**3. Cross-validation is spatially blocked.**
Adjacent fields are strongly correlated. Random k-fold puts neighbours in both
train and test and typically overstates accuracy by 10–20 points. The classifier
uses `StratifiedGroupKFold` on spatial blocks and warns loudly when no groups
are supplied. The yield model uses leave-one-year-out for the same reason —
random folds leak weather between years.

**4. SAR carries the kharif season.**
Maharashtra's main season is sown into the monsoon, when optical imagery is
mostly cloud. Measured on the demo, with identical settings:

| Configuration | Overall accuracy | Kappa |
|---|---|---|
| Optical + SAR | 0.953 | 0.943 |
| Optical only | 0.918 | 0.901 |

**SAR is worth +4.2 points of kappa in kharif.** Run the ablation yourself with
`--no-sar`. This is the strongest technical argument in the project and it uses
ISRO's own EOS-04 data.

---

## Working without ground-truth labels

You said district crop statistics are obtainable but field points are not, yet.
`labels/weak.py` bootstraps from statistics alone:

1. Cluster parcels on phenology — crops separate without labels, because the
   shape of a growth curve is intrinsic to the crop.
2. Assign crop identities to clusters by matching cluster area shares to the
   published district shares (Hungarian assignment on the discrepancy).
3. Keep only high-confidence cluster members as pseudo-labels.
4. Correct with real field points as they arrive — `merge_with_field_labels`
   weights one visited field as ten inferred parcels.

```python
from cropsurvey.labels.weak import WeakLabeller, load_district_statistics, area_shares

stats = load_district_statistics("data/maharashtra_crop_stats.csv")
shares = area_shares(stats, district="Pune", season="kharif")
weak = WeakLabeller().fit_transform(features, shares, parcel_areas=areas)
```

### What it actually achieves — measured, not claimed

Run on four district-seasons of demo data, comparing pseudo-labels against
known truth:

| Matching cost | Mean pseudo-label accuracy |
|---|---|
| Area share alone | ~chance (0.1–34%) |
| **Area share + phenology priors** | **46%** (range 30–59%) |
| + 120 real field points | **88%** |

Two findings worth carrying into the presentation:

- **Area share alone does not work.** Several Maharashtra crops occupy similar
  shares of a district, so matching clusters to crops by share is close to
  arbitrary. Adding what we independently know — when each crop peaks, how long
  it grows, how much canopy it builds — is what makes the method function.
- **Statistics alone are not enough to ship.** 46% is a bootstrap, not a
  product. A few hundred field points take it to ~88%. The practical plan is
  to launch with pseudo-labels, send surveyors to the parcels the model is
  least sure about, and retrain.

A caveat the code cannot fix: cluster confidence measures how firmly a parcel
belongs to *its cluster*, not whether that cluster was given the *right crop*.
When a cluster is misassigned, its most confident members are confidently
wrong — which is why the confident subset is sometimes no more accurate than
the whole. Treat pseudo-label confidence as a sampling aid, never as evidence
of correctness.

**The honest limit:** this cannot discover a crop the statistics omit, and it
inherits any error in the published figures. Never report accuracy measured
against pseudo-labels — that only measures how well the model reproduced its
own assumptions. Plan a real campaign with:

```bash
PYTHONPATH=src python3 -m cropsurvey.cli sample-size
```

---

## Planning the field campaign

`labels/field_survey.py` has the mobile form schema and `plan_field_campaign`,
which stratifies by predicted crop and favours low-confidence parcels — the
allocation that most reduces final uncertainty per kilometre driven.

Two rules built into the schema and worth stating to judges:

- **The app does not show the prediction before capture.** Showing it biases
  the surveyor toward confirming it, and a reference sample contaminated that
  way makes the accuracy assessment meaningless.
- **GPS accuracy is enforced.** A point with 30 m error on a 0.4 ha plot may be
  in the neighbour's field. Such points are kept for training but excluded
  from the reference sample.

---

## Working with real Bhoonidhi products

```python
from cropsurvey.sources.bhoonidhi import BhoonidhiClient
from cropsurvey.sources.raster import extract_parcel_means, scale_reflectance

client = BhoonidhiClient()
items = client.search(["RS2A_LISS3_L2"], bbox=(73.5, 18.2, 74.2, 18.9),
                      start=date(2026, 6, 1), end=date(2026, 11, 15))
path = client.download(items[0]["id"], items[0]["collection"])
# unzip, then:
means = extract_parcel_means(band_tif, parcels, ["green", "red", "nir", "swir1"])
```

Products arrive as archives whose internal layout varies by product level, so
unzipping is left explicit rather than guessed at. One trap worth naming:
Sentinel-2 L2A from 2022 onward carries a **−1000 offset** alongside the 10000
scale factor. Getting it wrong shifts every index and NDVI still looks
plausible — it is just wrong. `scale_reflectance` takes both.

---

## What this system does not do

- **It does not diagnose.** It flags a parcel as underperforming its peers.
  Pest, disease, water stress and nutrient deficiency are separated by a person
  standing in the field. The system's job is to send them to the right one of
  ten thousand parcels.
- **It does not forecast parcel yield in kg/ha.** Yield depends on variety,
  soil depth and rainfall timing, which satellites cannot see. Forecasting is
  at district scale; parcel output is a relative index with a stated
  percentile. Published district-scale studies land around R² 0.5–0.75 — a
  model claiming 0.95 is leaking its target.
- **Synthetic accuracy is not real accuracy.** The demo's 0.94 kappa is an
  upper bound on a clean problem. Real spectral confusion between cotton and
  tur at similar growth stages is harder. Expect real kappa in the 0.65–0.85
  range with a good reference sample, and report the number you measure.

---

## Credits and references

- Olofsson, Foody, Herold, Stehman, Woodcock & Wulder (2014). Good practices
  for estimating area and assessing accuracy of land change. *Remote Sensing of
  Environment* 148, 42–57.
- Zhang et al. (2003). Monitoring vegetation phenology using MODIS. *Remote
  Sensing of Environment* 84, 471–475. (Double-logistic phenology model.)
- ISRO Bhoonidhi API: https://bhoonidhi.nrsc.gov.in/bhoonidhi-api/
- Copernicus Data Space: https://dataspace.copernicus.eu

Built for Rehydria Technology Private Limited.

---

## 15-day period analysis (real imagery only)

```bash
python3 -m cropsurvey.webapp.periodic_server
# open http://127.0.0.1:8000
```

Enter **any** latitude and longitude, or pick one of the 44 Akola coordinates
from the collapsible list. The server fetches every real Sentinel-2 pass over
that point, composites them into fixed 15-day periods on one aligned grid, and
analyses growth and health per period.

**No synthetic fallback on this path.** If imagery cannot be fetched the
request fails with the reason. A crop survey that silently shows generated
imagery is worse than one that says it has nothing.

What you get per period: a true-colour and an NDVI image (same extent, same
brightness scale across the whole season, so differences are real), mean NDVI,
growth stage, change since the previous period, direction, health, stressed
fraction, and a plain-language reading. Plus a season roll-up and a CSV export.

### Three choices that make the sequence honest

**Fixed calendar periods.** Boundaries are anchored to the start date, not to
whichever scene happened to be clear, so two coordinates analysed months apart
stay comparable.

**Maximum-NDVI compositing.** For each pixel the value kept is from the date
with the highest NDVI in that period. Residual cloud, haze and shadow all
*lower* NDVI, so the maximum preferentially selects the clearest view of that
pixel. A mean would blend haze into everything.

**No interpolation between periods.** A period with no clear view of a pixel
leaves it empty and renders it neutral grey. Every pixel shown is a real
observation.

### Known limits on this path

- Periods with no cloud-free pass are reported as empty, not filled. In the
  monsoon this is common and the summary says how many.
- Health is judged relative to the rest of the same field at the same moment,
  so a uniformly poor field shows nothing. It is a targeting tool.
- Health is not assessed at emergence — a young crop is mostly soil with
  scattered seedlings, so pixel spread is large by nature and judging it the
  same way as a closed canopy labels every healthy young crop "poor".
- Crop identity is inferred from the curve shape and carries a stated fit.
  Cotton and tur remain hard to separate.
