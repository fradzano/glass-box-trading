"""Verify that implementation phases partition the runtime SPEC cases."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "docs" / "SPEC.md"
PLAN_PATH = ROOT / "config" / "implementation-phases.json"

CASE_PATTERN = re.compile(r"^- \*\*(S-[A-Z0-9-]+)\*\*", re.MULTILINE)
HEADING_CASE_PATTERN = re.compile(r"^### (S-ARM-[0-9]+)\b", re.MULTILINE)
DECLARED_LIMIT_PATTERN = re.compile(
    r"^- \*\*(S-[A-Z0-9-]+)\*\*.*Declared limit .*NOT a test case",
    re.MULTILINE,
)


def fail(message: str) -> None:
    print(f"implementation phase check failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    spec = SPEC_PATH.read_text(encoding="utf-8")
    config = json.loads(PLAN_PATH.read_text(encoding="utf-8"))

    defined = CASE_PATTERN.findall(spec) + HEADING_CASE_PATTERN.findall(spec)
    duplicates = sorted({case for case in defined if defined.count(case) > 1})
    if duplicates:
        fail(f"duplicate SPEC definitions: {', '.join(duplicates)}")

    cases = set(defined)
    expected_defined = config["expectedDefinedCases"]
    if len(cases) != expected_defined:
        fail(f"expected {expected_defined} defined cases, found {len(cases)}")

    declared_limits = set(config["declaredLimits"])
    spec_declared_limits = set(DECLARED_LIMIT_PATTERN.findall(spec))
    if declared_limits != spec_declared_limits:
        fail(
            "declared-limit manifest differs from SPEC: "
            f"manifest={sorted(declared_limits)}, spec={sorted(spec_declared_limits)}"
        )
    unknown_limits = declared_limits - cases
    if unknown_limits:
        fail(f"declared limits absent from SPEC: {', '.join(sorted(unknown_limits))}")

    assignments: dict[str, list[str]] = {case: [] for case in cases}
    empty_patterns: list[str] = []
    phase_counts: dict[str, int] = {}

    for phase, raw_patterns in config["phases"].items():
        compiled = [re.compile(pattern) for pattern in raw_patterns]
        for raw_pattern, pattern in zip(raw_patterns, compiled, strict=True):
            if not any(pattern.fullmatch(case) for case in cases):
                empty_patterns.append(f"{phase}:{raw_pattern}")
        for case in cases:
            if any(pattern.fullmatch(case) for pattern in compiled):
                assignments[case].append(phase)
        phase_counts[phase] = sum(phase in owners for owners in assignments.values())

    if empty_patterns:
        fail(f"patterns matching no case: {', '.join(empty_patterns)}")

    missing = sorted(case for case, owners in assignments.items() if not owners)
    multiple = sorted(case for case, owners in assignments.items() if len(owners) > 1)
    if missing:
        fail(f"unassigned cases: {', '.join(missing)}")
    if multiple:
        detail = ", ".join(f"{case}={assignments[case]}" for case in multiple)
        fail(f"multiply assigned cases: {detail}")

    test_count = len(cases - declared_limits)
    expected_tests = config["expectedTestCases"]
    if test_count != expected_tests:
        fail(f"expected {expected_tests} test cases, found {test_count}")

    counts = " ".join(f"{phase}={count}" for phase, count in phase_counts.items())
    print(
        f"implementation phases OK: {len(cases)} definitions, "
        f"{test_count} tests, {len(declared_limits)} declared limit; {counts}"
    )


if __name__ == "__main__":
    main()
