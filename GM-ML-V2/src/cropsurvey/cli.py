"""
Command-line interface.

    python -m cropsurvey.cli demo --district Pune --season kharif
    python -m cropsurvey.cli sources
    python -m cropsurvey.cli search --district Pune --season kharif
    python -m cropsurvey.cli sample-size
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, datetime, timedelta
from pathlib import Path


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)-28s %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("rasterio").setLevel(logging.WARNING)
    logging.getLogger("fiona").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def cmd_demo(args: argparse.Namespace) -> int:
    """Run the full pipeline on synthetic data — no credentials needed."""
    from .pipeline import run_survey
    from .sources.synthetic import SyntheticSource

    print(f"\n{'=' * 74}")
    print(f"  CROP SURVEY DEMO — {args.district}, {args.season} {args.year}")
    print(f"  Synthetic imagery. Accuracy here is an upper bound, not a result.")
    print(f"{'=' * 74}\n")

    source = SyntheticSource(n_parcels=args.parcels, seed=args.seed,
                             include_sar=not args.no_sar)
    stack, truth = source.generate(season=args.season, district=args.district)

    result = run_survey(
        stack=stack, truth=truth,
        district=args.district, season=args.season, year=args.year,
        output_dir=Path(args.output) if args.output else None,
        make_map=not args.no_map,
    )

    print(f"\n{'=' * 74}")
    print("  RESULT")
    print(f"{'=' * 74}")
    print(f"  {result.headline()}\n")
    print("  Outputs:")
    for key, path in result.outputs.items():
        print(f"    {key:22s} {path}")
    print()
    return 0


def cmd_sources(args: argparse.Namespace) -> int:
    """Show how to obtain satellite imagery and which sources are ready."""
    from .sources.bhoonidhi import BhoonidhiSource, describe_access

    print(describe_access())
    print("Current availability")
    print("=" * 74)

    checks = [("bhoonidhi", BhoonidhiSource())]
    try:
        from .sources.drone import DroneSource
        checks.append(("drone (MAPIR Survey3)", DroneSource()))
    except Exception:  # noqa: BLE001
        pass
    from .sources.synthetic import SyntheticSource
    checks.append(("synthetic", SyntheticSource()))

    for label, src in checks:
        ok, reason = src.available()
        mark = "ready" if ok else "not ready"
        print(f"  {label:26s} {mark:10s} {reason}")
    print()
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    """Search Bhoonidhi for scenes over a district."""
    from .config import MAHARASHTRA_DISTRICTS, SEASONS
    from .sources.bhoonidhi import BhoonidhiSource

    src = BhoonidhiSource()
    ok, reason = src.available()
    if not ok:
        print(f"Cannot search: {reason}", file=sys.stderr)
        return 1

    if args.district not in MAHARASHTRA_DISTRICTS:
        print(f"Unknown district {args.district!r}. Known: "
              f"{', '.join(sorted(MAHARASHTRA_DISTRICTS))}", file=sys.stderr)
        return 1

    lat, lon = MAHARASHTRA_DISTRICTS[args.district]
    pad = args.radius_deg
    bbox = (lon - pad, lat - pad, lon + pad, lat + pad)

    season = SEASONS[args.season]
    start = date(args.year, 1, 1) + timedelta(days=season.start_doy - 1)
    end = (date(args.year + (1 if season.spans_year_end else 0), 1, 1)
           + timedelta(days=season.end_doy - 1))

    scenes = src.search(bbox, start, end, max_cloud=args.max_cloud)
    print(f"\n{len(scenes)} scenes over {args.district}, "
          f"{start} to {end}\n")
    for s in scenes[:args.limit]:
        print(f"  {s}")
    if len(scenes) > args.limit:
        print(f"  ... and {len(scenes) - args.limit} more")
    print()
    return 0


def cmd_sample_size(args: argparse.Namespace) -> int:
    """How many ground-truth points a field campaign needs."""
    from .estimate.area import required_sample_size

    assumed = {1: 0.85, 2: 0.86, 3: 0.90, 4: 0.72, 5: 0.70,
               6: 0.65, 7: 0.78, 8: 0.88, 9: 0.74, 10: 0.80}
    df = required_sample_size(assumed, target_se_pct=args.target_se)
    print("\nGround-truth points required per crop")
    print(f"(target relative standard error {args.target_se}%)\n")
    print(df.to_string(index=False))
    print(f"\n  Total field points: {int(df['n_required'].sum()):,}")
    print("  Spread them across villages, not clustered — clustered samples "
          "give an interval narrower than the truth.\n")
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    """Fetch and analyse satellite imagery for one coordinate."""
    from datetime import date as _date
    from .analyze import analyze_point

    start = _date.fromisoformat(args.start) if args.start else None
    end = _date.fromisoformat(args.end) if args.end else None

    print(f"\nAnalysing {args.lat:.5f}, {args.lon:.5f} "
          f"({args.radius} km radius)\n")
    try:
        res = analyze_point(
            lat=args.lat, lon=args.lon, radius_km=args.radius,
            season=args.season, year=args.year, start=start, end=end,
            max_cloud=args.max_cloud, min_clear_fraction=args.min_clear,
            max_scenes=args.max_scenes,
            output_dir=args.output,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"\nAnalysis failed: {exc}\n", file=sys.stderr)
        if "ProxyError" in type(exc).__name__ or "Connection" in str(exc):
            print("That looks like a network problem. This command needs "
                  "outbound HTTPS to earth-search.aws.element84.com and "
                  "sentinel-cogs.s3.us-west-2.amazonaws.com.\n",
                  file=sys.stderr)
        return 1

    print(res.text())
    if res.outputs:
        print("\nOutputs:")
        for key, path in res.outputs.items():
            print(f"  {key:12s} {path}")
    print()
    return 0


def cmd_ui(args: argparse.Namespace) -> int:
    """Launch the 15-day period analysis web UI."""
    from .webapp.periodic_server import main as ui_main
    return ui_main(["--host", args.host, "--port", str(args.port)])


def cmd_selftest(args: argparse.Namespace) -> int:
    """Check whether the satellite data hosts are reachable from here."""
    import requests
    hosts = [
        ("Earth Search STAC (catalogue)",
         "https://earth-search.aws.element84.com/v1"),
        ("Sentinel-2 COGs (imagery)",
         "https://sentinel-cogs.s3.us-west-2.amazonaws.com"),
    ]
    print("\nChecking satellite data access\n")
    ok_all = True
    for label, url in hosts:
        try:
            r = requests.get(url, timeout=30)
            state = "reachable" if r.status_code < 500 else f"HTTP {r.status_code}"
            ok = r.status_code < 500
        except Exception as exc:  # noqa: BLE001
            state = f"unreachable ({type(exc).__name__})"
            ok = False
        ok_all &= ok
        print(f"  {'OK ' if ok else 'FAIL'}  {label:32s} {state}")

    if ok_all:
        print("\nAll hosts reachable. Try:\n"
              "  python -m cropsurvey.cli analyze --lat 18.5204 --lon 73.8567\n")
    else:
        print("\nAt least one host is blocked. Check your firewall or proxy;\n"
              "neither host needs an account, so this is a network issue,\n"
              "not a credentials one.\n")
    return 0 if ok_all else 1


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="cropsurvey",
        description="Geospatial & GIS-Based Crop Survey System — Maharashtra",
    )
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="command", required=True)

    d = sub.add_parser("demo", help="run the full pipeline on synthetic data")
    d.add_argument("--district", default="Pune")
    d.add_argument("--season", default="kharif",
                   choices=["kharif", "rabi", "summer"])
    d.add_argument("--year", type=int, default=datetime.now().year)
    d.add_argument("--parcels", type=int, default=1500)
    d.add_argument("--seed", type=int, default=42)
    d.add_argument("--output", default=None)
    d.add_argument("--no-sar", action="store_true",
                   help="exclude SAR, to show how much kharif accuracy it buys")
    d.add_argument("--no-map", action="store_true")
    d.set_defaults(func=cmd_demo)

    s = sub.add_parser("sources", help="how to get imagery, and what is ready")
    s.set_defaults(func=cmd_sources)

    q = sub.add_parser("search", help="search Bhoonidhi for scenes")
    q.add_argument("--district", default="Pune")
    q.add_argument("--season", default="kharif",
                   choices=["kharif", "rabi", "summer"])
    q.add_argument("--year", type=int, default=datetime.now().year)
    q.add_argument("--radius-deg", type=float, default=0.35)
    q.add_argument("--max-cloud", type=float, default=0.4)
    q.add_argument("--limit", type=int, default=25)
    q.set_defaults(func=cmd_search)

    n = sub.add_parser("sample-size", help="plan a ground-truth campaign")
    n.add_argument("--target-se", type=float, default=5.0)
    n.set_defaults(func=cmd_sample_size)

    a = sub.add_parser("analyze",
                       help="analyse satellite imagery for one coordinate")
    a.add_argument("--lat", type=float, required=True)
    a.add_argument("--lon", type=float, required=True)
    a.add_argument("--radius", type=float, default=2.0,
                   help="AOI radius in km (default 2)")
    a.add_argument("--season", default="kharif",
                   choices=["kharif", "rabi", "summer"])
    a.add_argument("--year", type=int, default=datetime.now().year)
    a.add_argument("--start", default=None, help="YYYY-MM-DD, overrides season")
    a.add_argument("--end", default=None, help="YYYY-MM-DD, overrides season")
    a.add_argument("--max-cloud", type=float, default=70.0,
                   help="scene-level cloud cap; per-pixel masking does the "
                        "real work, so keep this generous")
    a.add_argument("--min-clear", type=float, default=0.25,
                   help="minimum clear fraction over the AOI to use a date")
    a.add_argument("--max-scenes", type=int, default=40)
    a.add_argument("--output", default=None)
    a.set_defaults(func=cmd_analyze)

    u = sub.add_parser("ui", help="launch the 15-day period analysis web UI")
    u.add_argument("--host", default="127.0.0.1")
    u.add_argument("--port", type=int, default=8000)
    u.set_defaults(func=cmd_ui)

    t_ = sub.add_parser("selftest", help="check satellite data hosts are reachable")
    t_.set_defaults(func=cmd_selftest)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _setup_logging(args.verbose)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
