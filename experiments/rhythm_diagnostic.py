"""Measure 1/4 timing diagnostics with reference-free image presentation."""

import json
import math
import statistics
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageDraw

from event_pipeline import detect_columns, rhythm_evidence
from string_anchors import AnchorError, _font, detect_string_lines
from symbol_reader import read_duration
from beam_evidence import detect_beam_candidates


PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
REFERENCE_PATH = Path(__file__).resolve().parent / "reference_rhythm_1_4.json"
ROW_BOXES = {1: (65, 290, 1375, 515), 4: (65, 820, 1375, 1060)}
CONTRAST_GAMMA = 0.4


def beam_group_geometry(row, anchors):
    """Group adjacent downward stems by horizontal ink, without counting beams.

    Dark grayscale gaps can fuse several beams. Connectivity needs only a
    continuous horizontal stripe; stripe count is deliberately not interpreted.
    Flags, partial beamlets and independent voices require a broader detector.
    """
    gray = row.convert("L")
    pixels = gray.load()
    top, bottom = anchors["stem_search_y"]
    gap = (anchors["string_y"][-1] - anchors["string_y"][0]) / 5
    threshold, minimum_coverage, minimum_rows = 95, 0.7, 2
    measures, connections = [], []
    for measure in anchors["measures"]:
        columns = measure["columns"]
        groups = [[columns[0]]]
        for previous, current in zip(columns, columns[1:]):
            left, right = math.ceil(previous["x"] + 5), math.floor(current["x"] - 5)
            if not 0 <= left < right <= gray.width or not 0 <= top < bottom <= gray.height:
                raise AnchorError("横梁组扫描范围无效，未生成放大图")
            runs = []
            for y in range(top, bottom):
                coverage = sum(pixels[x, y] < threshold for x in range(left, right)) / (right - left)
                if coverage >= minimum_coverage:
                    if not runs or y > runs[-1][1] + 1:
                        runs.append([y, y])
                    else:
                        runs[-1][1] = y
            joined = any(b - a + 1 >= minimum_rows for a, b in runs)
            connections.append({"measure": measure["number"],
                "between_columns": [previous["index"], current["index"]],
                "source_box": [left, top, right, bottom],
                "horizontal_dark_runs": runs, "joined": joined})
            if joined:
                groups[-1].append(current)
            else:
                groups.append([current])
        for index, group in enumerate(groups):
            first, last = group[0], group[-1]
            first_index = columns.index(first)
            last_index = columns.index(last)
            left_limit = (columns[first_index - 1]["x"] + first["x"]) / 2 if first_index else measure["left"]
            right_limit = (last["x"] + columns[last_index + 1]["x"]) / 2 if last_index + 1 < len(columns) else measure["right"]
            box = [max(math.floor(first["x"] - 1.5 * gap), math.ceil(left_limit)), top,
                   min(math.ceil(last["x"] + 1.5 * gap), math.floor(right_limit)),
                   min(row.height, bottom + math.ceil(gap * 0.8))]
            if not 0 <= box[0] < first["x"] <= last["x"] < box[2] <= row.width:
                raise AnchorError("横梁组裁剪不能完整包含目标符干")
            measures.append({"measure": measure["number"], "group": index + 1,
                "columns": [column["index"] for column in group],
                "column_x": [column["x"] for column in group], "source_box": box})
    return {"reference_used": False, "groups": measures, "connections": connections,
            "detection": {"dark_threshold": threshold, "minimum_coverage": minimum_coverage,
                          "minimum_contiguous_rows": minimum_rows},
            "scope": "horizontal TAB rows with downward stems and connecting beams; no duration inference"}


def brighten_grayscale(image, gamma=CONTRAST_GAMMA):
    """Fixed monotone intensity mapping; no geometry or reference-dependent edits."""
    if type(gamma) not in (int, float) or not 0 < gamma <= 1:
        raise ValueError("灰度提亮参数必须大于0且不超过1")
    table = [round(255 * (value / 255) ** gamma) for value in range(256)]
    return image.convert("RGB").point(table * 3)


