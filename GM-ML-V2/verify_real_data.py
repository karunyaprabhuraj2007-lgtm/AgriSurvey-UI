#!/usr/bin/env python3
"""
Proof that the pipeline works on REAL Sentinel-2 imagery.

Run this on a machine with normal internet. It needs no API key and no
account — Sentinel-2 L2A is served from the AWS Open Data archive.

    python3 verify_real_data.py
    python3 verify_real_data.py --lat 20.4749166 --lon 77.1115283

It does five things and prints the evidence for each:

  1. Confirms the data hosts are reachable
  2. Searches the real Sentinel-2 catalogue for your coordinate
  3. Prints the actual scene IDs and acquisition dates it found
  4. Downloads the real pixels and reports the reflectance values
  5. Runs the full 15-day period analysis and prints the growth table

If step 1 fails you have a network or firewall problem, not a credentials
problem — neither host requires an account.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta

sys.path.insert(0, "src")

HOSTS = [
    ("Earth Search STAC catalogue", "https://earth-search.aws.element84.com/v1"),
    ("Sentinel-2 COG archive",
     "https://sentinel-cogs.s3.us-west-2.amazonaws.com"),
]


def step(n: int, title: str) -> None:
    print(f"\n{'=' * 72}\n  STEP {n}: {title}\n{'=' * 72}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, default=20.4749166,
                    help="latitude (default: Akola site AKL-001)")
    ap.add_argument("--lon", type=float, default=77.1115283)
    ap.add_argument("--radius", type=float, default=1.0)
    ap.add_argument("--months", type=int, default=6,
                    help="how far back to look (default 6)")
    ap.add_argument("--period-days", type=int, default=15)
    args = ap.parse_args()

    end = date.today()
    start = end - timedelta(days=args.months * 30)

    # ---------------------------------------------------------------- 1
    step(1, "Are the data hosts reachable?")
    import requests
    ok = True
    for label, url in HOSTS:
        try:
            r = requests.get(url, timeout=30)
            good = r.status_code < 500
            print(f"  {'OK  ' if good else 'FAIL'}  {label:32s} HTTP {r.status_code}")
            ok &= good
        except Exception as exc:                        # noqa: BLE001
            print(f"  FAIL  {label:32s} {type(exc).__name__}: {exc}")
            ok = False
    if not ok:
        print("\n  Cannot reach the archive. Neither host needs an account, so "
              "this is a network, firewall or proxy problem.\n"
              "  Nothing below can run without it.")
        return 1

    # ---------------------------------------------------------------- 2
    step(2, "Searching the real Sentinel-2 catalogue")
    from cropsurvey.sources.earthsearch import (bbox_from_point, load_scene,
                                                search_scenes)
    bbox = bbox_from_point(args.lat, args.lon, args.radius)
    print(f"  coordinate : {args.lat:.6f}, {args.lon:.6f}")
    print(f"  bbox       : {bbox}")
    print(f"  window     : {start} to {end}")
    scenes = search_scenes(bbox, start, end, max_cloud=90.0)
    print(f"\n  FOUND {len(scenes)} REAL SCENES")
    if not scenes:
        print("  No scenes. Widen --months, or check the coordinate is on land.")
        return 1

    # ---------------------------------------------------------------- 3
    step(3, "The actual scenes (these are real Sentinel-2 product IDs)")
    for s in scenes[:12]:
        print(f"  {s.acquired:%Y-%m-%d}  cloud {s.cloud_cover:5.1f}%  "
              f"offset {s.boa_offset:+.0f}  {s.scene_id}")
    if len(scenes) > 12:
        print(f"  … and {len(scenes) - 12} more")

    # ---------------------------------------------------------------- 4
    step(4, "Downloading real pixels")
    picked = min(scenes, key=lambda s: s.cloud_cover)
    print(f"  clearest scene: {picked.scene_id}")
    print(f"  acquired      : {picked.acquired:%d %B %Y}")
    print(f"  cloud cover   : {picked.cloud_cover:.1f}%")
    print(f"  asset URL     : {picked.href('red')}")
    print("\n  reading the window from the COG over HTTP …")
    arr = load_scene(picked, bbox)
    import numpy as np
    print(f"  pixels read   : {arr.shape[0]} x {arr.shape[1]}")
    print(f"  clear pixels  : {arr.clear_fraction:.1%}")
    for b in ("blue", "green", "red", "nir"):
        if b in arr.bands:
            v = arr.bands[b]
            f = v[np.isfinite(v)]
            if f.size:
                print(f"  {b:6s} reflectance  min {f.min():.4f}  "
                      f"mean {f.mean():.4f}  max {f.max():.4f}")
    if {"red", "nir"}.issubset(arr.bands):
        red, nir = arr.bands["red"], arr.bands["nir"]
        with np.errstate(divide="ignore", invalid="ignore"):
            nd = (nir - red) / (nir + red)
        f = nd[np.isfinite(nd)]
        print(f"\n  NDVI from real pixels: mean {f.mean():+.4f}, "
              f"range {f.min():+.3f} to {f.max():+.3f}")
        print("  (vegetated farmland typically sits 0.3–0.9 in season)")

    # ---------------------------------------------------------------- 5
    step(5, f"Full {args.period_days}-day period analysis on real imagery")
    from cropsurvey.growth import growth_table
    from cropsurvey.periodic import analyse_coordinate
    res = analyse_coordinate(
        lat=args.lat, lon=args.lon, radius_km=args.radius,
        start=start, end=end, period_days=args.period_days,
    )
    print(f"  passes found {res.scenes_found}, usable {res.scenes_used}")
    print(f"  periods {len(res.analyses)}, "
          f"with imagery {sum(a.has_data for a in res.analyses)}")
    print(f"  area {res.area_ha:.0f} ha\n")
    print(growth_table(res.analyses).to_string(index=False))
    print(f"\n  CROP   : {res.crop_verdict}")
    print(f"  SEASON : {res.summary.narrative}")
    print(f"  HEALTH : {res.summary.overall_health}")
    for w in res.warnings:
        print(f"  NOTE   : {w}")
    if res.outputs:
        print("\n  Written:")
        for k, v in res.outputs.items():
            print(f"    {k:14s} {v}")

    print(f"\n{'=' * 72}")
    print("  Every number above came from real Sentinel-2 observations.")
    print(f"{'=' * 72}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
