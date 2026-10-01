"""Cross-check two independent readings and review image cells, never a reference."""

import copy
from pathlib import Path

from PIL import Image, ImageDraw

from cell_reader import PROMPT_DIR, _issues, cells_to_positions
from event_pipeline import _keys, rhythm_evidence
from string_anchors import _font
from string_verifier import validate_reading
from symbol_reader import SymbolFormatError


def cell_id(measure, string, column):
    return f"m{measure}-s{string}-c{column}"


def cross_check(cells, audit, rhythm, anchors):
    """Select review cells from model disagreement/structural gaps only."""
    cells_to_positions(cells, anchors)
    audit = validate_reading(audit, tuple(m["number"] for m in anchors["measures"]))
    if rhythm is not None:
        rhythm_evidence(rhythm, anchors)
    audited = {(m["number"], r["string"]): r["frets"]
               for m in audit["measures"] for r in m["strings"]}
    by_measure = {m["number"]: m for m in cells["measures"]}
    rows, gaps, targets = [], [], set()
    for measure in cells["measures"]:
        for row in measure["string_rows"]:
            values = row["cells"]
            sequence = [c[0] for c in values if isinstance(c, list) and c]
            independent = audited[measure["number"], row["string"]]
            known = (all(c is not None and c != [None] for c in values)
                     and independent is not None and all(f is not None for f in independent))
            agrees = known and sequence == independent
            rows.append({"measure": measure["number"], "string": row["string"],
                         "cell_frets": sequence, "audit_frets": independent,
                         "agrees": agrees, "known": known})
            if not agrees:
                targets.update((measure["number"], row["string"], col)
                               for col in range(1, len(values) + 1))
    candidate_measures = rhythm["measures"] if rhythm is not None else (
        anchors["measures"] if anchors.get("columns_are_note_candidates") else [])
    for measure in candidate_measures:
        for column in measure["columns"]:
            index = column["index"]
            if (rhythm is None or column["kind"] == "notes") and not any(
                    isinstance(r["cells"][index - 1], list) and r["cells"][index - 1]
                    for r in by_measure[measure["number"]]["string_rows"]):
                gaps.append({"measure": measure["number"], "column": index})
                targets.update((measure["number"], string, index) for string in range(1, 7))
    audit_issues = list(audit["uncertain_items"])
    audit_issues.extend(f"小节{m['number']}：{issue}" for m in audit["measures"]
                        for issue in m["uncertain_items"])
    return {"rows": rows, "agreeing_rows": sum(r["agrees"] for r in rows),
            "total_rows": len(rows), "empty_note_columns": gaps,
            "audit_uncertain_items": audit_issues,
            "review_targets": [{"id": cell_id(*key), "measure": key[0],
                                "string": key[1], "column": key[2]}
                               for key in sorted(targets)],
            "consistent": all(r["agrees"] for r in rows) and not gaps and not audit_issues,
            "reference_used": False}


def checked_positions(cells, check, anchors):
    """Unresolved independent evidence blocks playback even if the score is full."""
    positions = cells_to_positions(cells, anchors)
    by_number = {m["number"]: m for m in positions["measures"]}
    for row in check["rows"]:
        if not row["agrees"] and not row.get("resolved_by_local_review"):
            by_number[row["measure"]]["uncertain_items"].append(
                f"独立核对：第{row['string']}弦的逐格与逐弦读数不一致或存在未知，需人工核对")
    for gap in check["empty_note_columns"]:
        by_number[gap["measure"]]["uncertain_items"].append(
            f"独立核对：第{gap['column']}个音符位置没有已确认音符，不能自动补成休止")
    positions["uncertain_items"].extend(check["audit_uncertain_items"])
    return positions


def resolve_note_review(before, reviewed, review, targets, audit, anchors):
    """Keep audit disagreements, but record independent local confirmation.

    A disagreeing row is resolved only when every cell in that row was reviewed,
    all values are known, and the local reading confirms the original grid.
    Changed but still disagreeing rows and empty stem columns remain unresolved.
    """
    check = cross_check(reviewed, audit, None, anchors)
    original = {(m["number"], r["string"]): r["cells"]
                for m in before["measures"] for r in m["string_rows"]}
    final = {(m["number"], r["string"]): r["cells"]
             for m in reviewed["measures"] for r in m["string_rows"]}
    covered = {(t["measure"], t["string"], t["column"]) for t in targets}
    review_issues = _issues(review["uncertain_items"])
    for row in check["rows"]:
        key = row["measure"], row["string"]
        values = final[key]
        row["resolved_by_local_review"] = (not row["agrees"] and not review_issues
            and values == original[key] and all(c is not None and c != [None] for c in values)
            and all((*key, index) in covered for index in range(1, len(values) + 1)))
    check["resolved_rows"] = sum(r["resolved_by_local_review"] for r in check["rows"])
    check["review_uncertain_items"] = review_issues
    check["resolved"] = (all(r["agrees"] or r["resolved_by_local_review"] for r in check["rows"])
                         and not check["empty_note_columns"] and not check["audit_uncertain_items"]
                         and not review_issues)
    return check


