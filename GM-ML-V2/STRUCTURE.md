# Project structure

```
maharashtra-crop-survey/
├── README.md                       Imagery sources, usage, limits
├── MODEL_CARD.md                   What the model is, measured, and gets wrong
├── STRUCTURE.md                    This file
├── requirements.txt
├── data/
│   └── akola_sites.csv             The 44 client coordinates
│
├── src/cropsurvey/
│   ├── config.py                   Crops, seasons, sensors, thresholds
│   ├── pipeline.py                 run_survey() — whole-district survey
│   ├── analyze.py                  analyze_point() — one coordinate, whole season
│   ├── composite.py                15-day period compositing, aligned grid
│   ├── growth.py                   per-period growth stage, health, season roll-up
│   ├── periodic.py                 analyse_coordinate() — THE MAIN ENTRY POINT
│   ├── windows.py                  Client assessment windows + yield
│   ├── cli.py                      demo / analyze / search / sources / selftest
│   │
│   ├── sources/                    WHERE IMAGERY COMES FROM
│   │   ├── base.py                 ImagerySource interface, ObservationStack
│   │   ├── earthsearch.py          Sentinel-2 via AWS Open Data (no credentials)
│   │   ├── bhoonidhi.py            ISRO Bhoonidhi STAC client
│   │   ├── drone.py                MAPIR Survey3 + empirical-line calibration
│   │   ├── raster.py               Raster → parcel mean extraction
│   │   └── synthetic.py            Offline source, runs with no network
│   │
│   ├── preprocess/                 TURNING PIXELS INTO SIGNAL
│   │   ├── indices.py              NDVI EVI SAVI NDWI NDMI NDRE GCVI, SAR ratio, RVI
│   │   └── timeseries.py           Gap filling, SG smoothing, phenology metrics
│   │
│   ├── models/                     THE ML
│   │   ├── features.py             Stack → 158-feature matrix
│   │   ├── sequences.py            Stack → (T,C) tensor + validity masks + augmentation
│   │   ├── classifier.py           LightGBM, spatially blocked CV, auto-calibration
│   │   ├── deep.py                 TempCNN + LTAE (PyTorch, optional)
│   │   ├── calibration.py          Isotonic/Platt, ECE, selective prediction
│   │   ├── benchmark.py            All models on identical folds
│   │   ├── health.py               Peer-relative stress detection
│   │   └── yield_model.py          District yield regression, parcel index
│   │
│   ├── labels/                     GETTING GROUND TRUTH
│   │   ├── weak.py                 Pseudo-labels from district statistics
│   │   └── field_survey.py         Mobile schema, campaign planning
│   │
│   ├── estimate/
│   │   └── area.py                 Design-based area + confidence intervals
│   │
│   ├── gis/
│   │   ├── export.py               GeoJSON, Shapefile, COG, reports
│   │   └── webmap.py               Interactive map
│   │
│   └── webapp/                     THE UI
│       ├── periodic_server.py      MAIN: any coordinate, 15-day periods, real imagery
│       ├── static/periodic.html    its front end
│       ├── server.py               legacy site-list app, kept for the client workbook
│       ├── demo_source.py          Offline imagery for --demo
│       └── static/index.html       Map + detail panel
│
└── tests/
    └── offline_fixture.py          Real GeoTIFFs for network-free testing
```

## Data flow

```
coordinate or parcel polygons
        │
        ▼
  ImagerySource ──────────────► ObservationStack
  (Sentinel-2 / Bhoonidhi /     (n_parcels, n_dates, n_bands)
   drone / synthetic)                   │
                                        ▼
                            cloud mask, indices, gap fill, smooth
                                        │
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
                 build_features()                build_sequences()
                 158 phenology features          (T=36, C=14) + masks
                        │                               │
                        ▼                               ▼
                   LightGBM                      TempCNN / LTAE
                        └───────────────┬───────────────┘
                                        ▼
                            calibration (isotonic)
                                        │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                  crop + conf      area estimate    health / yield
                  (abstain if       + 95% CI         + inspection
                   low conf)                            queue
                                        │
                                        ▼
                      GeoJSON · Shapefile · COG · XLSX · web map
```

## Where to look first

| Question | File |
|---|---|
| How do I get imagery? | `README.md`, `sources/earthsearch.py` |
| How good is the model? | `MODEL_CARD.md` |
| How is a crop decided? | `models/classifier.py`, `analyze.py::_match_crop` |
| Why does it abstain? | `models/calibration.py` |
| Which model should I use? | `models/benchmark.py` — measure, don't assume |
| How do I add a sensor? | `sources/base.py`, implement `ImagerySource` |
| What does the client get? | `webapp/server.py::_write_workbook` |
| Coordinate → 15-day analysis | `periodic.py::analyse_coordinate` |
| How are periods composited? | `composite.py` |
| How is growth staged? | `growth.py::_stage` |
