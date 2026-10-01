"""Validate visible TAB marks and compile a single rhythm sequence, without an API."""

from __future__ import annotations

from collections import Counter
from fractions import Fraction
from pathlib import Path

PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
SCHEMA_VERSION = "tab-symbols-v1"


def _object(properties):
    return {"type": "object", "properties": properties, "required": list(properties),
            "additionalProperties": False}


def _array(items, maximum=256, minimum=0):
    return {"type": "array", "items": items, "minItems": minimum, "maxItems": maximum}


def _integer(low, high, nullable=False):
    return {"type": ["integer", "null"] if nullable else "integer", "minimum": low, "maximum": high}


def _enum(values, nullable=False):
    return {"enum": list(values) + ([None] if nullable else [])}


_text = {"type": "string", "maxLength": 2000}
_issues = _array(_text, 64)
_nullable_text = {"type": ["string", "null"], "maxLength": 2000}
_fret = _integer(0, 36, True)
_column = _integer(1, 256)
_rhythm = _object({
    "stem_present": {"type": ["boolean", "null"]},
    "beam_count": _integer(0, 6, True), "flag_count": _integer(0, 6, True),
    "dot_count": _integer(0, 3, True), "note_shape": _enum(["whole", "half"], True),
    "rest_symbol": _enum(["whole", "half", "quarter", "eighth", "sixteenth",
                          "thirty_second", "sixty_fourth"], True),
    "unsupported_marks": _issues,
})
SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Guitar TAB visual observations, v1",
    **_object({
        "schema_version": {"const": SCHEMA_VERSION},
        "metadata": _object({
            "title": _nullable_text, "tempo_bpm": _integer(1, 400, True),
            "tempo_unit": _enum(["quarter"], True),
            "time_signature": {"anyOf": [{"type": "null"}, _array(_integer(1, 64), 2, 2)]},
            "capo": _integer(0, 24, True),
            "string_labels_high_to_low": {"anyOf": [{"type": "null"}, _array(_text, 6, 6)]},
        }),
        "measures": _array(_object({
            "number": _integer(0, 100000),
            "rhythm_mode": _enum(["single_sequence", "multiple_voices", "unknown"]),
            "completeness": _enum(["complete", "pickup", "unknown"]),
            "string_rows": _array(_object({"string": _integer(1, 6),
                "notes": _array(_object({"column": _column, "fret": _fret}))}), 6, 6),
            "unassigned_notes": _array(_object({"string": _integer(1, 6, True),
                "column": _integer(1, 256, True), "fret": _fret, "reason": _text})),
            "columns": _array(_object({"index": _column,
                "kind": _enum(["notes", "rest", "unknown"]), "rhythm": _rhythm,
                "uncertain_items": _issues}), 256, 1),
            "connections": _array(_object({"from_column": _column, "to_column": _column,
                "string": _integer(1, 6, True),
                "mark": _enum(["curve", "straight_line", "H", "P", "slide_symbol", "other"]),
                "text": _nullable_text, "uncertain_items": _issues}), 128),
            "uncertain_items": _issues,
        }), 32, 1),
        "uncertain_items": _issues,
    }),
}


class SymbolFormatError(ValueError):
    pass


def _validate(value, schema, path="$"):
    """Validate the keywords used by SCHEMA; error messages never include field values."""
    if "anyOf" in schema:
        for option in schema["anyOf"]:
            try:
                _validate(value, option, path)
                return
            except SymbolFormatError:
                pass
        raise SymbolFormatError(f"{path}：字段类型不符合格式")
    types = schema.get("type")
    if types:
        types = [types] if isinstance(types, str) else types
        matches = {"null": value is None, "integer": type(value) is int,
                   "boolean": type(value) is bool, "string": isinstance(value, str),
                   "object": isinstance(value, dict), "array": isinstance(value, list)}
        if not any(matches[kind] for kind in types):
            raise SymbolFormatError(f"{path}：字段类型不符合格式")
    if "enum" in schema and not any(type(value) is type(option) and value == option
                                     for option in schema["enum"]):
        raise SymbolFormatError(f"{path}：不是允许的选项")
    if "const" in schema and value != schema["const"]:
        raise SymbolFormatError(f"{path}：格式版本不匹配")
    if value is None:
        return
    if type(value) is int and (value < schema.get("minimum", value) or value > schema.get("maximum", value)):
        raise SymbolFormatError(f"{path}：整数超出范围")
    if isinstance(value, str) and len(value) > schema.get("maxLength", len(value)):
        raise SymbolFormatError(f"{path}：文本过长")
    if isinstance(value, list):
        if not schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", len(value)):
            raise SymbolFormatError(f"{path}：列表长度不符合格式")
        for index, item in enumerate(value):
            _validate(item, schema["items"], f"{path}[{index}]")
    if isinstance(value, dict):
        properties = schema["properties"]
        if set(schema["required"]) - set(value):
            raise SymbolFormatError(f"{path}：缺少必需字段")
        if set(value) - set(properties):
            raise SymbolFormatError(f"{path}：存在未定义字段")
        for key, item in value.items():
            _validate(item, properties[key], f"{path}.{key}")


