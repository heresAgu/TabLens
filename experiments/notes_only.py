"""Song-independent cell and string reading; rhythm is outside acceptance."""

import json
import math
import hashlib
import shutil
import time
import uuid
from datetime import datetime
from pathlib import Path

import requests
from PIL import Image

from cell_reader import cells_to_positions, load_cell_prompts, prepare_cell_samples
from cell_verifier import (apply_review, checked_positions, cross_check,
                           load_review_prompts, prepare_review_cards, resolve_note_review)
from event_pipeline import detect_columns
from string_anchors import prepare_anchor_samples
from string_verifier import validate_reading


BASE_DIR = Path(__file__).resolve().parent


def prepare_samples():
    target = json.loads((BASE_DIR / "note_positions_target.json").read_text(encoding="utf-8"))
    source_path = (BASE_DIR.parent / target["source"]).resolve()
    if source_path.parent != BASE_DIR.parent or not source_path.is_file():
        raise ValueError("目标谱图必须为项目目录中的现有图片")
    output_dir = BASE_DIR / "samples" / "note_positions"
    output_dir.mkdir(parents=True, exist_ok=True)
    samples = {"whole_page": source_path, "row": output_dir / "row.png",
               "header": output_dir / "header.png", "event_manifest": output_dir / "event_anchors.json"}
    with Image.open(source_path) as source:
        source = source.convert("RGB")
        source.crop(tuple(target["row_box"])).save(samples["row"])
        source.crop(tuple(target["header_box"])).save(samples["header"])
    samples.update(prepare_anchor_samples(samples["row"], output_dir, allow_extra_lines=True))
    geometry = json.loads(samples["anchors_metadata"].read_text(encoding="utf-8"))
    with Image.open(samples["row"]) as source:
        anchors = detect_columns(source, geometry["string_y"], tuple(target["measure_numbers"]))
    anchors.update({"row_file": str(samples["row"]), "source_file": str(source_path),
                    "source_crop_box": target["row_box"], "rhythm_read": False,
                    "columns_are_note_candidates": True})
    samples["event_manifest"].write_text(json.dumps(anchors, indent=2), encoding="utf-8")
    samples.update(prepare_cell_samples(samples, output_dir))
    with Image.open(samples["row"]) as row:
        for measure in anchors["measures"]:
            number = measure["number"]
            measure_dir = output_dir / f"m{number}"
            measure_dir.mkdir(exist_ok=True)
            measure_path = measure_dir / "measure.png"
            row.crop((max(0, math.floor(measure["left"])), 0,
                      min(row.width, math.ceil(measure["right"]) + 1), row.height)).save(measure_path)
            panels = prepare_anchor_samples(measure_path, measure_dir, allow_extra_lines=True)
            samples[f"audit_m{number}"] = measure_dir / "strings_zoom.png"
            with Image.open(panels["separated_strings"]) as image:
                image.resize((image.width * 2, image.height * 2), Image.Resampling.NEAREST).save(samples[f"audit_m{number}"])
    return samples


def experiment_cases(samples):
    anchors = json.loads(samples["event_manifest"].read_text(encoding="utf-8"))
    system, user = load_cell_prompts(samples)
    images = [samples["header"]] + [samples[f"cells_m{m['number']}"] for m in anchors["measures"]]
    string_system = (BASE_DIR / "prompts" / "strings_system.txt").read_text(encoding="utf-8")
    string_user = (BASE_DIR / "prompts" / "strings_measures_generic_user.txt").read_text(encoding="utf-8")
    descriptions = "；".join(f"第{index + 2}张图是第{m['number']}小节" for index, m in enumerate(anchors["measures"]))
    string_user = string_user.replace("{{MEASURE_IMAGES}}", descriptions)
    review_system, review_user = load_review_prompts([])
    return [("01_cells", "按弦与位置分格读取", images, "note_cells", system, user),
            ("02_strings", "独立逐弦复核", [samples["header"]] + [samples[f"audit_m{m['number']}"] for m in anchors["measures"]],
             "note_strings", string_system, string_user),
            ("03_review", "有分歧才放大复核", [], "note_review", review_system, review_user)]


