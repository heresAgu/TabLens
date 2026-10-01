"""Offline-only position/group scoring; this module never calls the model."""

import argparse
from collections import Counter
import json
from pathlib import Path


def evaluate(score, reference):
    expected, actual = {}, {}
    for measure in reference["measures"]:
        groups = measure.get("event_notes")
        if groups is None:
            groups = [[[n["string"], n["fret"]] for n in event["notes"]]
                      for event in measure["events"]]
        for column, group in enumerate(groups, 1):
            expected[measure["number"], column] = sorted(tuple(n) for n in group)
    for measure in score["measures"]:
        for index, event in enumerate(measure["events"], 1):
            key = measure["number"], event.get("column", index)
            if key in actual:
                raise ValueError("重复事件位置，不能静默覆盖")
            actual[key] = sorted(((n["string"], n["fret"]) for n in event["notes"]), key=repr)
    expected_notes = Counter((m, c, s, f) for (m, c), notes in expected.items() for s, f in notes)
    actual_notes = Counter((m, c, s, f) for (m, c), notes in actual.items() for s, f in notes)
    differences = [{"measure": key[0], "column": key[1], "expected": expected.get(key),
                    "actual": actual.get(key)} for key in sorted(expected.keys() | actual.keys())
                   if Counter(expected.get(key, [])) != Counter(actual.get(key, [])) or key not in expected or key not in actual]
    chords = [key for key, notes in expected.items() if len(notes) > 1]
    return {"expected_notes": sum(expected_notes.values()), "returned_notes": sum(actual_notes.values()),
            "notes_matching_string_fret_column": sum((expected_notes & actual_notes).values()),
            "missing_notes": sum((expected_notes - actual_notes).values()),
            "extra_or_wrong_notes": sum((actual_notes - expected_notes).values()),
            "expected_events": len(expected), "returned_events": len(actual),
            "correct_event_groups": sum(key in actual and Counter(notes) == Counter(actual[key])
                                        for key, notes in expected.items()),
            "expected_chords": len(chords),
            "correct_chords": sum(key in actual and Counter(expected[key]) == Counter(actual[key]) for key in chords),
            "positions_pass": not differences, "differences": differences, "rhythm_evaluated": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("score", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = evaluate(json.loads(args.score.read_text(encoding="utf-8")),
                      json.loads(args.reference.read_text(encoding="utf-8")))
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    print(text)