def prepare_review_cards(row_file, geometry, targets, output_dir):
    """Show all selected cells as separate enlarged cards; no drafts or answers."""
    if not targets:
        return [], []
    boxes = {(c["measure"], c["string"], c["column"]): c["source_box"]
             for c in geometry["cells"]}
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    scale, per_page = 4, 12
    images, manifest = [], []
    with Image.open(row_file) as source:
        source = source.convert("RGB")
        for start in range(0, len(targets), per_page):
            page_targets = targets[start:start + per_page]
            snippets = [source.crop(boxes[(t["measure"], t["string"], t["column"])])
                        for t in page_targets]
            width = max(s.width * scale for s in snippets) + 40
            height = max(s.height * scale for s in snippets) + 56
            page = Image.new("RGB", (width * 2 + 12, height * ((len(snippets) + 1) // 2) + 12), "white")
            draw = ImageDraw.Draw(page)
            path = output_dir / f"review_cards_{len(images) + 1:02d}.png"
            for index, (target, snippet) in enumerate(zip(page_targets, snippets)):
                left, top = 6 + (index % 2) * width, 6 + (index // 2) * height
                draw.rectangle((left, top, left + width - 1, top + height - 1), outline="#d7dfe9")
                draw.text((left + 10, top + 6), target["id"], fill="#164c9b", font=_font(22))
                enlarged = snippet.resize((snippet.width * scale, snippet.height * scale), Image.Resampling.NEAREST)
                x, y = left + (width - enlarged.width) // 2, top + 40
                page.paste(enlarged, (x, y))
                original = next(c for c in geometry["cells"] if
                                (c["measure"], c["string"], c["column"]) ==
                                (target["measure"], target["string"], target["column"]))
                # Derive the original target line from the saved grid transform.
                target_y = y + (original["target_y"] - original["paste_xy"][1]) / geometry["scale"] * scale
                draw.line((x - 8, target_y, x - 2, target_y), fill="#164c9b", width=2)
                draw.line((x + enlarged.width + 2, target_y, x + enlarged.width + 8, target_y), fill="#164c9b", width=2)
                manifest.append({**target, "source_box": boxes[(target["measure"], target["string"], target["column"])],
                                 "file": str(path), "paste_xy": [x, y], "scale": scale})
            page.save(path)
            images.append(path)
    return images, manifest


def load_review_prompts(targets):
    labels = ", ".join(t["id"] for t in targets)
    return ((PROMPT_DIR / "cells_review_system.txt").read_text(encoding="utf-8"),
            (PROMPT_DIR / "cells_review_user.txt").read_text(encoding="utf-8").replace("{{CARD_IDS}}", labels))


def apply_review(cells, review, targets, anchors):
    _keys(review, ["cells", "uncertain_items"], "review")
    if not isinstance(review["cells"], list):
        raise SymbolFormatError("核查结果必须完整输出卡片列表")
    expected = {t["id"]: t for t in targets}
    seen = set()
    updated = copy.deepcopy(cells)
    rows = {(m["number"], r["string"]): r for m in updated["measures"] for r in m["string_rows"]}
    changes = []
    for reading in review["cells"]:
        _keys(reading, ["id", "value"], "review.cell")
        identifier = reading["id"]
        if not isinstance(identifier, str) or identifier not in expected or identifier in seen:
            raise SymbolFormatError("核查卡片标识错误或重复，不能静默改写其他格子")
        seen.add(identifier)
        target = expected[identifier]
        row = rows[target["measure"], target["string"]]
        old = row["cells"][target["column"] - 1]
        row["cells"][target["column"] - 1] = reading["value"]
        if old != reading["value"]:
            changes.append({**target, "before": old, "after": reading["value"]})
    if seen != set(expected):
        raise SymbolFormatError("核查必须包含所有卡片，包括空格和最后一张卡片")
    updated["uncertain_items"].extend(_issues(review["uncertain_items"]))
    cells_to_positions(updated, anchors)
    return updated, changes
