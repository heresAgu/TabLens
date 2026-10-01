"""Reference-free time-column anchors and independent position/rhythm observations.

This experiment accepts one clean horizontal TAB row with rhythm stems below
the strings. Stem candidates are visual anchors, not inferred musical timing.
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw

from string_anchors import AnchorError, _font
from symbol_reader import SCHEMA_VERSION, SymbolFormatError, compile_evidence, validate_evidence


PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


def _centers(values):
    groups = []
    for value in values:
        if not groups or value != groups[-1][-1] + 1:
            groups.append([value])
        else:
            groups[-1].append(value)
    return [sum(group) / len(group) for group in groups]


def detect_columns(image, string_y, target_numbers=(2, 3), stem_min_length_factor=0.9):
    gray = image.convert("L")
    pixels = gray.load()
    top, bottom = round(string_y[0]), round(string_y[-1])
    gap = (string_y[-1] - string_y[0]) / 5
    bars = _centers([x for x in range(gray.width)
                    if sum(pixels[x, y] < 180 for y in range(top, bottom + 1))
                    >= (bottom - top + 1) * 0.90])
    if len(bars) != len(target_numbers) + 1:
        raise AnchorError("本轮需要完整的小节边界；检测结果不支持当前目标谱行。")
    region_top = round(string_y[-1] + gap * 0.55)
    region_bottom = min(gray.height, round(string_y[-1] + gap * 3.6))
    stems = []
    for x in range(gray.width):
        run = longest = 0
        for y in range(region_top, region_bottom):
            run = run + 1 if pixels[x, y] < 170 else 0
            longest = max(longest, run)
        if longest >= gap * stem_min_length_factor:
            stems.append(x)
    stem_x = _centers(stems)
    measures = []
    for index, number in enumerate(target_numbers):
        left, right = bars[index:index + 2]
        positions = [x for x in stem_x if left < x < right]
        if not positions or len(positions) > 256:
            raise AnchorError("某个小节没有可用的下方符干定位，停止本轮结构实验。")
        if any(b - a < gap * 1.5 for a, b in zip(positions, positions[1:])):
            raise AnchorError("发声列太密，当前文字标签可能重叠；不自动合并符干。")
        measures.append({"number": number, "left": left, "right": right,
                         "columns": [{"index": i, "x": x} for i, x in enumerate(positions, 1)]})
    return {"coordinate_space": "row_crop_pixels", "source_size": list(image.size),
            "string_y": string_y, "stem_search_y": [region_top, region_bottom],
            "stem_min_run": gap * stem_min_length_factor,
            "measures": measures, "reference_used": False,
            "scope": "clean TAB row; visible downward stems only; rests and multiple voices need another detector"}


def prepare_event_samples(samples, output_dir):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = {"positioned_panels": output_dir / "lullaby_panels_columns.png",
             "rhythm_columns": output_dir / "lullaby_rhythm_columns.png",
             "event_manifest": output_dir / "lullaby_event_anchors.json"}
    geometry = json.loads(samples["anchors_metadata"].read_text(encoding="utf-8"))
    with Image.open(samples["row"]) as source:
        source = source.convert("RGB")
        anchors = detect_columns(source, geometry["string_y"])
        margin = geometry["labelled_source_box"][0]
        with Image.open(samples["separated_strings"]) as image:
            panels = image.convert("RGB")
        draw = ImageDraw.Draw(panels)
        for panel in geometry["panels"]:
            strip_bottom = panel["paste_xy"][1] + panel["source_box"][3] - panel["source_box"][1]
            for measure in anchors["measures"]:
                for column in measure["columns"]:
                    x = margin + column["x"]
                    draw.line((x, strip_bottom + 3, x, strip_bottom + 7), fill="#164c9b", width=1)
                    draw.text((x, strip_bottom + 10), f"{measure['number']}.{column['index']}",
                              fill="#164c9b", font=_font(14), anchor="mt")
        panels.save(paths["positioned_panels"])
        rhythm = Image.new("RGB", (source.width + 2 * margin, source.height + 40), "white")
        rhythm.paste(source, (margin, 0))
        draw = ImageDraw.Draw(rhythm)
        for measure in anchors["measures"]:
            for column in measure["columns"]:
                x = margin + column["x"]
                draw.line((x, source.height + 2, x, source.height + 7), fill="#164c9b", width=1)
                draw.text((x, source.height + 10), f"{measure['number']}.{column['index']}",
                          fill="#164c9b", font=_font(14), anchor="mt")
        rhythm.save(paths["rhythm_columns"])
        anchors["row_file"] = str(samples["row"])
        paths["event_manifest"].write_text(json.dumps(anchors, indent=2), encoding="utf-8")
    return paths


def load_event_prompts(samples, task):
    anchors = json.loads(samples["event_manifest"].read_text(encoding="utf-8"))
    labels = "；".join(f"第{measure['number']}小节标签：" + ", ".join(
        f"{measure['number']}.{column['index']}" for column in measure["columns"])
        for measure in anchors["measures"])
    system = (PROMPT_DIR / f"events_{task}_system.txt").read_text(encoding="utf-8")
    user = (PROMPT_DIR / f"events_{task}_user.txt").read_text(encoding="utf-8").replace("{{COLUMN_LABELS}}", labels)
    return system, user


def _keys(value, keys, name):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise SymbolFormatError(f"{name}：字段不符合本轮结构读取格式")


def _target_measures(value, anchors):
    if not isinstance(value, list):
        raise SymbolFormatError("measures 必须为列表")
    numbers = [measure.get("number") if isinstance(measure, dict) else None for measure in value]
    targets = [measure["number"] for measure in anchors["measures"]]
    if any(type(number) is not int for number in numbers) or sorted(numbers) != sorted(targets):
        raise SymbolFormatError("需要恰好输出本轮目标小节，不能重复或遗漏")
    return sorted(value, key=lambda measure: measure["number"])


def _empty_rhythm():
    return {"stem_present": None, "beam_count": None, "flag_count": None, "dot_count": None,
            "note_shape": None, "rest_symbol": None, "unsupported_marks": []}


def position_evidence(observation, anchors):
    _keys(observation, ["measures", "uncertain_items"], "position")
    geometry = {m["number"]: m for m in anchors["measures"]}
    measures = []
    for measure in _target_measures(observation["measures"], anchors):
        _keys(measure, ["number", "string_rows", "unassigned_notes", "uncertain_items"], "position.measure")
        measures.append({**measure, "rhythm_mode": "unknown", "completeness": "unknown",
                         "connections": [], "columns": [
                             {"index": c["index"], "kind": "unknown", "rhythm": _empty_rhythm(), "uncertain_items": []}
                             for c in geometry[measure["number"]]["columns"]]})
    evidence = {"schema_version": SCHEMA_VERSION,
                "metadata": {key: None for key in ["title", "tempo_bpm", "tempo_unit", "time_signature", "capo", "string_labels_high_to_low"]},
                "measures": measures, "uncertain_items": observation["uncertain_items"]}
    validate_evidence(evidence)
    return evidence


def rhythm_evidence(observation, anchors):
    _keys(observation, ["metadata", "measures", "uncertain_items"], "rhythm")
    geometry = {m["number"]: m for m in anchors["measures"]}
    measures = []
    for measure in _target_measures(observation["measures"], anchors):
        _keys(measure, ["number", "rhythm_mode", "completeness", "columns", "uncertain_items"], "rhythm.measure")
        measures.append({**measure, "string_rows": [{"string": string, "notes": []} for string in range(1, 7)],
                         "unassigned_notes": [], "connections": []})
    evidence = {"schema_version": SCHEMA_VERSION, "metadata": observation["metadata"],
                "measures": measures, "uncertain_items": observation["uncertain_items"]}
    validate_evidence(evidence)
    for measure in measures:
        if [c["index"] for c in measure["columns"]] != [c["index"] for c in geometry[measure["number"]]["columns"]]:
            raise SymbolFormatError("节奏列与图像定位标签不一致，不能静默增删列")
    return evidence


def merge_observations(positions, rhythms, anchors):
    notes = position_evidence(positions, anchors)
    rhythm = rhythm_evidence(rhythms, anchors)
    by_number = {m["number"]: m for m in notes["measures"]}
    measures = []
    for measure in rhythm["measures"]:
        position = by_number[measure["number"]]
        measures.append({**measure, "string_rows": position["string_rows"],
                         "unassigned_notes": position["unassigned_notes"],
                         "uncertain_items": position["uncertain_items"] + measure["uncertain_items"]})
    evidence = {**rhythm, "measures": measures,
                "uncertain_items": notes["uncertain_items"] + rhythm["uncertain_items"]}
    score, diagnostics = compile_evidence(evidence)
    geometry = {m["number"]: m for m in anchors["measures"]}
    for measure in score["measures"]:
        columns = {c["index"]: c for c in geometry[measure["number"]]["columns"]}
        for event in measure["events"]:
            x = columns[event["source"]["column"]]["x"]
            event["source"].update({"coordinate_space": "row_crop_pixels", "row_file": anchors.get("row_file"), "x": x})
            for note in event["notes"]:
                note["source"].update({"coordinate_space": "row_crop_pixels", "row_file": anchors.get("row_file"),
                                       "x": x, "y": anchors["string_y"][note["string"] - 1]})
    return evidence, score, diagnostics


def grouping_diagnostic(comparison, score, reference):
    predicted = {m["number"]: m["events"] for m in score["measures"]}
    by_event = {(row["measure"], row["event"]): row for row in comparison["rows"]}
    simultaneous = singles = simultaneous_correct = singles_correct = 0
    for measure in reference["measures"]:
        for index, event in enumerate(measure["events"], 1):
            correct = by_event[(measure["number"], index)]["notes_correct"]
            if len(event["notes"]) > 1:
                simultaneous += 1
                simultaneous_correct += correct
            else:
                singles += 1
                singles_correct += correct
    return {"expected_simultaneous_groups": simultaneous, "correct_simultaneous_groups": simultaneous_correct,
            "actual_simultaneous_groups": sum(len(event["notes"]) > 1 for events in predicted.values() for event in events),
            "expected_single_groups": singles, "correct_single_groups": singles_correct,
            "actual_events": comparison["actual_events"], "expected_events": comparison["expected_events"],
            "meaning": "在同一小节同一事件序号处比较完整音符组合；节奏正确性另行评估"}