def build_score(cells, check, anchors, geometry):
    positions = checked_positions(cells, check, anchors)
    boxes = {(c["measure"], c["string"], c["column"]): c["source_box"] for c in geometry["cells"]}
    measures = []
    for measure in positions["measures"]:
        events = []
        for column in next(m for m in anchors["measures"] if m["number"] == measure["number"])["columns"]:
            notes = []
            for row in measure["string_rows"]:
                for note in row["notes"]:
                    if note["column"] == column["index"]:
                        notes.append({"string": row["string"], "fret": note["fret"],
                                      "source_box_in_row": boxes[measure["number"], row["string"], column["index"]]})
            events.append({"id": f"m{measure['number']}-c{column['index']}",
                           "column": column["index"], "onset": None, "duration": None,
                           "notes": notes, "kind": "notes" if notes else "unknown"})
        measures.append({"number": measure["number"], "events": events,
                         "unassigned_notes": measure["unassigned_notes"],
                         "uncertain_items": measure["uncertain_items"]})
    return {"schema_version": "note-positions-v1", "source_file": anchors["source_file"],
            "source_crop_box": anchors["source_crop_box"], "measures": measures,
            "uncertain_items": positions["uncertain_items"], "rhythm_status": "not_read",
            "independent_readings_consistent": check["consistent"],
            "verification_resolved": check.get("resolved", check["consistent"]),
            "accuracy_verified": False}


