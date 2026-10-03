"""Shared raster helpers: reprojection onto area grids, remote COG window reads."""
from __future__ import annotations

import math

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.windows import from_bounds, Window

from .areas import meta_bounds


def meta_transform(meta: dict):
    return from_origin(meta["originX"], meta["originY"], meta["cellSize"], meta["cellSize"])


def reproject_into(dst: np.ndarray, meta: dict, src: np.ndarray, src_transform, src_crs,
                   resampling=Resampling.bilinear, src_nodata=None, dst_nodata=np.nan) -> np.ndarray:
    reproject(source=src, destination=dst, src_transform=src_transform, src_crs=src_crs,
              src_nodata=src_nodata, dst_transform=meta_transform(meta), dst_crs=meta["crs"],
              dst_nodata=dst_nodata, resampling=resampling)
    return dst


def geo_bounds(meta: dict, margin_m: float = 0.0):
    minx, miny, maxx, maxy = meta_bounds(meta)
    return transform_bounds(meta["crs"], "EPSG:4326", minx - margin_m, miny - margin_m,
                            maxx + margin_m, maxy + margin_m)


def _is_nodata(a: np.ndarray, nodata) -> np.ndarray:
    if isinstance(nodata, float) and math.isnan(nodata):
        return np.isnan(a)
    return a == nodata


def read_tiles_into(meta: dict, urls: list[str], dtype, resampling, dst_nodata, margin_m=200.0):
    """Read windows from (remote) rasters covering the grid and reproject into it.
    Returns None if nothing could be read."""
    dst = np.full((meta["rows"], meta["cols"]), dst_nodata, dtype=dtype)
    minx, miny, maxx, maxy = meta_bounds(meta)
    read_any = False
    for url in urls:
        try:
            with rasterio.open(url) as ds:
                b = transform_bounds(meta["crs"], ds.crs, minx - margin_m, miny - margin_m,
                                     maxx + margin_m, maxy + margin_m)
                win = from_bounds(*b, ds.transform).round_offsets().round_lengths()
                win = win.intersection(Window(0, 0, ds.width, ds.height))
                arr = ds.read(1, window=win)
                if arr.size == 0:
                    continue
                tmp = np.full_like(dst, dst_nodata)
                reproject(source=arr, destination=tmp, src_transform=ds.window_transform(win),
                          src_crs=ds.crs, src_nodata=ds.nodata, dst_transform=meta_transform(meta),
                          dst_crs=meta["crs"], dst_nodata=dst_nodata, resampling=resampling)
                ok = ~_is_nodata(tmp, dst_nodata)
                dst[ok] = tmp[ok]
                read_any = read_any or bool(ok.any())
        except Exception:  # noqa: BLE001 - missing tile (ocean) or network error
            continue
    return dst if read_any else None


def degree_tiles(meta: dict, step: int = 1):
    """Integer SW corners (lat, lon) of `step`-degree tiles covering the grid."""
    w, s, e, n = geo_bounds(meta, 300)
    lats = range(int(math.floor(s / step) * step), int(math.floor(n / step) * step) + 1, step)
    lons = range(int(math.floor(w / step) * step), int(math.floor(e / step) * step) + 1, step)
    return [(la, lo) for la in lats for lo in lons]


def write_geotiff(path, arr: np.ndarray, meta: dict, nodata=None) -> None:
    with rasterio.open(path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
                       dtype=arr.dtype, crs=meta["crs"], transform=meta_transform(meta),
                       nodata=nodata) as ds:
        ds.write(arr, 1)