def validate_evidence(evidence):
    _validate(evidence, SCHEMA)
    numbers = set()
    for measure in evidence["measures"]:
        number = measure["number"]
        if number in numbers:
            raise SymbolFormatError("measures：小节号重复")
        numbers.add(number)
        if [row["string"] for row in measure["string_rows"]] != list(range(1, 7)):
            raise SymbolFormatError(f"小节 {number}：弦行必须按 1 至 6 排列且各出现一次")
        indices = [column["index"] for column in measure["columns"]]
        if indices != list(range(1, len(indices) + 1)):
            raise SymbolFormatError(f"小节 {number}：列号必须从 1 开始连续递增")
        for row in measure["string_rows"]:
            columns = [note["column"] for note in row["notes"]]
            if any(column not in indices for column in columns):
                raise SymbolFormatError(f"小节 {number}：品位引用了不存在的列")
            if columns != sorted(set(columns)):
                raise SymbolFormatError(f"小节 {number}：同一弦的品位列号必须递增，不能重复")
        for note in measure["unassigned_notes"]:
            if note["column"] is not None and note["column"] not in indices:
                raise SymbolFormatError(f"小节 {number}：未定位品位引用了不存在的列")
        for connection in measure["connections"]:
            if connection["from_column"] not in indices or connection["to_column"] not in indices:
                raise SymbolFormatError(f"小节 {number}：连接引用了不存在的列")
            if connection["from_column"] > connection["to_column"]:
                raise SymbolFormatError(f"小节 {number}：连接起点不能晚于终点")


def read_duration(kind, rhythm):
    """Return (whole-note fraction or None, review reasons) from visible marks."""
    if rhythm["unsupported_marks"]:
        return None, ["存在尚未支持的节奏记号，未换算时值"]
    dots = rhythm["dot_count"]
    if dots is None:
        return None, ["附点数量未知，未换算时值"]
    beams, flags = rhythm["beam_count"], rhythm["flag_count"]
    shape, rest = rhythm["note_shape"], rhythm["rest_symbol"]
    if kind == "rest":
        values = {"whole": Fraction(1), "half": Fraction(1, 2), "quarter": Fraction(1, 4),
                  "eighth": Fraction(1, 8), "sixteenth": Fraction(1, 16),
                  "thirty_second": Fraction(1, 32), "sixty_fourth": Fraction(1, 64)}
        if rest not in values:
            return None, ["休止符类型未知，未换算时值"]
        if shape is not None or beams not in (0, None) or flags not in (0, None):
            return None, ["休止符与音符节奏记号冲突"]
        base = values[rest]
    elif kind == "notes":
        if rest is not None:
            return None, ["音符列中出现休止符记号"]
        if shape is not None:
            if beams != 0 or flags != 0:
                return None, ["长时值记号与横梁或符尾冲突"]
            if shape == "half" and rhythm["stem_present"] is not True:
                return None, ["二分音符记号缺少明确符干"]
            if shape == "whole" and rhythm["stem_present"] is not False:
                return None, ["全音符记号与符干观察不一致"]
            base = Fraction(1, 1 if shape == "whole" else 2)
        else:
            if rhythm["stem_present"] is not True or beams is None or flags is None:
                return None, ["符干、横梁或符尾观察不完整，未换算时值"]
            if beams and flags:
                return None, ["同一符干同时报告横梁和符尾，需确认"]
            base = Fraction(1, 2 ** (2 + max(beams, flags)))
    else:
        return None, ["无法确认这一列是音符还是休止符"]
    return base * sum((Fraction(1, 2 ** dot) for dot in range(dots + 1)), Fraction(0)), []


