"""Link-safe file access for the harness process.

The harness process is not sandboxed and the model can create links inside its workspace, so every file the
harness reads or writes under a run directory goes through this module. A path is walked component by component
from ``/`` with ``O_NOFOLLOW`` (a link in *any* component, including the last, is refused), new files are created
with ``O_EXCL`` and overwrites go through a temporary file renamed over the target (a rename replaces a link,
it never follows it). Paths must be absolute and already resolved (`RunPaths.root` is).

Every failure is an `UnsafePath` (an `OSError`), which the tool registry returns to the model as a tool error.
A leaf is opened with ``O_NONBLOCK`` and ``O_NOCTTY`` and checked with ``fstat`` before anything is read: a FIFO,
socket or device node the model planted is refused at once (a plain open of a FIFO would block the process
forever), and the non-blocking flag is cleared only for a regular file.
No module outside this one may touch run files directly.

`resolve_under` is the one lexical check here: it resolves links and ``..`` to decide whether a path the model named
lies inside a root, for the permission policy and the evidence routes.
"""

from __future__ import annotations

import contextlib
import errno
import fcntl
import os
import stat
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO

_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
_LEAF_FLAGS = os.O_NONBLOCK | os.O_NOCTTY | os.O_NOFOLLOW | os.O_CLOEXEC
_CHUNK = 1 << 20


class UnsafePath(OSError):
    """A path component is a link, is not what it must be, or the path is not absolute and resolved."""


def _parts(path: Path) -> list[str]:
    if not path.is_absolute():
        raise UnsafePath(errno.EINVAL, f"not an absolute path: {path}")
    parts = path.parts[1:]
    if any(p in ("", ".", "..") for p in parts):
        raise UnsafePath(errno.EINVAL, f"path is not normalised: {path}")
    return list(parts)


def _open_dir(parts: list[str], *, create: bool) -> int:
    """File descriptor of the directory ``/`` + ``parts`` with no link on the way."""
    fd = os.open("/", _DIR_FLAGS)
    try:
        for name in parts:
            try:
                nxt = os.open(name, _DIR_FLAGS, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    raise
                with contextlib.suppress(FileExistsError):
                    os.mkdir(name, 0o755, dir_fd=fd)
                nxt = os.open(name, _DIR_FLAGS, dir_fd=fd)
            except OSError as exc:
                if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                    raise UnsafePath(exc.errno, f"a component of the path is a link or not a directory: {name!r}") from exc
                raise
            os.close(fd)
            fd = nxt
    except BaseException:
        os.close(fd)
        raise
    return fd


@contextlib.contextmanager
def _parent(path: Path, *, create: bool = False) -> Iterator[tuple[int, str]]:
    parts = _parts(path)
    if not parts:
        raise UnsafePath(errno.EINVAL, "no file name")
    fd = _open_dir(parts[:-1], create=create)
    try:
        yield fd, parts[-1]
    finally:
        os.close(fd)


def _leaf_error(exc: OSError, path: Path) -> OSError:
    if exc.errno in (errno.ELOOP, errno.EMLINK):
        return UnsafePath(exc.errno, f"{path} is a link")
    return exc


def _checked_regular(fd: int, path: Path) -> int:
    """Return ``fd`` (made blocking) if it is a regular file; close it and refuse otherwise."""
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise UnsafePath(errno.EINVAL, f"{path} is not a regular file")
        fcntl.fcntl(fd, fcntl.F_SETFL, fcntl.fcntl(fd, fcntl.F_GETFL) & ~os.O_NONBLOCK)
    except BaseException:
        os.close(fd)
        raise
    return fd


def _special_file_error(exc: OSError, path: Path) -> OSError:
    """A non-blocking open of a socket or a FIFO nobody reads fails with ENXIO: report it as a special file."""
    if exc.errno == errno.ENXIO:
        return UnsafePath(errno.EINVAL, f"{path} is not a regular file")
    return _leaf_error(exc, path)


def mkdirs(path: Path) -> None:
    """Create a directory and its parents without following links (existing directories are fine)."""
    os.close(_open_dir(_parts(path), create=True))


def is_dir(path: Path) -> bool:
    """True if ``path`` is a directory reachable without any link."""
    try:
        os.close(_open_dir(_parts(path), create=False))
    except OSError:
        return False
    return True


def open_read(path: Path) -> BinaryIO:
    """Open a regular file for reading; refuses links in any component and anything but a regular file."""
    with _parent(path) as (dfd, name):
        try:
            fd = os.open(name, os.O_RDONLY | _LEAF_FLAGS, dir_fd=dfd)
        except OSError as exc:
            raise _special_file_error(exc, path) from exc
    return os.fdopen(_checked_regular(fd, path), "rb")


def read_bytes(path: Path, max_bytes: int | None = None) -> bytes:
    """Whole content of a regular file (``max_bytes`` bounds it: a larger file is an error)."""
    with open_read(path) as handle:
        data = handle.read() if max_bytes is None else handle.read(max_bytes + 1)
    if max_bytes is not None and len(data) > max_bytes:
        raise UnsafePath(errno.EFBIG, f"{path} is larger than {max_bytes} bytes")
    return data


def read_text(path: Path, max_bytes: int | None = None) -> str:
    """`read_bytes` decoded as UTF-8."""
    return read_bytes(path, max_bytes).decode("utf-8")


def exists(path: Path) -> bool:
    """True if ``path`` is a regular file reachable without any link."""
    try:
        with open_read(path):
            return True
    except OSError:
        return False


def regular_file(path: Path) -> Path:
    """``path`` itself if it is a regular file with no link in any component; `UnsafePath` or `OSError` otherwise."""
    with open_read(path):
        return path


def open_new(path: Path, *, mkdir: bool = False, mode: int = 0o644) -> BinaryIO:
    """Create a *new* file (``O_EXCL``) for writing; an existing path of any kind is an error."""
    with _parent(path, create=mkdir) as (dfd, name):
        try:
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode, dir_fd=dfd)
        except OSError as exc:
            raise _leaf_error(exc, path) from exc
    return os.fdopen(fd, "wb")


