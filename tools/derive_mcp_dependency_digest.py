"""Derive the MCP dependency-site digest from a hash-locked clean wheel install.

This is a provisioning/review tool, never a launch-time source of truth. It
reads the production dependency closure from the runtime lock's exact upstream
Git object, then rebuilds it from that uv.lock's wheel hashes. The installed
environment is only an observation that must exactly equal that independent
closure and clean rebuild after installer-owned metadata is excluded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
from pathlib import PurePosixPath
import re
import subprocess
import sys
import tempfile
import tomllib
import zipfile


INSTALLER_METADATA = {"INSTALLER", "RECORD", "REQUESTED", "direct_url.json"}


def normalized(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def git(source: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=source, text=True, stderr=subprocess.PIPE
    ).strip()


def normalized_repository(value: str) -> str:
    return value.rstrip("/").removesuffix(".git") + ".git"


def version_tuple(value: str) -> tuple[int, ...]:
    if not re.fullmatch(r"\d+(?:\.\d+)*", value):
        raise RuntimeError(f"unsupported version marker operand: {value}")
    return tuple(int(part) for part in value.split("."))


def marker_applies(marker: str, python_version: str, platform_tag: str) -> bool:
    match = re.fullmatch(
        r"(python_full_version|implementation_name|platform_python_implementation|sys_platform)\s*"
        r"(==|!=|<=|>=|<|>)\s*'([^']+)'",
        marker,
    )
    if match is None:
        raise RuntimeError(f"unsupported dependency marker: {marker}")
    key, operator, expected = match.groups()
    observed = {
        "python_full_version": python_version,
        "implementation_name": "cpython",
        "platform_python_implementation": "CPython",
        "sys_platform": "win32" if platform_tag.startswith("win_") else platform_tag,
    }[key]
    if key == "python_full_version":
        left = version_tuple(observed)
        right = version_tuple(expected)
    else:
        left = observed.casefold()
        right = expected.casefold()
    return {
        "==": left == right,
        "!=": left != right,
        "<": left < right,
        "<=": left <= right,
        ">": left > right,
        ">=": left >= right,
    }[operator]


def locked_dependency_closure(
    lock: dict[str, object], project: str, python_version: str, platform_tag: str
) -> dict[str, dict[str, object]]:
    packages: dict[str, dict[str, object]] = {}
    for raw in lock["package"]:  # type: ignore[index]
        item = raw  # type: ignore[assignment]
        name = normalized(item["name"])
        if name in packages:
            raise RuntimeError(f"ambiguous multi-version uv.lock package: {name}")
        packages[name] = item

    root_name = normalized(project)
    if root_name not in packages:
        raise RuntimeError(f"project absent from pinned uv.lock: {project}")

    # The launch uses the project's production graph only. Extras requested by
    # transitive dependency edges are honored; root extras are never a caller
    # input that could silently widen the blessed environment.
    requested_extras: dict[str, set[str]] = {root_name: set()}
    queue = [root_name]
    closure: dict[str, dict[str, object]] = {}
    while queue:
        name = queue.pop()
        item = packages[name]
        closure[name] = item
        dependencies = list(item.get("dependencies", []))
        optional = item.get("optional-dependencies", {})
        for extra in requested_extras.get(name, set()):
            if extra not in optional:
                raise RuntimeError(f"unknown extra {extra!r} for locked package {name}")
            dependencies.extend(optional[extra])
        for dependency in dependencies:
            marker = dependency.get("marker")
            if marker is not None and not marker_applies(marker, python_version, platform_tag):
                continue
            child_name = normalized(dependency["name"])
            if child_name not in packages:
                raise RuntimeError(f"dependency absent from pinned uv.lock: {child_name}")
            child_extras = set(dependency.get("extra", []))
            previous = requested_extras.setdefault(child_name, set())
            changed = not child_extras.issubset(previous)
            previous.update(child_extras)
            if child_name not in closure or changed:
                queue.append(child_name)
    closure.pop(root_name)
    return closure


def metadata_identity(dist_info: Path) -> tuple[str, str]:
    metadata = (dist_info / "METADATA").read_text(encoding="utf-8")
    name = re.search(r"^Name:\s*(.+)$", metadata, re.MULTILINE)
    version = re.search(r"^Version:\s*(.+)$", metadata, re.MULTILINE)
    if name is None or version is None:
        raise RuntimeError(f"missing Name/Version in {dist_info / 'METADATA'}")
    return name.group(1).strip(), version.group(1).strip()


def file_map(site: Path, project_module: str) -> dict[str, str]:
    project_prefix = f"{project_module.lower()}-"
    files: dict[str, str] = {}
    for file in sorted(path for path in site.rglob("*") if path.is_file()):
        relative = file.relative_to(site).as_posix()
        parts = relative.split("/")
        # Target installers synthesize launchers differently. The entire bin
        # directory is removed and its absence verified before child spawn.
        if relative == ".lock" or parts[0] == "bin":
            continue
        if "__pycache__" in parts or relative.endswith(".pyc"):
            continue
        first = parts[0].lower()
        if first == project_module.lower() or (first.startswith(project_prefix) and first.endswith(".dist-info")):
            continue
        if len(parts) >= 2 and parts[-2].endswith(".dist-info") and parts[-1] in INSTALLER_METADATA:
            continue
        files[relative] = hashlib.sha256(file.read_bytes()).hexdigest()
    return files


def tree_digest(files: dict[str, str]) -> str:
    lines = "\n".join(f"{relative} {digest}" for relative, digest in sorted(files.items()))
    return hashlib.sha256(lines.encode()).hexdigest()


def wheel_identity(wheel: Path) -> tuple[str, str]:
    with zipfile.ZipFile(wheel) as archive:
        metadata_names = [name for name in archive.namelist() if name.endswith(".dist-info/METADATA")]
        if len(metadata_names) != 1:
            raise RuntimeError(f"wheel has ambiguous METADATA: {wheel.name}")
        metadata = archive.read(metadata_names[0]).decode("utf-8")
    name = re.search(r"^Name:\s*(.+)$", metadata, re.MULTILINE)
    version = re.search(r"^Version:\s*(.+)$", metadata, re.MULTILINE)
    if name is None or version is None:
        raise RuntimeError(f"wheel METADATA lacks Name/Version: {wheel.name}")
    return normalized(name.group(1).strip()), version.group(1).strip()


def compatible_wheel(wheel: Path, python_version: str, platform_tag: str) -> bool:
    major, minor, *_ = version_tuple(python_version)
    with zipfile.ZipFile(wheel) as archive:
        wheel_names = [name for name in archive.namelist() if name.endswith(".dist-info/WHEEL")]
        if len(wheel_names) != 1:
            raise RuntimeError(f"wheel has ambiguous WHEEL metadata: {wheel.name}")
        metadata = archive.read(wheel_names[0]).decode("utf-8")
    tags = re.findall(r"^Tag:\s*([^-\s]+)-([^-\s]+)-([^\s]+)$", metadata, re.MULTILINE)
    if not tags:
        raise RuntimeError(f"wheel has no compatibility tags: {wheel.name}")
    for python_tag, abi_tag, observed_platform in tags:
        if observed_platform not in {"any", platform_tag}:
            continue
        if python_tag == f"cp{major}{minor}" and abi_tag in {f"cp{major}{minor}", "abi3", "none"}:
            return True
        abi3 = re.fullmatch(r"cp(\d)(\d+)", python_tag)
        if abi3 is not None and abi_tag == "abi3" and int(abi3.group(1)) == major and int(abi3.group(2)) <= minor:
            return True
        if python_tag in {f"py{major}", f"py{major}{minor}"} and abi_tag == "none":
            return True
    return False


def extract_wheel(wheel: Path, target: Path) -> None:
    """Install only importable wheel payload without executing installer code."""
    with zipfile.ZipFile(wheel) as archive:
        for member in archive.infolist():
            relative = PurePosixPath(member.filename)
            if member.is_dir():
                continue
            if relative.is_absolute() or ".." in relative.parts or "\\" in member.filename:
                raise RuntimeError(f"unsafe wheel member in {wheel.name}: {member.filename}")
            parts = relative.parts
            if parts and parts[0].endswith(".data"):
                if len(parts) < 3 or parts[1] not in {"purelib", "platlib"}:
                    continue
                parts = parts[2:]
            destination = target.joinpath(*parts)
            payload = archive.read(member)
            if destination.exists() and destination.read_bytes() != payload:
                raise RuntimeError(f"wheel payload collision at {destination.relative_to(target)}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--runtime-lock", type=Path, required=True)
    parser.add_argument("--module", default="alpaca_mcp_server")
    args = parser.parse_args()

    runtime_lock = json.loads(args.runtime_lock.read_text(encoding="utf-8"))
    source_lock = runtime_lock["source"]
    interpreter_lock = runtime_lock["interpreter"]
    if platform.python_implementation() != interpreter_lock["implementation"]:
        raise RuntimeError("derivation interpreter implementation differs from runtime lock")
    if platform.python_version() != interpreter_lock["version"]:
        raise RuntimeError("derivation interpreter version differs from runtime lock")
    if hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest() != interpreter_lock["runtimeSha256"]:
        raise RuntimeError("derivation interpreter bytes differ from runtime lock")
    expected_repository = normalized_repository(source_lock["repository"])
    observed_repository = normalized_repository(git(args.source, "remote", "get-url", "origin"))
    if observed_repository != expected_repository:
        raise RuntimeError(f"source origin mismatch: {observed_repository} != {expected_repository}")
    if git(args.source, "rev-parse", "HEAD") != source_lock["commit"]:
        raise RuntimeError("source HEAD is not the runtime-lock commit")
    if git(args.source, "status", "--porcelain"):
        raise RuntimeError("source checkout is dirty")

    pinned_lock_text = git(
        args.source,
        "show",
        f"{source_lock['commit']}:{source_lock['dependencyLockAtCommit']}",
    )
    lock = tomllib.loads(pinned_lock_text)
    locked = locked_dependency_closure(
        lock,
        source_lock["package"],
        interpreter_lock["version"],
        interpreter_lock["wheelPlatformTag"],
    )
    root = next(item for item in lock["package"] if normalized(item["name"]) == normalized(source_lock["package"]))
    if root["version"] != source_lock["version"]:
        raise RuntimeError("project version in pinned uv.lock differs from runtime lock")

    installed = [metadata_identity(path) for path in args.site.glob("*.dist-info")]
    observed_dependencies = {
        normalized(name): version
        for name, version in installed
        if normalized(name) != normalized(source_lock["package"])
    }
    expected_dependencies = {name: item["version"] for name, item in locked.items()}
    if observed_dependencies != expected_dependencies:
        missing = sorted(set(expected_dependencies) - set(observed_dependencies))
        extra = sorted(set(observed_dependencies) - set(expected_dependencies))
        changed = sorted(
            name
            for name in set(expected_dependencies) & set(observed_dependencies)
            if expected_dependencies[name] != observed_dependencies[name]
        )
        raise RuntimeError(
            f"deployment dependency closure differs from pinned uv.lock; "
            f"missing={missing}; extra={extra}; changed={changed}"
        )

    requirements: list[str] = []
    allowed_hashes: dict[str, set[str]] = {}
    for name, item in sorted(locked.items()):
        version = item["version"]
        wheel_hashes = sorted(wheel["hash"] for wheel in item.get("wheels", []))
        if not wheel_hashes:
            raise RuntimeError(f"no hash-locked wheel for {name}=={version}")
        allowed_hashes[name] = {digest.removeprefix("sha256:") for digest in wheel_hashes}
        requirements.append(" ".join([f"{name}=={version}", *(f"--hash={digest}" for digest in wheel_hashes)]))

    with tempfile.TemporaryDirectory(prefix="gbt-mcp-dependency-lock-") as temporary:
        root = Path(temporary)
        requirements_file = root / "requirements.txt"
        wheelhouse = root / "wheels"
        clean_site = root / "site"
        requirements_file.write_text("\n".join(requirements) + "\n", encoding="utf-8")
        environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        subprocess.run(
            [sys.executable, "-m", "pip", "download", "--disable-pip-version-check", "--no-input", "--no-deps", "--only-binary=:all:", "--require-hashes", "--dest", str(wheelhouse), "-r", str(requirements_file)],
            check=True,
            env=environment,
        )
        downloaded: dict[str, str] = {}
        for wheel in wheelhouse.glob("*.whl"):
            name, version = wheel_identity(wheel)
            if name not in locked or version != locked[name]["version"]:
                raise RuntimeError(f"downloaded wheel is outside pinned closure: {name}=={version}")
            digest = hashlib.sha256(wheel.read_bytes()).hexdigest()
            if digest not in allowed_hashes[name]:
                raise RuntimeError(f"downloaded wheel hash is absent from pinned uv.lock: {wheel.name}")
            if not compatible_wheel(wheel, interpreter_lock["version"], interpreter_lock["wheelPlatformTag"]):
                raise RuntimeError(f"downloaded wheel is incompatible with pinned interpreter/platform: {wheel.name}")
            if name in downloaded:
                raise RuntimeError(f"multiple wheels downloaded for {name}")
            downloaded[name] = digest
            extract_wheel(wheel, clean_site)
        if set(downloaded) != set(locked):
            raise RuntimeError(
                f"downloaded wheel closure differs from pinned graph; "
                f"missing={sorted(set(locked) - set(downloaded))}; "
                f"extra={sorted(set(downloaded) - set(locked))}"
            )
        expected = file_map(clean_site, args.module)
        observed = file_map(args.site, args.module)
        if expected != observed:
            missing = sorted(set(expected) - set(observed))[:20]
            extra = sorted(set(observed) - set(expected))[:20]
            changed = sorted(path for path in set(expected) & set(observed) if expected[path] != observed[path])[:20]
            raise RuntimeError(f"deployment site differs from hash-locked clean wheel install; missing={missing}; extra={extra}; changed={changed}")
        print(json.dumps({"dependencySiteSha256": tree_digest(expected), "packageCount": len(locked), "fileCount": len(expected)}, sort_keys=True))


if __name__ == "__main__":
    main()
