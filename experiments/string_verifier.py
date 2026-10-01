"""Focused string/fret diagnostics and before/after verification metrics."""

from collections import Counter
from pathlib import Path


PROMPT_DIR = Path(__file__).resolve().parent / "prompts"


class StringFormatError(ValueError):
    pass


def _keys(value, expected, path):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise StringFormatError(f"{path}：字段不符合逐弦读取格式")


def _issues(value, path):
    if not isinstance(value, list) or len(value) > 64 or any(
            not isinstance(item, str) or len(item) > 2000 for item in value):
        raise StringFormatError(f"{path}：待确认项必须为字符串列表")


def validate_reading(value, target_numbers=(2, 3)):
    _keys(value, ["measures", "uncertain_items"], "$")
    _issues(value["uncertain_items"], "$.uncertain_items")
    if not isinstance(value["measures"], list) or len(value["measures"]) != len(target_numbers):
        raise StringFormatError("measures：必须完整输出本轮目标小节")
    numbers = []
    normalized = {"measures": [], "uncertain_items": list(value["uncertain_items"])}
    for measure in value["measures"]:
        _keys(measure, ["number", "strings", "uncertain_items"], "measure")
        number = measure["number"]
        if type(number) is not int or number not in target_numbers or number in numbers:
            raise StringFormatError("measure.number：小节号错误或重复")
        numbers.append(number)
        _issues(measure["uncertain_items"], f"小节 {number}.uncertain_items")
        if not isinstance(measure["strings"], list) or len(measure["strings"]) != 6:
            raise StringFormatError(f"小节 {number}：需要完整输出六根弦")
        rows, seen = [], set()
        for row in measure["strings"]:
            _keys(row, ["string", "frets"], f"小节 {number}.string")
            string = row["string"]
            if type(string) is not int or not 1 <= string <= 6 or string in seen:
                raise StringFormatError(f"小节 {number}：弦号错误或重复")
            seen.add(string)
            frets = row["frets"]
            if frets is not None:
                if not isinstance(frets, list) or len(frets) > 256 or any(
                        fret is not None and (type(fret) is not int or not 0 <= fret <= 36)
                        for fret in frets):
                    raise StringFormatError(f"小节 {number} 第 {string} 弦：品位列表错误")
            rows.append({"string": string, "frets": list(frets) if frets is not None else None})
        normalized["measures"].append({"number": number,
            "strings": sorted(rows, key=lambda row: row["string"]),
            "uncertain_items": list(measure["uncertain_items"])})
    normalized["measures"].sort(key=lambda measure: measure["number"])
    return normalized


def ordered_matches(expected, actual):
    """Longest common subsequence: retain order without assuming time columns."""
    if actual is None:
        return 0
    previous = [0] * (len(actual) + 1)
    for fret in expected:
        current = [0]
        for index, observed in enumerate(actual, 1):
            current.append(previous[index - 1] + 1 if observed is not None and fret == observed
                           else max(previous[index], current[-1]))
        previous = current
    return previous[-1]


def evaluate_reading(reading, reference):
    indexed = {measure["number"]: measure for measure in reading["measures"]}
    rows = []
    total_notes = actual_notes = unknown_digits = order_matches = ignored_string_matches = 0
    for measure in reference["measures"]:
        number = measure["number"]
        expected_rows = {string: [] for string in range(1, 7)}
        for event in measure["events"]:
            for note in event["notes"]:
                expected_rows[note["string"]].append(note["fret"])
        actual_rows = {row["string"]: row["frets"] for row in indexed[number]["strings"]}
        expected_inventory, actual_inventory = Counter(), Counter()
        for string in range(1, 7):
            expected, actual = expected_rows[string], actual_rows[string]
            matches = ordered_matches(expected, actual)
            rows.append({"measure": number, "string": string, "expected": expected,
                         "actual": actual, "correct": actual == expected,
                         "ordered_matches": matches})
            total_notes += len(expected)
            order_matches += matches
            expected_inventory.update(expected)
            if actual is not None:
                actual_notes += len(actual)
                unknown_digits += sum(fret is None for fret in actual)
                actual_inventory.update(fret for fret in actual if fret is not None)
        ignored_string_matches += sum((expected_inventory & actual_inventory).values())
    nonempty = [row for row in rows if row["expected"]]
    return {"expected_rows": len(rows), "correct_rows": sum(row["correct"] for row in rows),
            "expected_nonempty_rows": len(nonempty),
            "correct_nonempty_rows": sum(row["correct"] for row in nonempty),
            "expected_notes": total_notes, "actual_notes": actual_notes,
            "ordered_note_matches": order_matches,
            "fret_inventory_matches_ignoring_strings": ignored_string_matches,
            "unknown_rows": sum(row["actual"] is None for row in rows),
            "unknown_digits": unknown_digits, "rows": rows}


def compare_verification(before, after):
    old = {(row["measure"], row["string"]): row for row in before["rows"]}
    fixed = regressed = remaining_wrong = changed = 0
    for row in after["rows"]:
        previous = old[(row["measure"], row["string"])]
        fixed += not previous["correct"] and row["correct"]
        regressed += previous["correct"] and not row["correct"]
        remaining_wrong += not previous["correct"] and not row["correct"]
        changed += previous["actual"] != row["actual"]
    return {"fixed_rows": fixed, "regressed_rows": regressed,
            "remaining_wrong_rows": remaining_wrong, "changed_rows": changed,
            "ordered_note_match_delta": after["ordered_note_matches"] - before["ordered_note_matches"]}


def load_string_prompts(direction):
    files = {"forward": "strings_forward_user.txt", "reverse": "strings_reverse_user.txt",
             "review": "strings_review_user.txt"}
    return ((PROMPT_DIR / "strings_system.txt").read_text(encoding="utf-8"),
            (PROMPT_DIR / files[direction]).read_text(encoding="utf-8"))
