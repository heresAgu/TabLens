"""Pixel-derived beam candidates and bounded review; no reference score access."""

import copy
import math
import statistics

from event_pipeline import rhythm_evidence
from symbol_reader import SymbolFormatError


def _runs(values):
    groups = []
    for value in values:
        if not groups or value != groups[-1][1] + 1:
            groups.append([value, value])
        else:
            groups[-1][1] = value
    return groups


def profile_bands(profile, maximum_band_height, dark_threshold=160, minimum_prominence=8,
                  minimum_ink_rows=3):
    """Split dark ink only where an internal grayscale rise has dark support.

    Counts are candidates. A wide block with no measured separation remains
    unresolved rather than being divided by a guessed typical beam thickness.
    """
    values = {r["y"]: r["median_gray"] for r in profile}
    coarse = _runs([y for y, value in values.items() if value < dark_threshold])
    bands, separators = [], []
    for first, last in coarse:
        cuts = set()
        for y in range(first + 1, last):
            peak = values[y]
            if peak < minimum_prominence or peak < values[y - 1] or peak < values[y + 1]:
                continue
            limit = peak - minimum_prominence
            left = right = y
            while left > first and values[left - 1] > limit:
                left -= 1
            while right < last and values[right + 1] > limit:
                right += 1
            before = left - minimum_ink_rows
            after = right + minimum_ink_rows
            if before < first or after > last:
                continue
            if not all(values[i] <= limit for i in range(before, left)) or not all(
                    values[i] <= limit for i in range(right + 1, after + 1)):
                continue
            cuts.update(range(left, right + 1))
        for left, right in _runs(sorted(cuts)):
            separators.append({"y_range": [left, right],
                "peak_gray": max(values[y] for y in range(left, right + 1))})
        bands.extend(_runs([y for y in range(first, last + 1) if y not in cuts]))
    resolved = bool(bands) and all(minimum_ink_rows <= b - a + 1 <= maximum_band_height
                                  for a, b in bands) and len(bands) <= 6
    return {"bands": bands, "separators": separators, "resolved": resolved,
            "coarse_ink_ranges": coarse}


def detect_beam_candidates(row, anchors, group_geometry):
    """Read original pixels between stems, then bind bands to their endpoint stems."""
    pixels = row.convert("L").load()
    gap = (anchors["string_y"][-1] - anchors["string_y"][0]) / 5
    maximum_height = math.ceil(gap * 0.45)
    spans = []
    for connection in group_geometry["connections"]:
        left, top, right, bottom = connection["source_box"]
        profile = [{"y": y, "median_gray": statistics.median(
            pixels[x, y] for x in range(left, right))} for y in range(top, bottom)]
        evidence = profile_bands(profile, maximum_height)
        spans.append({"measure": connection["measure"],
            "between_columns": connection["between_columns"],
            "source_box": connection["source_box"], "joined": connection["joined"],
            "profile": profile, **evidence})
    columns = []
    for measure in anchors["measures"]:
        for column in measure["columns"]:
            linked = [s for s in spans if s["measure"] == measure["number"] and s["joined"]
                      and column["index"] in s["between_columns"]]
            count = max(len(s["bands"]) for s in linked) if linked and all(s["resolved"] for s in linked) else None
            columns.append({"measure": measure["number"], "index": column["index"],
                "candidate_beam_count": count,
                "supported_by_spans": [s["between_columns"] for s in linked],
                "issue": None if count is not None else "连接或层间分隔不足以确定横梁数"})
    return {"reference_used": False, "coordinate_space": "row_crop_pixels", "columns": columns,
            "spans": spans, "parameters": {"dark_threshold": 160, "minimum_prominence": 8,
                "minimum_ink_rows": 3, "maximum_band_height": maximum_height},
            "scope": "horizontal beams joining downward stems; no flags, partial beamlets or independent voices"}


def cross_check_beams(observation, anchors):
    rhythm_evidence(observation, anchors)
    candidates = {(c["measure"], c["index"]): c for c in anchors["beam_candidates"]["columns"]}
    targets, unknown = [], []
    for measure in observation["measures"]:
        for column in measure["columns"]:
            candidate = candidates[(measure["number"], column["index"])]
            expected = candidate["candidate_beam_count"]
            if expected is None:
                unknown.append([measure["number"], column["index"]])
            elif column["rhythm"]["beam_count"] != expected:
                targets.append({"measure": measure["number"], "index": column["index"],
                    "candidate_beam_count": expected, "supported_by_spans": candidate["supported_by_spans"]})
    return {"targets": targets, "unknown_pixel_columns": unknown,
            "consistent": not targets and not unknown, "reference_used": False}


def review_pixel_evidence(anchors, targets):
    numbers = {(target["measure"], target["index"]) for target in targets}
    candidates = anchors["beam_candidates"]
    return {"reference_used": False, "coordinate_space": candidates["coordinate_space"],
        "parameters": candidates["parameters"], "targets": targets,
        "spans": [{key: span[key] for key in ("measure", "between_columns", "source_box", "bands", "separators", "resolved")}
                  for span in candidates["spans"] if span["joined"] and any(
                      (span["measure"], index) in numbers for index in span["between_columns"])]}


def validate_beam_review(review, initial, anchors, targets):
    """A review may change only target beam counts and their uncertainty notes."""
    rhythm_evidence(review, anchors)
    allowed = {(target["measure"], target["index"]) for target in targets}
    sanitized = copy.deepcopy(initial)
    changes = []
    for old_measure, new_measure, merged_measure in zip(initial["measures"], review["measures"], sanitized["measures"]):
        for old, new, merged in zip(old_measure["columns"], new_measure["columns"], merged_measure["columns"]):
            if (old_measure["number"], old["index"]) in allowed:
                value = new["rhythm"]["beam_count"]
                merged["rhythm"]["beam_count"] = value
                merged["uncertain_items"] = new["uncertain_items"]
                if value != old["rhythm"]["beam_count"]:
                    changes.append({"measure": old_measure["number"], "column": old["index"],
                                    "before": old["rhythm"]["beam_count"], "after": value})
    if sanitized != review:
        raise SymbolFormatError("横梁核查修改了目标之外的记号、页头或声部信息，停止后续请求")
    return sanitized, changes
