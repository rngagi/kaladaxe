"""Prepare the optional HydroRIVERS backdrop; not part of routine site builds.

Requires pyshp and Shapely only for this one-time conversion.
Usage: python3 scripts/prepare_rivers.py path/to/HydroRIVERS_v10_as.shp
Download and extract the official Asia shapefile first; see THIRD_PARTY_NOTICES.md.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

import shapefile
from shapely.geometry import shape, mapping
from shapely.ops import linemerge

ROOT = Path(__file__).resolve().parents[1]
MIN_MAIN_STEM_KM = 40


def prepare(shp_path):
    land = json.loads((ROOT / "site/assets/taiwan.geojson").read_text())
    # The generalized coastline differs from HydroRIVERS' grid-derived outlets.
    # Use it only to select island basins, not to clip or move river coordinates.
    region = shape(land["features"][0]["geometry"]).buffer(0.03)
    with shapefile.Reader(str(shp_path)) as reader:
        rows = list(reader.iterShapeRecords(bbox=[119.3, 21.8, 122.1, 25.5]))
    basins = {row.record["MAIN_RIV"] for row in rows
              if region.intersects(shape(row.shape.__geo_interface__))}
    selected = [row for row in rows if row.record["MAIN_RIV"] in basins
                and row.record["ORD_CLAS"] == 1]
    # Filter whole main stems, never individual reaches, to avoid artificial gaps.
    lengths = defaultdict(float)
    for row in selected:
        lengths[row.record["MAIN_RIV"]] += row.record["LENGTH_KM"]
    selected = [row for row in selected if lengths[row.record["MAIN_RIV"]] >= MIN_MAIN_STEM_KM]
    features = []
    for order in (1,):
        lines = []
        for row in selected:
            if row.record["ORD_CLAS"] != order:
                continue
            geometry = shape(row.shape.__geo_interface__)
            lines.extend(geometry.geoms if geometry.geom_type == "MultiLineString" else [geometry])
        # Merge touching reaches of the same class; retain every original bend.
        geometry = mapping(linemerge(lines))
        def rounded(value):
            if isinstance(value, (tuple, list)):
                return [rounded(item) for item in value]
            return round(value, 5)
        features.append({"type": "Feature", "properties": {"order": order},
                         "geometry": {"type": geometry["type"],
                                      "coordinates": rounded(geometry["coordinates"])}})
    data = {"type": "FeatureCollection", "source": {
        "title": "HydroRIVERS v1.0 — Taiwan main stems",
        "url": "https://www.hydrosheds.org/products/hydrorivers",
        "license": "HydroSHEDS version 1 License Agreement",
        "license_url": "https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf",
        "citation": "Lehner, B., Grill G. (2013). Hydrological Processes 27(15), 2171–2186. doi:10.1002/hyp.9740",
        "prepared": "2026-09-04",
        "shp_sha256": hashlib.sha256(shp_path.read_bytes()).hexdigest(),
        "selection": f"Island basins intersecting the local coastline buffered by 0.03 degrees; ORD_CLAS 1; whole main-stem length at least {MIN_MAIN_STEM_KM} km",
        "minimum_main_stem_km": MIN_MAIN_STEM_KM,
        "reach_count": len(selected),
        "basin_count": len({row.record["MAIN_RIV"] for row in selected}),
    }, "features": features}
    output = ROOT / "site/assets/taiwan-rivers.geojson"
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{len(selected)} reaches, {data['source']['basin_count']} basins → {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("shapefile", type=Path)
    prepare(parser.parse_args().shapefile)
