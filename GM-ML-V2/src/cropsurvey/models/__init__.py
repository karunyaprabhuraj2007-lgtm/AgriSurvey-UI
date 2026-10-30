from .classifier import CropClassifier, ClassificationResult, EvaluationReport
from .features import build_features, quality_mask
from .health import HealthMonitor, HealthResult
from .yield_model import YieldForecaster, relative_yield_index
from .sequences import build_sequences, augment_sequences, SEQUENCE_CHANNELS
from .calibration import (ProbabilityCalibrator, expected_calibration_error,
                          selective_prediction_curve, recommend_threshold,
                          uncertainty_signals)
from .benchmark import run_benchmark, calibration_study, BenchmarkResult

__all__ = [
    "CropClassifier", "ClassificationResult", "EvaluationReport",
    "build_features", "quality_mask", "HealthMonitor", "HealthResult",
    "YieldForecaster", "relative_yield_index",
    "build_sequences", "augment_sequences", "SEQUENCE_CHANNELS",
    "ProbabilityCalibrator", "expected_calibration_error",
    "selective_prediction_curve", "recommend_threshold",
    "uncertainty_signals",
    "run_benchmark", "calibration_study", "BenchmarkResult",
]

# Deep models are optional — the package works without PyTorch.
try:
    from .deep import DeepClassifier, TempCNN, LTAE, TrainConfig
    __all__ += ["DeepClassifier", "TempCNN", "LTAE", "TrainConfig"]
except ImportError:  # pragma: no cover
    pass
