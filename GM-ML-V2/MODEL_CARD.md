# Model card — crop classification

For the Maharashtra Geospatial & GIS-Based Crop Survey System.
Last updated 24 October 2026.

---

## What the model does

Classifies the crop growing on a field parcel from a season of satellite
observations, and reports a calibrated confidence alongside each prediction.
It also drives three downstream outputs: crop condition, area estimation with
confidence intervals, and an indicative yield.

**Intended use.** District and state crop surveys, area estimation for
planning, targeting field inspections, and supporting subsidy and insurance
verification *with human confirmation*.

**Out of scope.** Any decision taken on a single parcel without field
confirmation. The system is designed to tell an officer which of ten thousand
parcels to visit, not to replace the visit.

---

## Architecture

Four models are implemented and benchmarked against each other on identical
folds. The production default is gradient boosting; the deep models are
available and win on larger label sets.

| Model | Input | When it is the right choice |
|---|---|---|
| **LightGBM** (default) | 158 engineered phenology features | Under ~2,000 labels. Handles NaN natively, inspectable, best calibrated. |
| **TempCNN** (Pelletier et al. 2019) | (T=36, C=14) raw sequence | Larger label sets. Highest accuracy in our benchmark. |
| **LTAE** (Garnot & Landrieu 2020) | (T=36, C=14) + day positions | When you need to see *which dates* drove the decision — the attention weights are readable. |
| **Random forest** | Same features as LightGBM | Baseline for comparison. |
| **Ensemble** | Kappa-weighted soft vote | Best log-loss; use when probability quality matters more than top-1 accuracy. |

### Features

Seven vegetation and radar indices (NDVI, EVI, SAVI, NDWI, NDMI, NDRE, GCVI,
plus SAR VH/VV ratio and RVI), each reduced to seven distribution statistics,
with ten phenological metrics for the four most informative — start, peak and
end of season, amplitude, integral, green-up and senescence rates. Plus two
cross-index features: the moisture-to-greenness ratio, and the lag between
the optical and radar peaks.

For the deep models, each channel is paired with a **validity mask channel**,
so the network sees both the value and whether it was actually observed
rather than interpolated. Hiding cloud gaps is how a model becomes
confidently wrong over a monsoon.

---

## Measured performance

5-fold **spatially blocked** cross-validation, 2,000 parcels, 9 classes,
259 spatial blocks. Blocking matters: with random folds, neighbouring parcels
land in both train and test and accuracy comes out roughly 10–20 points above
what the model achieves on new ground.

| Model | Accuracy | Kappa | Macro F1 | Log loss | ECE |
|---|---|---|---|---|---|
| TempCNN | 0.9755 | **0.9704** | 0.9775 | 0.1889 | 0.1108 |
| Ensemble (LGBM + TempCNN) | 0.9715 | 0.9655 | 0.9720 | **0.1219** | 0.0577 |
| LightGBM | 0.9655 | 0.9582 | 0.9631 | 0.1460 | **0.0231** |
| LTAE | 0.9650 | 0.9578 | 0.9694 | 0.2109 | 0.1117 |
| Random forest | 0.9480 | 0.9369 | 0.9465 | 0.1589 | 0.0442 |
| Majority-class baseline | 0.2680 | 0.0000 | 0.0470 | 1.9353 | — |

**These numbers are from synthetic data and are an upper bound.** The
generator reproduces crop phenology, monsoon cloud loss and SAR continuity
faithfully, but it cannot reproduce the genuine spectral confusion between
crops that really do look alike. Expect real-world kappa in the **0.65–0.85**
range with a good reference sample. Report what you measure, not this table.

### The finding that mattered most

**The most accurate model was the worst calibrated.** TempCNN leads on kappa
but carries an expected calibration error of 0.11 — its 0.9-confidence
predictions are right well under 90% of the time. Since the whole system
abstains below a confidence threshold and routes those parcels to field
staff, an uncalibrated probability silently waves through a large share of
errors.

Isotonic calibration on a held-out slice:

```
ECE before : 0.1108
ECE after  : 0.0046     (24x improvement)
Brier      : 0.0595 -> 0.0363
```

Calibration is therefore **on by default** in `CropClassifier.fit()`.

### Operating points

What the calibrated model can promise, measured on held-out data:

| Target accuracy | Confidence threshold | Coverage | Goes to field |
|---|---|---|---|
| 90% | 0.453 | 100% | 0% |
| 95% | 0.947 | 96% | 4% |
| 99% | 0.976 | 22% | 78% |

This is the table a department actually needs. "99% accurate" is achievable,
but only by publishing a fifth of the parcels and visiting the rest — and
that is a budget decision, not a modelling one.

---

## What the model gets wrong

**Cotton and tur (pigeon pea).** They peak within days of each other and run
to similar lengths. Phenology alone cannot separate them; this is the single
largest error source. The system names both when the margin is under 5%.
Mitigation: SWIR and SAR features help, and the full classifier does better
than the single-point phenology matcher.

**Crops longer than the observation window.** Sugarcane runs 330 days. A
kharif window of 170 days truncates the curve, every long crop reads as a
short one, and sugarcane is reported as sorghum. The system **detects
truncation and refuses to answer confidently** rather than guessing. Widening
the window from 30 November to 31 January raised single-point recovery from
73% to 98%.

**Persistent cloud.** Where too few dates survive masking, the parcel is
reported as *insufficient data*, not given a guess.

**Rare classes.** Maharashtra's crop mix is heavily skewed. Classes with
under ~10 training samples are unreliable and the trainer warns about them.
Inverse-frequency loss weighting is applied, without which minor crops are
never predicted at all.

**Bare and non-crop land.** Handled by a hard rule, not by the classifier:
peak NDVI under 0.30, or seasonal amplitude under 0.18, means no crop was
grown. Before that rule existed, bare fields were being reported as "Bajra,
850 kg/ha".

---

## Training data and labels

The intended label source is field-collected ground truth
(`labels/field_survey.py`). Where none exists, `labels/weak.py` bootstraps
pseudo-labels from published district crop statistics by clustering on
phenology and matching cluster area shares against the official figures.

Measured on four district-seasons:

| Label source | Accuracy |
|---|---|
| Area share matching alone | ~chance |
| Area share + phenology priors | 46% |
| + 120 real field points | 88% |

**Statistics alone are not enough to ship.** They get you started; a few
hundred field points is what makes the model usable. Never report accuracy
measured against pseudo-labels — that only measures how well the model
reproduced its own assumptions.

---

## Fairness and consequences

The output can influence subsidy allocation and insurance verification, so
errors are not symmetric in their effect on people.

- **A false negative** (crop missed or misidentified) may cost a farmer a
  payment they are entitled to. The abstain mechanism exists to route these
  to human review rather than silently deny them.
- **Small holdings are harder.** At 10 m resolution a 0.4 ha field is few
  pixels and many touch a boundary, so smallholders carry more mixed-pixel
  error than large farms. This is a systematic disadvantage to the people
  least able to contest a decision. Drone verification
  (`degrade_to_satellite_grid`) measures how large the effect is; it should
  be quantified and reported, not assumed away.
- **No parcel-level decision should be automated.** The system produces a
  ranked inspection queue. A human makes the call.

---

## Reproducibility

Seeds fixed at 42 throughout. Spatial blocking required for honest numbers.
Class codes in `config.py` are stable and must not be renumbered once a model
is trained. Sequence channel order is part of the model contract — changing
it invalidates saved checkpoints.

```bash
python3 -c "
from cropsurvey.sources.synthetic import SyntheticSource
from cropsurvey.models import build_features, build_sequences, run_benchmark
src = SyntheticSource(n_parcels=2000, seed=11)
stack, truth = src.generate('kharif', 'Akola')
X, _ = build_features(stack)
S, days, _ = build_sequences(stack, n_steps=36)
print(run_benchmark(X, truth['crop_code'].to_numpy(),
                    sequences=S, days=days).text())"
```

---

## References

- Pelletier, Webb & Petitjean (2019). Temporal Convolutional Neural Network
  for the Classification of Satellite Image Time Series. *Remote Sensing*
  11(5), 523.
- Garnot & Landrieu (2020). Lightweight Temporal Self-Attention for
  Classifying Satellite Image Time Series. *ECML PKDD workshops*.
- Olofsson et al. (2014). Good practices for estimating area and assessing
  accuracy of land change. *Remote Sensing of Environment* 148, 42–57.
- Zhang et al. (2003). Monitoring vegetation phenology using MODIS. *Remote
  Sensing of Environment* 84, 471–475.
- Guo et al. (2017). On Calibration of Modern Neural Networks. *ICML*.