def run_experiment(secret, emit, cancelled):
    import recognition_lab as lab

    samples = prepare_samples()
    run_dir = BASE_DIR / "runs" / (datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])
    run_dir.mkdir(parents=True)
    cases, manifest = lab.freeze_input_images(experiment_cases(samples), run_dir)
    anchors = json.loads(samples["event_manifest"].read_text(encoding="utf-8"))
    geometry = json.loads(samples["cell_geometry"].read_text(encoding="utf-8"))
    source_row = run_dir / "source_row.png"
    shutil.copyfile(samples["row"], source_row)
    lab.write_json(run_dir / "event_anchors.json", anchors)
    lab.write_json(run_dir / "cell_geometry.json", geometry)
    configuration = {"mode": "note_positions", "endpoint": lab.ENDPOINT, "model": lab.MODEL,
                     "temperature": 0, "thinking": "disabled", "max_tokens": lab.MAX_OUTPUT_TOKENS,
                     "maximum_api_calls": 3, "automatic_retries": 0, "rhythm_read": False,
                     "reference_used": False, "input_manifest": manifest, "cases": []}
    results, cells, audit, check = [], None, None, None
    sent_requests = 0
    targets = []
    state = "complete"
    try:
        with requests.Session() as session:
            for case_id, label, images, method, system, user in cases:
                if cancelled.is_set():
                    state = "cancelled"
                    break
                if method == "note_review":
                    targets = check["review_targets"]
                    if not targets:
                        emit("log", "两次独立读数一致，跳过第3次付费复核；仍须对照原图验收。")
                        break
                    images, review_manifest = prepare_review_cards(source_row, geometry, targets, run_dir / "inputs")
                    lab.write_json(run_dir / "review_geometry.json", review_manifest)
                    system, user = load_review_prompts(targets)
                    for path in images:
                        with Image.open(path) as image:
                            size = list(image.size)
                        manifest.append({"file": str(path), "size": size,
                                         "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "detail": "original"})
                configuration["cases"].append({"id": case_id, "system_prompt": system, "user_prompt": user,
                                                "images": [str(p) for p in images],
                                                "prompt_sha256": hashlib.sha256((system + user).encode()).hexdigest()})
                lab.write_json(run_dir / "configuration.json", configuration)
                lab.write_status("running", mode="note_positions", run_directory=str(run_dir), current_case=case_id)
                emit("log", label + "：正在请求模型……")
                content = [{"type": "text", "text": user}] + [
                    {"type": "image_url", "image_url": {"url": lab.image_data_url(p), "detail": "original"}} for p in images]
                payload = {"model": lab.MODEL, "messages": [{"role": "system", "content": system},
                            {"role": "user", "content": content}], "thinking": {"type": "disabled"},
                           "temperature": 0, "response_format": {"type": "json_object"}, "max_tokens": lab.MAX_OUTPUT_TOKENS}
                started = time.monotonic()
                sent_requests += 1
                response = session.post(lab.ENDPOINT, headers={"Authorization": "Bearer " + secret},
                                        json=payload, timeout=(20, 180), allow_redirects=False)
                result = {"case": case_id, "http_status": response.status_code,
                          "elapsed_seconds": round(time.monotonic() - started, 2)}
                if response.status_code != 200:
                    result["status"] = "request_failed"
                    results.append(result)
                    state = "needs_attention"
                    break
                raw = response.json()
                lab.write_json(run_dir / (case_id + "_raw.json"), lab.redact(raw, secret))
                result.update({"usage": raw.get("usage", {}), "returned_model": raw.get("model")})
                choice = raw["choices"][0]
                if choice.get("finish_reason") == "length":
                    result["status"] = "output_truncated"
                    results.append(result)
                    state = "needs_attention"
                    break
                prediction = json.loads(choice["message"]["content"])
                lab.write_json(run_dir / (case_id + "_reading.json"), lab.redact(prediction, secret))
                if method == "note_cells":
                    cells = prediction
                    cells_to_positions(cells, anchors)
                elif method == "note_strings":
                    audit = validate_reading(prediction, tuple(m["number"] for m in anchors["measures"]))
                    check = cross_check(cells, audit, None, anchors)
                else:
                    initial_cells = cells
                    cells, changes = apply_review(cells, prediction, targets, anchors)
                    check = resolve_note_review(initial_cells, cells, prediction, targets, audit, anchors)
                    result["changes"] = changes
                result["status"] = "parsed"
                results.append(result)
                if check is not None:
                    lab.write_json(run_dir / "cross_check.json", check)
                    lab.write_json(run_dir / "final_cells.json", lab.redact(cells, secret))
                    lab.write_json(run_dir / "note_positions.json", lab.redact(build_score(cells, check, anchors, geometry), secret))
                lab.write_json(run_dir / "summary.json", {"results": lab.redact(results, secret)})
        if check is not None and not check.get("resolved", check["consistent"]):
            state = "needs_attention"
    except Exception:
        # Never expose request headers or exceptions that could contain the credential.
        state = "needs_attention"
        emit("log", "请求或输出格式失败，已停止；原始结果保留，没有自动重试。")
    finally:
        lab.write_json(run_dir / "summary.json", {"state": state, "completed_requests": len(results),
            "api_requests_sent": sent_requests, "maximum_api_calls": 3,
            "results": lab.redact(results, secret), "cross_check": check})
        lab.write_status(state, mode="note_positions", run_directory=str(run_dir),
                         completed_requests=len(results), planned_requests=3)
        emit("done", {"state": state, "completed_requests": len(results), "report": None,
                      "run_directory": str(run_dir)})
        secret = ""


def resolve_saved_run(run_directory):
    """Reapply review rules to recorded model outputs; no API or reference read."""
    import recognition_lab as lab

    run_dir = Path(run_directory)
    anchors = json.loads((run_dir / "event_anchors.json").read_text(encoding="utf-8"))
    geometry = json.loads((run_dir / "cell_geometry.json").read_text(encoding="utf-8"))
    cells = json.loads((run_dir / "01_cells_reading.json").read_text(encoding="utf-8"))
    audit = json.loads((run_dir / "02_strings_reading.json").read_text(encoding="utf-8"))
    review = json.loads((run_dir / "03_review_reading.json").read_text(encoding="utf-8"))
    targets = cross_check(cells, audit, None, anchors)["review_targets"]
    reviewed, changes = apply_review(cells, review, targets, anchors)
    check = resolve_note_review(cells, reviewed, review, targets, audit, anchors)
    lab.write_json(run_dir / "review_resolution.json", {"api_requests_sent": 0, "changes": changes, "check": check})
    lab.write_json(run_dir / "note_positions_resolved.json", build_score(reviewed, check, anchors, geometry))
    return {"run_directory": str(run_dir), "api_requests_sent": 0,
            "resolved": check["resolved"], "locally_confirmed_rows": check["resolved_rows"],
            "changed_cells": len(changes)}
