"""numpy -> binary HTTP responses (little-endian, metadata in X-Grid-Meta)."""
import json
import numpy as np
from fastapi import Response


def grid_response(arr: np.ndarray, meta: dict, dtype=np.float32, extra_headers: dict | None = None) -> Response:
    data = np.ascontiguousarray(arr, dtype=np.dtype(dtype).newbyteorder("<")).tobytes()
    headers = {"X-Grid-Meta": json.dumps(meta), "Cache-Control": "public, max-age=3600"}
    if extra_headers:
        headers.update(extra_headers)
    return Response(content=data, media_type="application/octet-stream", headers=headers)


def write_bin(path, arr: np.ndarray, dtype=np.float32) -> None:
    np.ascontiguousarray(arr, dtype=np.dtype(dtype).newbyteorder("<")).tofile(str(path))
