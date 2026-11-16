#!/usr/bin/env python3
"""Plausibility check for the generated POI datasets.

Catches the typical silent failures of the Overpass fetch without anyone having to look at the
map: a region/country boundary that matched the wrong area or nothing at all.

Checks per country configured in fetch_data/config.yml:

1. ``iso3166_1`` is a two-letter code (YAML turns an unquoted ``NO`` into ``false``).
2. A country bounding box exists in ``fetch_data/country_bboxes.json``.
3. Every fetched region has at least one POI across all categories (an empty region almost always
   means the boundary lookup matched an empty or wrong area).
4. Every POI lies inside the country bounding box (plus a small margin). Points outside mean the
   query matched an area in another country.

Regions without any GeoJSON files yet (newly configured, not fetched) are reported, not failed.
File-level validity (empty files, broken JSON) is covered by check_geojson_integrity.py.

Usage:
  python scripts/check_geojson_plausibility.py                     # all countries, offline
  python scripts/check_geojson_plausibility.py --countries kg      # only some countries
  python scripts/check_geojson_plausibility.py --fetch-missing-bboxes
      # adds missing country bounding boxes from the OSM country relation (needs Overpass access)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "fetch_data"))

import fetch_overpass  # noqa: E402  (shared config parsing, keeps paths identical to the fetcher)

BBOX_PATH = ROOT / "fetch_data" / "country_bboxes.json"
GEOJSON_ROOT = fetch_overpass.RESOURCE_DIR
DEFAULT_MARGIN_DEG = 0.1
MAX_EXAMPLES = 5
ISO_RE = re.compile(r"^[A-Z]{2}$")


def iter_points(coords: Any) -> Iterable[List[float]]:
    if isinstance(coords, list) and len(coords) >= 2 and all(isinstance(v, (int, float)) for v in coords[:2]):
        yield coords
    elif isinstance(coords, list):
        for item in coords:
            yield from iter_points(item)


def load_bboxes() -> Dict[str, Any]:
    if not BBOX_PATH.exists():
        return {"countries": {}}
    return json.loads(BBOX_PATH.read_text(encoding="utf-8"))


def save_bboxes(data: Dict[str, Any]) -> None:
    lines = ["{", f'  "_source": {json.dumps(data.get("_source", ""))},', '  "countries": {']
    entries = sorted(data["countries"].items())
    for index, (iso, entry) in enumerate(entries):
        comma = "," if index < len(entries) - 1 else ""
        lines.append(
            f'    "{iso}": {{"name": {json.dumps(entry["name"], ensure_ascii=False)}, '
            f'"bbox": {json.dumps(entry["bbox"])}}}{comma}'
        )
    lines += ["  }", "}", ""]
    BBOX_PATH.write_text("\n".join(lines), encoding="utf-8")


def fetch_bbox_from_overpass(iso: str, endpoints: List[str]) -> Dict[str, Any] | None:
    import requests

    query = (
        "[out:json][timeout:60];"
        f'relation["boundary"="administrative"]["admin_level"="2"]["ISO3166-1"="{iso}"];'
        "out bb tags;"
    )
    for endpoint in endpoints:
        try:
            response = requests.post(
                endpoint, data={"data": query}, headers=fetch_overpass.REQUEST_HEADERS, timeout=(10, 90)
            )
            response.raise_for_status()
            elements = response.json().get("elements") or []
        except Exception as exc:  # try the next endpoint
            print(f"[bbox] {iso}: {endpoint} failed ({type(exc).__name__}: {exc})")
            continue
        for element in elements:
            bounds = element.get("bounds")
            if bounds:
                tags = element.get("tags") or {}
                return {
                    "name": tags.get("name:en") or tags.get("name") or iso,
                    "bbox": [
                        round(bounds["minlon"], 4),
                        round(bounds["minlat"], 4),
                        round(bounds["maxlon"], 4),
                        round(bounds["maxlat"], 4),
                    ],
                }
        print(f"[bbox] {iso}: no country relation found at {endpoint}")
    return None


def check(country_filter: set[str], margin: float, fetch_missing: bool) -> Dict[str, Any]:
    config = fetch_overpass.load_config()
    regions = fetch_overpass.normalize_regions(config)
    raw_countries = config.get("countries") or {}

    errors: List[str] = []
    notes: List[str] = []
    stats: Dict[str, Dict[str, int]] = {}

    bbox_data = load_bboxes()
    bboxes = bbox_data.setdefault("countries", {})

    by_country: Dict[str, List[Dict[str, Any]]] = {}
    for region in regions:
        if country_filter and not fetch_overpass.matches_country_filter(region, country_filter):
            continue
        by_country.setdefault(region["country"], []).append(region)

    if fetch_missing:
        endpoints = (config.get("overpass") or {}).get("endpoints") or []
        changed = False
        for country_key in by_country:
            iso = str((raw_countries.get(country_key) or {}).get("iso3166_1", "")).upper()
            if ISO_RE.match(iso) and iso not in bboxes:
                entry = fetch_bbox_from_overpass(iso, endpoints)
                if entry:
                    bboxes[iso] = entry
                    changed = True
                    print(f"[bbox] {iso}: added {entry['bbox']} ({entry['name']})")
        if changed:
            save_bboxes(bbox_data)

    for country_key, country_regions in by_country.items():
        raw_iso = (raw_countries.get(country_key) or {}).get("iso3166_1")
        iso = raw_iso.upper() if isinstance(raw_iso, str) else ""
        if not ISO_RE.match(iso):
            errors.append(
                f"{country_key}: iso3166_1 is {raw_iso!r}, expected a two-letter code "
                '(quote it in config.yml, e.g. iso3166_1: "NO")'
            )
            continue

        bbox_entry = bboxes.get(iso)
        if not bbox_entry:
            errors.append(
                f"{country_key}: no bounding box for {iso} in fetch_data/country_bboxes.json "
                "(run: python scripts/check_geojson_plausibility.py --fetch-missing-bboxes)"
            )
            continue
        min_lon, min_lat, max_lon, max_lat = bbox_entry["bbox"]
        min_lon, min_lat, max_lon, max_lat = min_lon - margin, min_lat - margin, max_lon + margin, max_lat + margin

        seen_paths: set[str] = set()
        country_stats = stats.setdefault(country_key, {"regions": 0, "features": 0, "outside": 0})
        for region in country_regions:
            region_path = fetch_overpass.resolve_region_data_path(region)
            if region_path in seen_paths:
                continue
            seen_paths.add(region_path)
            region_dir = GEOJSON_ROOT / region_path
            files = sorted(region_dir.glob("*.geojson")) if region_dir.is_dir() else []
            if not files:
                notes.append(f"{country_key}/{region['id']}: no data fetched yet ({region_path})")
                continue

            country_stats["regions"] += 1
            total = 0
            outside: List[str] = []
            outside_count = 0
            for path in files:
                try:
                    features = json.loads(path.read_text(encoding="utf-8")).get("features") or []
                except (json.JSONDecodeError, AttributeError):
                    continue  # reported by check_geojson_integrity.py
                total += len(features)
                for feature in features:
                    coords = (feature.get("geometry") or {}).get("coordinates")
                    for lon, lat, *_ in iter_points(coords):
                        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
                            outside_count += 1
                            if len(outside) < MAX_EXAMPLES:
                                osm = feature.get("properties") or {}
                                outside.append(f"{path.stem} {osm.get('osm_type', '')}/{osm.get('id', '')} @ {lat:.4f},{lon:.4f}")
                            break

            country_stats["features"] += total
            country_stats["outside"] += outside_count
            if total == 0:
                errors.append(
                    f"{country_key}/{region['id']}: no POIs in any category ({region_path}) – "
                    "boundary lookup probably matched an empty or wrong area"
                )
            if outside_count:
                errors.append(
                    f"{country_key}/{region['id']}: {outside_count} of {total} POIs outside the {iso} bounding box "
                    f"– query probably matched an area in another country. Examples: {'; '.join(outside)}"
                )

    return {"errors": errors, "notes": notes, "stats": stats}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--countries", help="comma-separated country ids/aliases (default: all)")
    parser.add_argument("--margin", type=float, default=DEFAULT_MARGIN_DEG, help="bbox margin in degrees (default 0.1)")
    parser.add_argument("--fetch-missing-bboxes", action="store_true", help="add missing country bboxes via Overpass")
    parser.add_argument("--json-report", help="optional path for a JSON report")
    args = parser.parse_args()

    country_filter = fetch_overpass.parse_csv_filter(args.countries)
    result = check(country_filter, args.margin, args.fetch_missing_bboxes)

    for country_key, s in sorted(result["stats"].items()):
        print(f"{country_key}: {s['regions']} regions checked, {s['features']} POIs, {s['outside']} outside bbox")
    for note in result["notes"]:
        print(f"note: {note}")

    if args.json_report:
        Path(args.json_report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_report).write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    in_actions = os.environ.get("GITHUB_ACTIONS") == "true"
    if result["errors"]:
        print(f"\nGeoJSON plausibility check failed ({len(result['errors'])} problem(s)):")
        for error in result["errors"]:
            print(f"::error::{error}" if in_actions else f"- {error}")
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as handle:
                handle.write("## GeoJSON plausibility check failed\n\n")
                handle.writelines(f"- {error}\n" for error in result["errors"])
        return 1
    print("\nGeoJSON plausibility check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
