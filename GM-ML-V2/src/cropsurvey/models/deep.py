"""
Deep temporal models for satellite image time series.

Two architectures, both established in the remote-sensing literature rather
than invented here:

**TempCNN** — Pelletier, Webb & Petitjean (2019), "Temporal Convolutional
Neural Network for the Classification of Satellite Image Time Series",
Remote Sensing 11(5). Stacked 1-D convolutions over the time axis. It is the
standard deep baseline for this task and is hard to beat on small datasets.

**LTAE** — Garnot & Landrieu (2020), "Lightweight Temporal Self-Attention for
Classifying Satellite Image Time Series". Self-attention with a *learned
master query* per head rather than queries derived from the sequence, which
collapses the attention to a single pass and cuts parameters by roughly an
order of magnitude against a standard transformer. That matters here: with a
few hundred labelled parcels, a full transformer overfits and a lightweight
one does not.

Why both, and why gradient boosting stays the default: on a few hundred
labels, LightGBM on phenology features usually wins. Deep models overtake it
somewhere in the low thousands. The benchmark harness measures which is ahead
on *your* data rather than assuming, and the honest answer for a new district
is usually "boosting, for now".
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

log = logging.getLogger(__name__)

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:                                  # pragma: no cover
    TORCH_AVAILABLE = False
    torch = None                                      # type: ignore
    nn = object                                       # type: ignore


def require_torch() -> None:
    if not TORCH_AVAILABLE:
        raise ImportError(
            "PyTorch is needed for the deep models. Install with "
            "`pip install torch`, or use CropClassifier (LightGBM), which "
            "needs no deep learning stack and is the better choice below a "
            "few thousand labels anyway.")


# ---------------------------------------------------------------------------
# TempCNN
# ---------------------------------------------------------------------------

if TORCH_AVAILABLE:

    class TempCNN(nn.Module):
        """Pelletier et al. 2019. Three temporal conv blocks, then a dense head."""

        def __init__(self, n_channels: int, n_classes: int, n_steps: int,
                     n_filters: int = 64, kernel_size: int = 5,
                     dropout: float = 0.2, dense_units: int = 256):
            super().__init__()
            pad = kernel_size // 2

            def block(cin: int) -> nn.Sequential:
                return nn.Sequential(
                    nn.Conv1d(cin, n_filters, kernel_size, padding=pad),
                    nn.BatchNorm1d(n_filters),
                    nn.ReLU(),
                    nn.Dropout(dropout),
                )

            self.conv = nn.Sequential(block(n_channels), block(n_filters),
                                      block(n_filters))
            self.head = nn.Sequential(
                nn.Flatten(),
                nn.Linear(n_filters * n_steps, dense_units),
                nn.BatchNorm1d(dense_units),
                nn.ReLU(),
                nn.Dropout(dropout),
                nn.Linear(dense_units, n_classes),
            )

        def forward(self, x: "torch.Tensor") -> "torch.Tensor":
            # (B, T, C) -> (B, C, T) for Conv1d
            return self.head(self.conv(x.transpose(1, 2)))

    # -----------------------------------------------------------------------
    # LTAE
    # -----------------------------------------------------------------------

    class PositionalEncoding(nn.Module):
        """
        Sinusoidal encoding of the actual day index, not the step number.

        Encoding position by index would tell the model only the order of
        observations. A crop is defined by *when* it greens, so the calendar
        day is the information that matters and it is what gets encoded.
        """

        def __init__(self, d_model: int, max_days: int = 400):
            super().__init__()
            pe = torch.zeros(max_days, d_model)
            pos = torch.arange(0, max_days, dtype=torch.float32).unsqueeze(1)
            div = torch.exp(torch.arange(0, d_model, 2).float()
                            * (-np.log(10000.0) / d_model))
            pe[:, 0::2] = torch.sin(pos * div)
            if d_model % 2 == 1:
                pe[:, 1::2] = torch.cos(pos * div[:-1])
            else:
                pe[:, 1::2] = torch.cos(pos * div)
            self.register_buffer("pe", pe)

        def forward(self, x: "torch.Tensor", days: "torch.Tensor") -> "torch.Tensor":
            idx = days.long().clamp(0, self.pe.shape[0] - 1)
            return x + self.pe[idx].unsqueeze(0)

    class LTAE(nn.Module):
        """
        Lightweight Temporal Attention Encoder (Garnot & Landrieu 2020).

        The master query is the trick: instead of computing queries from the
        sequence, each head holds one learned query vector. Attention becomes
        a single weighted pooling over time, parameters drop sharply, and the
        attention weights are directly readable as "which part of the season
        decided this" — which is worth having when a farmer disputes a
        classification.
        """

        def __init__(self, n_channels: int, n_classes: int, n_steps: int,
                     d_model: int = 128, n_heads: int = 8,
                     d_k: int = 16, mlp_units: tuple[int, ...] = (128, 64),
                     dropout: float = 0.2):
            super().__init__()
            self.n_heads, self.d_k, self.d_model = n_heads, d_k, d_model

            self.inconv = nn.Sequential(
                nn.Conv1d(n_channels, d_model, 1),
                nn.BatchNorm1d(d_model),
                nn.ReLU(),
            )
            self.pos = PositionalEncoding(d_model)
            # One learned query per head.
            self.master_query = nn.Parameter(torch.randn(n_heads, d_k) * 0.1)
            self.to_key = nn.Linear(d_model, n_heads * d_k)
            self.to_value = nn.Linear(d_model, n_heads * (d_model // n_heads))
            self.norm_in = nn.LayerNorm(d_model)
            self.dropout = nn.Dropout(dropout)

            layers: list[nn.Module] = []
            prev = d_model
            for u in mlp_units:
                layers += [nn.Linear(prev, u), nn.BatchNorm1d(u),
                           nn.ReLU(), nn.Dropout(dropout)]
                prev = u
            layers.append(nn.Linear(prev, n_classes))
            self.mlp = nn.Sequential(*layers)
            self._last_attention: "torch.Tensor | None" = None

        def forward(self, x: "torch.Tensor",
                    days: "torch.Tensor | None" = None) -> "torch.Tensor":
            B, T, _ = x.shape
            h = self.inconv(x.transpose(1, 2)).transpose(1, 2)     # (B,T,d)
            if days is not None:
                h = self.pos(h, days)
            h = self.norm_in(h)

            d_v = self.d_model // self.n_heads
            k = self.to_key(h).view(B, T, self.n_heads, self.d_k)
            v = self.to_value(h).view(B, T, self.n_heads, d_v)

            # (B, T, H) attention logits against the master queries
            logits = torch.einsum("bthk,hk->bth", k, self.master_query)
            logits = logits / np.sqrt(self.d_k)
            attn = torch.softmax(logits, dim=1)
            self._last_attention = attn.detach()

            pooled = torch.einsum("bth,bthv->bhv", attn, v)        # (B,H,d_v)
            return self.mlp(self.dropout(pooled.reshape(B, -1)))

        def attention_over_time(self) -> np.ndarray | None:
            """Mean attention per timestep — which dates drove the decision."""
            if self._last_attention is None:
                return None
            return self._last_attention.mean(dim=2).cpu().numpy()


@dataclass
class TrainConfig:
    epochs: int = 120
    batch_size: int = 64
    lr: float = 1e-3
    weight_decay: float = 1e-4
    patience: int = 20
    label_smoothing: float = 0.05
    seed: int = 42
    verbose: bool = False


class DeepClassifier:
    """
    Train/predict wrapper around TempCNN or LTAE.

    Class imbalance is handled with inverse-frequency loss weights rather than
    resampling. Maharashtra's crop mix is heavily skewed — bajra is a few
    percent of cotton's area — and without weighting the minor crops are
    simply never predicted.
    """

    def __init__(self, architecture: str = "ltae",
                 config: TrainConfig | None = None, **model_kwargs):
        require_torch()
        if architecture not in ("ltae", "tempcnn"):
            raise ValueError("architecture must be 'ltae' or 'tempcnn'")
        self.architecture = architecture
        self.cfg = config or TrainConfig()
        self.model_kwargs = model_kwargs
        self.model = None
        self.class_codes: np.ndarray = np.array([])
        self.history: list[dict] = []

    def _build(self, n_channels: int, n_classes: int, n_steps: int):
        torch.manual_seed(self.cfg.seed)
        if self.architecture == "tempcnn":
            return TempCNN(n_channels, n_classes, n_steps, **self.model_kwargs)
        return LTAE(n_channels, n_classes, n_steps, **self.model_kwargs)

    def fit(self, X: np.ndarray, y: np.ndarray,
            days: np.ndarray | None = None,
            X_val: np.ndarray | None = None,
            y_val: np.ndarray | None = None) -> "DeepClassifier":
        from torch.utils.data import DataLoader, TensorDataset

        self.class_codes = np.array(sorted(np.unique(y)))
        remap = {c: i for i, c in enumerate(self.class_codes)}
        yi = np.array([remap[v] for v in y], dtype=np.int64)

        n_steps, n_ch = X.shape[1], X.shape[2]
        self.model = self._build(n_ch, len(self.class_codes), n_steps)

        d = (torch.tensor(days, dtype=torch.float32) if days is not None
             else torch.arange(n_steps, dtype=torch.float32))
        self._days = d

        counts = np.bincount(yi, minlength=len(self.class_codes)).astype(float)
        weights = torch.tensor(
            (counts.sum() / np.maximum(counts, 1)) / len(counts),
            dtype=torch.float32)

        crit = nn.CrossEntropyLoss(weight=weights,
                                   label_smoothing=self.cfg.label_smoothing)
        opt = torch.optim.AdamW(self.model.parameters(), lr=self.cfg.lr,
                                weight_decay=self.cfg.weight_decay)
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(
            opt, T_max=self.cfg.epochs)

        ds = TensorDataset(torch.tensor(X, dtype=torch.float32),
                           torch.tensor(yi))
        dl = DataLoader(ds, batch_size=self.cfg.batch_size, shuffle=True,
                        drop_last=len(ds) > self.cfg.batch_size)

        best, best_state, bad = np.inf, None, 0
        for epoch in range(self.cfg.epochs):
            self.model.train()
            total = 0.0
            for xb, yb in dl:
                opt.zero_grad()
                out = (self.model(xb, d) if self.architecture == "ltae"
                       else self.model(xb))
                loss = crit(out, yb)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 2.0)
                opt.step()
                total += float(loss) * len(xb)
            sched.step()
            train_loss = total / max(len(ds), 1)

            monitor = train_loss
            val_acc = None
            if X_val is not None and y_val is not None:
                self.model.eval()
                with torch.no_grad():
                    xb = torch.tensor(X_val, dtype=torch.float32)
                    out = (self.model(xb, d) if self.architecture == "ltae"
                           else self.model(xb))
                    yv = np.array([remap.get(v, 0) for v in y_val])
                    vloss = float(crit(out, torch.tensor(yv)))
                    val_acc = float((out.argmax(1).numpy() == yv).mean())
                monitor = vloss

            self.history.append({"epoch": epoch, "train_loss": train_loss,
                                 "monitor": monitor, "val_acc": val_acc})

            if monitor < best - 1e-4:
                best, bad = monitor, 0
                best_state = {k: v.clone()
                              for k, v in self.model.state_dict().items()}
            else:
                bad += 1
                if bad >= self.cfg.patience:
                    if self.cfg.verbose:
                        log.info("early stop at epoch %d", epoch)
                    break

        if best_state is not None:
            self.model.load_state_dict(best_state)
        log.info("%s trained: %d epochs, best monitor %.4f",
                 self.architecture.upper(), len(self.history), best)
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise RuntimeError("call fit() first")
        self.model.eval()
        out = []
        with torch.no_grad():
            for i in range(0, len(X), 256):
                xb = torch.tensor(X[i:i + 256], dtype=torch.float32)
                o = (self.model(xb, self._days) if self.architecture == "ltae"
                     else self.model(xb))
                out.append(torch.softmax(o, dim=1).numpy())
        return np.concatenate(out)

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.class_codes[self.predict_proba(X).argmax(axis=1)]

    def n_parameters(self) -> int:
        if self.model is None:
            return 0
        return sum(p.numel() for p in self.model.parameters())

    def temporal_attention(self) -> np.ndarray | None:
        """LTAE only — mean attention per timestep from the last forward pass."""
        if self.architecture != "ltae" or self.model is None:
            return None
        return self.model.attention_over_time()