def compile_evidence(evidence):
    validate_evidence(evidence)
    metadata = dict(evidence["metadata"])
    signature = metadata["time_signature"]
    target = Fraction(*signature) if signature is not None else None
    score = {"metadata": metadata, "measures": [], "uncertain_items": list(evidence["uncertain_items"])}
    diagnostics = {"schema_version": SCHEMA_VERSION, "ready_for_playback": True, "measures": []}
    for measure in evidence["measures"]:
        number = measure["number"]
        issues = list(measure["uncertain_items"])
        single_sequence = measure["rhythm_mode"] == "single_sequence"
        cursor = Fraction(0) if single_sequence else None
        if not single_sequence:
            issues.append("未确认单一节奏序列；本原型不为多声部猜测起点")
        by_column = {column["index"]: [] for column in measure["columns"]}
        for row in measure["string_rows"]:
            for index, note in enumerate(row["notes"], 1):
                by_column[note["column"]].append({
                    "id": f"m{number}-s{row['string']}-n{index}",
                    "string": row["string"], "fret": note["fret"],
                    "source": {"measure": number, "string_row": row["string"],
                               "row_note": index, "column": note["column"]},
                })
        events = []
        for column in measure["columns"]:
            index, kind = column["index"], column["kind"]
            notes = by_column[index]
            duration, reasons = read_duration(kind, column["rhythm"])
            reasons = list(column["uncertain_items"]) + reasons
            if kind == "notes" and not notes:
                reasons.append("音符列没有对应品位，需确认遗漏或分组")
            if kind == "rest" and notes:
                reasons.append("休止列与品位数字冲突，保留数字等待确认")
            if any(note["fret"] is None for note in notes):
                reasons.append("品位数字未知")
            events.append({"id": f"m{number}-c{index}", "kind": kind, "notes": notes,
                           "onset": str(cursor) if cursor is not None else None,
                           "duration": str(duration) if duration is not None else None,
                           "techniques": [], "uncertain_items": reasons,
                           "source": {"measure": number, "column": index}})
            issues.extend(f"第 {index} 列：{reason}" for reason in reasons)
            cursor = cursor + duration if cursor is not None and duration is not None else None
        if measure["unassigned_notes"]:
            issues.append("存在尚未定位到弦或发声列的品位，不允许直接播放")
        relations = [{**connection, "status": "needs_review"} for connection in measure["connections"]]
        if relations:
            issues.append("连接记号已保留，尚未解释为演奏技巧")
        timeline_valid = None
        if cursor is not None and target is not None:
            if measure["completeness"] == "complete":
                timeline_valid = cursor == target
                if not timeline_valid:
                    issues.append(f"小节总时值 {cursor} 与拍号长度 {target} 不一致；未补音或改时值")
            elif measure["completeness"] == "pickup":
                timeline_valid = 0 < cursor < target
                if not timeline_valid:
                    issues.append("弱起小节长度与标记不一致")
            if cursor > target:
                issues.append("事件超过拍号对应的小节边界")
        if target is None:
            issues.append("拍号未知，未校验小节长度")
        if measure["completeness"] == "unknown":
            issues.append("未确认是否为完整小节")
        issues = list(dict.fromkeys(issues))
        ready = timeline_valid is True and not issues
        diagnostics["ready_for_playback"] = diagnostics["ready_for_playback"] and ready
        diagnostics["measures"].append({"number": number, "timeline_valid": timeline_valid,
                                        "ready_for_playback": ready, "issues": issues})
        score["measures"].append({"number": number, "events": events,
                                  "rhythm_mode": measure["rhythm_mode"],
                                  "completeness": measure["completeness"],
                                  "notated_length": str(cursor) if cursor is not None else None,
                                  "observed_connections": relations,
                                  "unassigned_notes": list(measure["unassigned_notes"]),
                                  "uncertain_items": issues})
    if score["uncertain_items"]:
        diagnostics["ready_for_playback"] = False
    diagnostics["meaning"] = "仅表示内部结构可换算；不能证明识图正确或替代人工核对"
    return score, diagnostics


def compare_string_reading(evidence, reference):
    """Compare fret order per string separately from whole-event ordinal scoring."""
    indexed = {measure["number"]: measure for measure in evidence["measures"]}
    rows, expected_positions, actual_positions = [], Counter(), Counter()
    for expected_measure in reference["measures"]:
        number = expected_measure["number"]
        expected_rows = {string: [] for string in range(1, 7)}
        for column, event in enumerate(expected_measure["events"], 1):
            for note in event["notes"]:
                expected_rows[note["string"]].append(note["fret"])
                expected_positions[(number, column, note["string"], note["fret"])] += 1
        actual_rows = {row["string"]: row["notes"] for row in indexed.get(number, {}).get("string_rows", [])}
        for string in range(1, 7):
            notes = actual_rows.get(string)
            actual = [note["fret"] for note in notes] if notes is not None else None
            rows.append({"measure": number, "string": string, "expected": expected_rows[string],
                         "actual": actual, "correct": actual == expected_rows[string]})
    for measure in evidence["measures"]:
        for row in measure["string_rows"]:
            for note in row["notes"]:
                actual_positions[(measure["number"], note["column"], row["string"], note["fret"])] += 1
    return {"expected_rows": len(rows), "correct_rows": sum(row["correct"] for row in rows),
            "expected_notes": sum(expected_positions.values()),
            "assigned_notes": sum(actual_positions.values()),
            "unassigned_notes": sum(len(measure["unassigned_notes"]) for measure in evidence["measures"]),
            "note_positions_matching": sum((expected_positions & actual_positions).values()), "rows": rows}


def load_symbol_prompts():
    return ((PROMPT_DIR / "visual_evidence_system.txt").read_text(encoding="utf-8"),
            (PROMPT_DIR / "visual_evidence_reading.txt").read_text(encoding="utf-8"))