def grayscale_evidence(row, geometry):
    gray = row.convert("L")
    pixels = gray.load()
    spans = []
    for connection in geometry["connections"]:
        left, top, right, bottom = connection["source_box"]
        spans.append({"measure": connection["measure"],
            "between_columns": connection["between_columns"],
            "source_box": connection["source_box"],
            "profile": [{"y": y, "median_gray": statistics.median(
                pixels[x, y] for x in range(left, right))} for y in range(top, bottom)]})
    return {"reference_used": False, "coordinate_space": "row_crop_pixels",
            "scale": "0=black, 255=white", "spans": spans,
            "purpose": "independent raw grayscale evidence; no beam count or duration inferred"}


def render_beam_groups(row, anchors, gamma=None):
    geometry = beam_group_geometry(row, anchors)
    scale, padding, header, footer, spacing = 4, 20, 56, 12, 12
    groups = geometry["groups"]
    width = max((g["source_box"][2] - g["source_box"][0]) * scale for g in groups) + 2 * padding
    heights = [(g["source_box"][3] - g["source_box"][1]) * scale + header + footer for g in groups]
    canvas = Image.new("RGB", (width, sum(heights) + spacing * (len(groups) + 1)), "white")
    draw = ImageDraw.Draw(canvas)
    card_top = spacing
    for group, height in zip(groups, heights):
        box = group["source_box"]
        snippet = row.crop(box)
        if gamma is not None:
            snippet = brighten_grayscale(snippet, gamma)
        enlarged = snippet.resize((snippet.width * scale, snippet.height * scale), Image.Resampling.NEAREST)
        x, y = padding, card_top + header
        draw.rectangle((0, card_top, width - 1, card_top + height - 1), outline="#d7dfe9")
        draw.text((padding, card_top + 4), f"GROUP {group['measure']}.{group['group']}",
                  fill="#164c9b", font=_font(18))
        canvas.paste(enlarged, (x, y))
        for column, source_x in zip(group["columns"], group["column_x"]):
            column_x = x + (source_x - box[0]) * scale
            draw.text((column_x, card_top + 29), f"{group['measure']}.{column}",
                      fill="#164c9b", font=_font(21), anchor="mm")
            draw.line((column_x, y - 10, column_x, y - 3), fill="#164c9b", width=2)
        group.update({"paste_xy": [x, y], "scale": scale,
                      "resampling": "nearest", "pixel_adjustment": "none" if gamma is None else
                      {"kind": "fixed_gamma", "gamma": gamma,
                       "formula": "round(255 * (input / 255) ** gamma)"}})
        card_top += height + spacing
    return canvas, geometry


