"""Memory-map a file without keeping a file descriptor open.

``np.memmap`` (like ``mmap.mmap`` before Python 3.13) holds one descriptor per array, and a terrain stack has
thousands of arrays.  A mapping does not need the descriptor after ``mmap(2)`` returned, so the descriptor is
closed immediately: on Python >= 3.13 through ``mmap.mmap(..., trackfd=False)``, on older versions through
libc ``mmap``/``munmap`` called with :mod:`ctypes`.  Both return a copy-on-write (private) array whose
lifetime owns the mapping.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import mmap
import os
import sys
from pathlib import Path

import numpy as np

_PROT_READ_WRITE = 0x1 | 0x2
_MAP_PRIVATE = 0x02
_MADV_NORMAL = getattr(mmap, "MADV_NORMAL", None)
_MADV_RANDOM = getattr(mmap, "MADV_RANDOM", None)
READ_AROUND_REACH = 64 * 1024
_libc: ctypes.CDLL | None = None


def _libc_mmap() -> ctypes.CDLL:
    global _libc
    if _libc is None:
        lib = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
        lib.mmap.restype = ctypes.c_void_p
        lib.mmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_longlong]
        lib.munmap.restype = ctypes.c_int
        lib.munmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
        lib.madvise.restype = ctypes.c_int
        lib.madvise.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
        _libc = lib
    return _libc


class _Mapping:
    """Owner of a libc mapping; unmaps when garbage-collected."""

    def __init__(self, address: int, size: int):
        self.address, self.size = address, size

    def __del__(self) -> None:
        if self.address:
            _libc_mmap().munmap(self.address, self.size)
            self.address = 0


def _map_libc(fd: int, size: int) -> np.ndarray:
    lib = _libc_mmap()
    address = lib.mmap(None, size, _PROT_READ_WRITE, _MAP_PRIVATE, fd, 0)
    if address in (None, ctypes.c_void_p(-1).value):
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))
    buf = (ctypes.c_ubyte * size).from_address(address)
    buf._mapping = _Mapping(address, size)  # type: ignore[attr-defined]
    return np.frombuffer(buf, dtype=np.uint8)


def _map_trackfd(fd: int, size: int) -> np.ndarray:
    m = mmap.mmap(fd, size, flags=mmap.MAP_PRIVATE, prot=mmap.PROT_READ | mmap.PROT_WRITE, trackfd=False)
    return np.frombuffer(m, dtype=np.uint8)


def map_array(path: str | Path, dtype: np.dtype | str, shape: tuple[int, ...], *, use_libc: bool | None = None) -> np.ndarray:
    """Copy-on-write memory map of a raw array file; no file descriptor stays open.

    ``use_libc`` forces the ctypes implementation (default: only when ``mmap`` lacks ``trackfd``, Python < 3.13).
    """
    dtype = np.dtype(dtype)
    size = int(np.prod(shape, dtype=np.int64)) * dtype.itemsize
    if os.path.getsize(path) != size:
        raise ValueError(f"{path}: file size {os.path.getsize(path)} B does not match shape {shape} of {dtype}")
    if size == 0:
        return np.empty(shape, dtype)
    libc = sys.version_info < (3, 13) if use_libc is None else use_libc
    fd = os.open(path, os.O_RDONLY)
    try:
        raw = _map_libc(fd, size) if libc else _map_trackfd(fd, size)
    finally:
        os.close(fd)
    return raw.view(dtype).reshape(shape)


def rows_outreach_read_around(array: np.ndarray) -> bool:
    return array.ndim > 1 and array.nbytes > 0 and array.strides[0] >= READ_AROUND_REACH


def advise_random_access(array: np.ndarray, random_access: bool) -> None:
    if _MADV_RANDOM is None or _MADV_NORMAL is None or array.nbytes == 0:
        return
    _libc_mmap().madvise(array.ctypes.data, array.nbytes, _MADV_RANDOM if random_access else _MADV_NORMAL)

