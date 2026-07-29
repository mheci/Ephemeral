#!/usr/bin/env python3
import argparse
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

EPOCH = (2020, 1, 1, 0, 0, 0)


def write_zip(source: Path, output: Path, excludes: set[str]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    files = sorted(
        path for path in source.rglob("*")
        if path.is_file() and not any(part in excludes for part in path.relative_to(source).parts)
    )
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            relative = path.relative_to(source).as_posix()
            info = ZipInfo(relative, EPOCH)
            info.compress_type = ZIP_DEFLATED
            info.external_attr = (0o755 if os.access(path, os.X_OK) else 0o644) << 16
            archive.writestr(info, path.read_bytes())


parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--exclude", action="append", default=[])
args = parser.parse_args()
write_zip(args.source.resolve(), args.output.resolve(), set(args.exclude))