def write_new(path: Path, data: bytes, *, mkdir: bool = False) -> None:
    """Create a new file with ``data``; fails if the path exists."""
    with open_new(path, mkdir=mkdir) as handle:
        handle.write(data)


def replace(path: Path, data: bytes, *, mkdir: bool = False, mode: int = 0o644) -> None:
    """Write ``data`` to ``path`` atomically: a temporary file in the same directory is renamed over it."""
    with _parent(path, create=mkdir) as (dfd, name):
        tmp = f".{name}.{uuid.uuid4().hex}.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode, dir_fd=dfd)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.rename(tmp, name, src_dir_fd=dfd, dst_dir_fd=dfd)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp, dir_fd=dfd)
            raise


def append(path: Path, data: bytes) -> None:
    """Append to a file, creating it if needed; refuses a link."""
    with _parent(path) as (dfd, name):
        try:
            fd = os.open(name, os.O_WRONLY | os.O_APPEND | os.O_CREAT | _LEAF_FLAGS, 0o644, dir_fd=dfd)
        except OSError as exc:
            raise _special_file_error(exc, path) from exc
    with os.fdopen(_checked_regular(fd, path), "ab") as handle:
        handle.write(data)


def lexists(path: Path) -> bool:
    """True if anything (a file of any kind, even a link) is at ``path``; False if its parent is missing."""
    try:
        with _parent(path) as (dfd, name):
            os.stat(name, dir_fd=dfd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    return True


def rename_over(src: Path, dst: Path) -> None:
    """Rename ``src`` to ``dst`` (same directory); replaces whatever is at ``dst``, a link included."""
    if src.parent != dst.parent:
        raise UnsafePath(errno.EXDEV, "rename_over works inside one directory")
    with _parent(dst) as (dfd, name):
        os.rename(src.name, name, src_dir_fd=dfd, dst_dir_fd=dfd)


def remove(path: Path) -> None:
    """Remove a file (not following links; a link itself is removed); a missing file is fine."""
    try:
        with _parent(path) as (dfd, name), contextlib.suppress(FileNotFoundError):
            os.unlink(name, dir_fd=dfd)
    except FileNotFoundError:
        return


def size(path: Path) -> int:
    """Size of a regular file in bytes (no links)."""
    with open_read(path) as handle:
        return os.fstat(handle.fileno()).st_size


def list_dir(path: Path) -> list[str]:
    """Names in a directory reachable without links (empty if it does not exist)."""
    try:
        fd = _open_dir(_parts(path), create=False)
    except FileNotFoundError:
        return []
    try:
        return sorted(os.listdir(fd))
    finally:
        os.close(fd)


MAX_TREE_ENTRIES = 50_000
"""Directory entries `tree_bytes` visits before it refuses (200,000 empty files took 1.5 s to walk)."""


class TreeTooLarge(OSError):
    """A tree holds more than `MAX_TREE_ENTRIES` entries; its size was not computed."""


def tree_bytes(path: Path) -> int:
    """Total size of the regular files below ``path`` (links are not followed or counted).

    Raises `TreeTooLarge` after `MAX_TREE_ENTRIES` entries, so the walk has a bound however many files a run makes."""
    total = 0
    seen = 0
    stack = [path]
    while stack:
        current = stack.pop()
        try:
            fd = _open_dir(_parts(current), create=False)
        except OSError:
            continue
        try:
            for entry in os.scandir(fd):
                seen += 1
                if seen > MAX_TREE_ENTRIES:
                    raise TreeTooLarge(f"{path} holds more than {MAX_TREE_ENTRIES} entries")
                if entry.is_dir(follow_symlinks=False):
                    stack.append(current / entry.name)
                elif entry.is_file(follow_symlinks=False):
                    total += entry.stat(follow_symlinks=False).st_size
        finally:
            os.close(fd)
    return total


def resolve_under(root: Path, candidate: str | os.PathLike[str], base: Path | None = None) -> Path | None:
    """Resolve ``candidate`` (relative paths are taken from ``base``, default ``root``).

    Symlinks and ``..`` are resolved first, so a link or traversal that leaves ``root`` is detected.
    Returns the resolved path when it lies inside ``root`` (or equals it), else ``None``.
    """
    text = os.fspath(candidate)
    if not text or "\x00" in text:
        return None
    path = Path(text)
    if not path.is_absolute():
        path = (base or root) / path
    resolved = path.resolve(strict=False)
    root_resolved = root.resolve(strict=False)
    if resolved == root_resolved or root_resolved in resolved.parents:
        return resolved
    return None
