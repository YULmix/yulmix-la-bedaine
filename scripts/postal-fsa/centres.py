"""The centre of every forward sortation area (FSA, a postal code's first three characters), as
SQL VALUES rows for public.postal_fsa (#180): what the carpool board measures detours with.

Source: Statistics Canada, 2021 Census forward sortation area boundary file (cartographic,
shapefile, lfsa000b21a_e.zip), under the Open Government Licence - Canada:
https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm

The centre is the area-weighted centroid of the FSA's polygons, computed in the file's own
equal-scale projection (Statistics Canada Lambert, EPSG:3347) and turned into latitude and
longitude (NAD83, EPSG:4269; within a metre of WGS84). Rounded to 4 decimals (about 10 m): it
only ranks lifts by detour, in kilometres.

Usage (needs pyshp and pyproj):
    python3 -m venv venv && venv/bin/pip install pyshp pyproj
    venv/bin/python scripts/postal-fsa/centres.py path/to/lfsa000b21a_e.shp > rows.sql
"""
import sys

import shapefile
from pyproj import Transformer


def ring_area_centroid(points):
    """Signed area and centroid of one ring (shoelace formula)."""
    area = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    area /= 2
    if area == 0:
        return 0.0, 0.0, 0.0
    return area, cx / (6 * area), cy / (6 * area)


def centroid(shape):
    """Area-weighted centroid of every ring; holes have the opposite sign, so they subtract."""
    parts = list(shape.parts) + [len(shape.points)]
    total = sx = sy = 0.0
    for start, end in zip(parts, parts[1:]):
        area, cx, cy = ring_area_centroid(shape.points[start:end])
        total += area
        sx += cx * area
        sy += cy * area
    return sx / total, sy / total


def main(path):
    to_lat_lng = Transformer.from_crs('EPSG:3347', 'EPSG:4269', always_xy=True)
    rows = []
    for record in shapefile.Reader(path, encoding='latin-1').iterShapeRecords():
        x, y = centroid(record.shape)
        lng, lat = to_lat_lng.transform(x, y)
        rows.append((record.record['CFSAUID'], lat, lng))
    rows.sort()
    print(',\n'.join(f"    ('{fsa}', {lat:.4f}, {lng:.4f})" for fsa, lat, lng in rows))


if __name__ == '__main__':
    main(sys.argv[1])