def prepare_rhythm_samples(samples, output_dir, include_groups=False, include_contrast=False, include_beams=False):
    """Page-specific regions; every column and crop is then detected from pixels."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    paths, rows = {}, []
    with Image.open(samples["whole_page"]) as source:
        source = source.convert("RGB")
        sx, sy = source.width / 1440, source.height / 1969
        for number, box in ROW_BOXES.items():
            source_box = [round(v * (sx if i % 2 == 0 else sy)) for i, v in enumerate(box)]
            row = source.crop(source_box)
            lines = detect_string_lines(row)
            # Thick triple beams are shorter vertically than a real stem. Keep
            # the proven 2/3 profile unchanged and record this stricter profile.
            anchors = detect_columns(row, lines, (number,), stem_min_length_factor=1.4)
            paths[f"rhythm_row_m{number}"] = output_dir / f"measure_{number}.png"
            row.save(paths[f"rhythm_row_m{number}"])
            anchors.update({"row_file": str(paths[f"rhythm_row_m{number}"].resolve()),
                            "page_source_box": source_box})
            columns = anchors["measures"][0]["columns"]
            full = Image.new("RGB", (row.width + 40, row.height + 46), "white")
            full.paste(row, (20, 0))
            draw = ImageDraw.Draw(full)
            for column in columns:
                x = 20 + column["x"]
                draw.line((x, row.height + 2, x, row.height + 8), fill="#164c9b")
                draw.text((x, row.height + 20), f"{number}.{column['index']}",
                          fill="#164c9b", font=_font(16), anchor="mm")
            paths[f"rhythm_full_m{number}"] = output_dir / f"rhythm_full_m{number}.png"
            full.save(paths[f"rhythm_full_m{number}"])
            gap = (lines[-1] - lines[0]) / 5
            top = anchors["stem_search_y"][0]
            bounds = []
            for index, column in enumerate(columns):
                x = column["x"]
                left = (columns[index - 1]["x"] + x) / 2 if index else x - (columns[1]["x"] - x) / 2
                right = (x + columns[index + 1]["x"]) / 2 if index + 1 < len(columns) else x + (x - columns[index - 1]["x"]) / 2
                box = [max(math.floor(left), math.ceil(anchors["measures"][0]["left"])), top,
                       min(math.ceil(right), math.floor(anchors["measures"][0]["right"])), row.height]
                if not 0 <= box[0] < x < box[2] <= row.width or not 0 <= top < row.height:
                    raise AnchorError("节奏卡片超出当前符干候选范围")
                bounds.append(box)
            scale = 3
            width = max((b[2] - b[0]) * scale for b in bounds) + 40
            height = (row.height - top) * scale + 56
            cards = Image.new("RGB", (width * 2 + 12, height * ((len(columns) + 1) // 2) + 12), "white")
            draw = ImageDraw.Draw(cards)
            card_manifest = []
            for index, (column, box) in enumerate(zip(columns, bounds)):
                left, card_top = 6 + (index % 2) * width, 6 + (index // 2) * height
                draw.rectangle((left, card_top, left + width - 1, card_top + height - 1), outline="#d7dfe9")
                draw.text((left + 10, card_top + 6), f"{number}.{column['index']}", fill="#164c9b", font=_font(22))
                snippet = row.crop(box)
                enlarged = snippet.resize((snippet.width * scale, snippet.height * scale), Image.Resampling.NEAREST)
                x, y = left + (width - enlarged.width) // 2, card_top + 40
                cards.paste(enlarged, (x, y))
                stem_x = x + (column["x"] - box[0]) * scale
                draw.line((stem_x, y - 9, stem_x, y - 3), fill="#164c9b", width=2)
                card_manifest.append({"measure": number, "column": column["index"], "source_box": box,
                                      "paste_xy": [x, y], "stem_x": stem_x, "scale": scale})
            paths[f"rhythm_cards_m{number}"] = output_dir / f"rhythm_cards_m{number}.png"
            cards.save(paths[f"rhythm_cards_m{number}"])
            anchors["card_geometry"] = card_manifest
            if include_groups or include_contrast or include_beams:
                group_image, group_geometry = render_beam_groups(row, anchors)
                paths[f"rhythm_groups_m{number}"] = output_dir / f"rhythm_groups_m{number}.png"
                group_image.save(paths[f"rhythm_groups_m{number}"])
                anchors["group_geometry"] = group_geometry
                if include_contrast or include_beams:
                    contrast_image, contrast_geometry = render_beam_groups(row, anchors, gamma=CONTRAST_GAMMA)
                    paths[f"rhythm_contrast_m{number}"] = output_dir / f"rhythm_contrast_m{number}.png"
                    contrast_image.save(paths[f"rhythm_contrast_m{number}"])
                    anchors["contrast_geometry"] = contrast_geometry
                    paths[f"rhythm_gray_evidence_m{number}"] = output_dir / f"rhythm_gray_evidence_m{number}.json"
                    paths[f"rhythm_gray_evidence_m{number}"].write_text(
                        json.dumps(grayscale_evidence(row, group_geometry), indent=2), encoding="utf-8")
                if include_beams:
                    candidates = detect_beam_candidates(row, anchors, group_geometry)
                    paths[f"beam_candidates_m{number}"] = output_dir / f"beam_candidates_m{number}.json"
                    paths[f"beam_candidates_m{number}"].write_text(json.dumps(candidates, indent=2), encoding="utf-8")
                    anchors["beam_candidates"] = candidates
            paths[f"rhythm_anchors_m{number}"] = output_dir / f"rhythm_anchors_m{number}.json"
            paths[f"rhythm_anchors_m{number}"].write_text(json.dumps(anchors, indent=2), encoding="utf-8")
            rows.append((number, row))
    overview = Image.new("RGB", (max(r.width for _, r in rows), sum(r.height + 35 for _, r in rows)), "white")
    draw = ImageDraw.Draw(overview)
    y = 0
    for number, row in rows:
        draw.text((8, y + 3), f"MEASURE {number}", fill="#164c9b", font=_font(20))
        overview.paste(row, (0, y + 35))
        y += row.height + 35
    paths["rhythm_overview"] = output_dir / "rhythm_overview.png"
    overview.save(paths["rhythm_overview"])
    return paths


def diagnostic_cases(samples, prompt_compare=False, group_compare=False, contrast_compare=False, beams_verified=False):
    if sum((prompt_compare, group_compare, contrast_compare, beams_verified)) > 1:
        raise ValueError("提示词对照和图片对照应分别运行")
    cases = []
    system = (PROMPT_DIR / "events_rhythm_system.txt").read_text(encoding="utf-8")
    full_template = (PROMPT_DIR / "events_rhythm_user.txt").read_text(encoding="utf-8")
    card_template = (PROMPT_DIR / "rhythm_cards_user.txt").read_text(encoding="utf-8")
    for number in ROW_BOXES:
        anchors = json.loads(samples[f"rhythm_anchors_m{number}"].read_text(encoding="utf-8"))
        labels = f"第{number}小节标签：" + ", ".join(
            f"{number}.{c['index']}" for c in anchors["measures"][0]["columns"])
        if beams_verified:
            verified_system = system + "\n" + (PROMPT_DIR / "rhythm_trace_rules.txt").read_text(encoding="utf-8")
            initial_user = (PROMPT_DIR / "rhythm_contrast_user.txt").read_text(encoding="utf-8").replace("{{MEASURE}}", str(number))
            review_user = (PROMPT_DIR / "rhythm_beam_review_user.txt").read_text(encoding="utf-8").replace("{{MEASURE}}", str(number))
            views = [("initial", verified_system, initial_user), ("review", verified_system, review_user)]
        elif group_compare or contrast_compare:
            group_system = system + "\n" + (PROMPT_DIR / "rhythm_trace_rules.txt").read_text(encoding="utf-8")
            group_user = (PROMPT_DIR / ("rhythm_contrast_user.txt" if contrast_compare else
                "rhythm_groups_user.txt")).read_text(encoding="utf-8").replace("{{MEASURE}}", str(number))
            views = [("groups", group_system, group_user), ("contrast", group_system, group_user)] if contrast_compare else [
                ("context", group_system, group_user), ("groups", group_system, group_user)]
        elif prompt_compare:
            views = [("full", system, full_template.replace("第2、3小节", f"第{number}小节")),
                     ("trace", system + "\n" + (PROMPT_DIR / "rhythm_trace_rules.txt").read_text(encoding="utf-8"),
                      full_template.replace("第2、3小节", f"第{number}小节"))]
        else:
            views = [("full", system, full_template.replace("第2、3小节", f"第{number}小节")),
                     ("cards", system, card_template)]
        for view, case_system, user in views:
            images = [samples["header"], samples[f"rhythm_{'cards' if view == 'cards' else 'full'}_m{number}"]]
            if view in ("groups", "contrast", "initial", "review"):
                images.append(samples[f"rhythm_{'contrast' if beams_verified else view}_m{number}"])
            label = {"initial": "保留初始节奏读取", "review": "像素证据核查横梁分歧"}[view] if beams_verified else (
                {"context": "完整谱行", "groups": "原灰度整组放大", "contrast": "灰度提亮整组放大"}[view] if contrast_compare else (
                {"context": "完整谱行", "groups": "完整谱行加整组横梁放大"}[view] if group_compare else (
                {"full": "原提示词", "trace": "逐符干追踪提示词"}[view] if prompt_compare else
                "完整谱行" if view == "full" else "符干局部放大")))
            cases.append((f"{len(cases) + 1:02d}_m{number}_{view}",
                          f"第{number}小节：" + label + "节奏读取", images,
                          "rhythm_diagnostic", case_system, user.replace("{{COLUMN_LABELS}}", labels)))
    return cases


def evaluate_rhythm(observation, anchors, reference):
    """Evaluate observed marks/timing only; never insert reference guitar notes."""
    rhythm_evidence(observation, anchors)
    expected = {m["number"]: m for m in reference["measures"]}
    result = {"expected_events": 0, "actual_events": 0, "marks_correct": 0, "beam_counts_correct": 0,
              "durations_correct": 0, "onsets_correct": 0, "rhythm_correct": 0,
              "unknown_durations": 0, "valid_timelines": 0, "rows": [], "metadata": [],
              "kind": "rhythm_only", "includes_fret_or_technique_accuracy": False}
    prediction = {"metadata": observation["metadata"], "measures": [], "kind": "rhythm_only"}
    for key, value in reference["metadata"].items():
        actual = observation["metadata"][key]
        result["metadata"].append({"field": key, "expected": value, "actual": actual,
                                   "correct": actual == value and type(actual) is type(value)})
    for measure in observation["measures"]:
        reference_events = expected[measure["number"]]["events"]
        result["expected_events"] += len(reference_events)
        result["actual_events"] += len(measure["columns"])
        cursor = Fraction(0) if measure["rhythm_mode"] == "single_sequence" else None
        events = []
        for index, column in enumerate(measure["columns"]):
            duration, issues = read_duration(column["kind"], column["rhythm"])
            onset = cursor
            event = {"column": column["index"], "onset": str(onset) if onset is not None else None,
                     "duration": str(duration) if duration is not None else None, "issues": issues}
            events.append(event)
            target = reference_events[index] if index < len(reference_events) else None
            marks_ok = target is not None and all(column["rhythm"][k] == v and
                       type(column["rhythm"][k]) is type(v) for k, v in target["marks"].items())
            beams_ok = target is not None and column["rhythm"]["beam_count"] == target["marks"]["beam_count"]
            duration_ok = target is not None and duration == Fraction(target["duration"])
            onset_ok = target is not None and onset == Fraction(target["onset"])
            result["marks_correct"] += marks_ok
            result["beam_counts_correct"] += beams_ok
            result["durations_correct"] += duration_ok
            result["onsets_correct"] += onset_ok
            result["rhythm_correct"] += duration_ok and onset_ok
            result["unknown_durations"] += duration is None
            result["rows"].append({"measure": measure["number"], "column": column["index"],
                "expected_onset": target["onset"] if target else None,
                "expected_duration": target["duration"] if target else None,
                "expected_beam_count": target["marks"]["beam_count"] if target else None,
                "observed_beam_count": column["rhythm"]["beam_count"], **event,
                "marks_correct": marks_ok, "duration_correct": duration_ok,
                "onset_correct": onset_ok, "exact": duration_ok and onset_ok})
            cursor = cursor + duration if cursor is not None and duration is not None else None
        signature = observation["metadata"]["time_signature"]
        result["valid_timelines"] += (cursor is not None and signature is not None and
                                     measure["completeness"] == "complete" and cursor == Fraction(*signature))
        prediction["measures"].append({"number": measure["number"], "events": events,
                                      "total_duration": str(cursor) if cursor is not None else None})
    return prediction, result
