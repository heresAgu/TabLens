import copy
from fractions import Fraction
import json
import unittest

from recognition_lab import REFERENCE_PATH, evaluate
from symbol_reader import (SCHEMA_VERSION, SymbolFormatError, compare_string_reading,
                           compile_evidence, load_symbol_prompts, read_duration)


def reference_symbols():
    """Synthetic local fixture from the manually verified reference; never an API input."""
    reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
    evidence = {"schema_version": SCHEMA_VERSION, "metadata": reference["metadata"],
                "measures": [], "uncertain_items": []}
    for expected in reference["measures"]:
        rows = [{"string": string, "notes": []} for string in range(1, 7)]
        columns = []
        for column, event in enumerate(expected["events"], 1):
            for note in event["notes"]:
                rows[note["string"] - 1]["notes"].append({"column": column, "fret": note["fret"]})
            columns.append({"index": column, "kind": "notes", "uncertain_items": [],
                            "rhythm": {"stem_present": True, "beam_count": 1, "flag_count": 0,
                                       "dot_count": 0, "note_shape": None, "rest_symbol": None,
                                       "unsupported_marks": []}})
        evidence["measures"].append({"number": expected["number"], "rhythm_mode": "single_sequence",
                                     "completeness": "complete", "string_rows": rows,
                                     "columns": columns, "connections": [], "unassigned_notes": [],
                                     "uncertain_items": []})
    return evidence


class SymbolReaderTests(unittest.TestCase):
    def setUp(self):
        self.evidence = reference_symbols()
        self.reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))

    def test_complete_fixture_preserves_chords_and_source_ids(self):
        score, diagnostics = compile_evidence(self.evidence)
        comparison = evaluate(score, self.reference)
        self.assertEqual(comparison["exact_events"], 16)
        self.assertEqual(comparison["exact_measures"], 2)
        self.assertTrue(diagnostics["ready_for_playback"])
        self.assertEqual(len(score["measures"][0]["events"][0]["notes"]), 2)
        notes = [note for measure in score["measures"] for event in measure["events"] for note in event["notes"]]
        self.assertEqual(len({note["id"] for note in notes}), 20)
        self.assertTrue(all("source" in note for note in notes))

    def test_mixed_short_beams_are_converted_per_column(self):
        measure = self.evidence["measures"][0]
        template = copy.deepcopy(measure["columns"][0])
        beams = [1] * 7 + [3, 3, 2]
        measure["columns"] = []
        for index, beam in enumerate(beams, 1):
            column = copy.deepcopy(template)
            column["index"] = index
            column["rhythm"]["beam_count"] = beam
            measure["columns"].append(column)
        for row in measure["string_rows"]:
            row["notes"] = [{"column": index, "fret": 7} for index in range(1, 11)] if row["string"] == 4 else []
        self.evidence["measures"] = [measure]
        score, diagnostics = compile_evidence(self.evidence)
        events = score["measures"][0]["events"]
        self.assertEqual([event["duration"] for event in events[-4:]], ["1/8", "1/32", "1/32", "1/16"])
        self.assertEqual([event["onset"] for event in events[-3:]], ["7/8", "29/32", "15/16"])
        self.assertTrue(diagnostics["ready_for_playback"])

    def test_flags_and_dots_use_exact_fractions(self):
        rhythm = copy.deepcopy(self.evidence["measures"][0]["columns"][0]["rhythm"])
        rhythm.update(beam_count=0, flag_count=1, dot_count=1)
        self.assertEqual(read_duration("notes", rhythm), (Fraction(3, 16), []))
        rhythm.update(flag_count=0, dot_count=2)
        self.assertEqual(read_duration("notes", rhythm), (Fraction(7, 16), []))

    def test_unknown_duration_does_not_invent_later_onsets(self):
        self.evidence["measures"][0]["columns"][0]["rhythm"]["beam_count"] = None
        score, diagnostics = compile_evidence(self.evidence)
        events = score["measures"][0]["events"]
        self.assertEqual(events[0]["onset"], "0")
        self.assertIsNone(events[0]["duration"])
        self.assertTrue(all(event["onset"] is None for event in events[1:]))
        self.assertEqual(score["measures"][1]["events"][0]["onset"], "0")
        self.assertFalse(diagnostics["ready_for_playback"])

    def test_mismatched_bar_is_not_repaired_to_fit(self):
        self.evidence["measures"][0]["columns"][0]["rhythm"]["beam_count"] = 0
        score, diagnostics = compile_evidence(self.evidence)
        self.assertEqual(score["measures"][0]["events"][0]["duration"], "1/4")
        self.assertEqual(score["measures"][0]["notated_length"], "9/8")
        self.assertFalse(diagnostics["measures"][0]["timeline_valid"])
        self.assertEqual(len(score["measures"][0]["events"]), 8)

    def test_rest_is_not_treated_as_an_open_string(self):
        measure = self.evidence["measures"][0]
        for row in measure["string_rows"]:
            row["notes"] = [note for note in row["notes"] if note["column"] != 1]
        column = measure["columns"][0]
        column["kind"] = "rest"
        column["rhythm"].update(stem_present=False, beam_count=0, rest_symbol="eighth")
        score, diagnostics = compile_evidence(self.evidence)
        event = score["measures"][0]["events"][0]
        self.assertEqual((event["kind"], event["duration"], event["notes"]), ("rest", "1/8", []))
        self.assertTrue(diagnostics["ready_for_playback"])

    def test_rest_note_conflict_preserves_digits_for_review(self):
        column = self.evidence["measures"][0]["columns"][0]
        column["kind"] = "rest"
        column["rhythm"].update(stem_present=False, beam_count=0, rest_symbol="eighth")
        score, diagnostics = compile_evidence(self.evidence)
        self.assertEqual(len(score["measures"][0]["events"][0]["notes"]), 2)
        self.assertFalse(diagnostics["ready_for_playback"])

    def test_zero_fret_is_not_a_whole_note_without_a_marker(self):
        rhythm = self.evidence["measures"][0]["columns"][0]["rhythm"]
        rhythm.update(stem_present=False, beam_count=0)
        score, diagnostics = compile_evidence(self.evidence)
        self.assertIsNone(score["measures"][0]["events"][0]["duration"])
        self.assertFalse(diagnostics["ready_for_playback"])

    def test_unassigned_digit_is_retained_and_blocks_readiness(self):
        self.evidence["measures"][0]["unassigned_notes"] = [
            {"string": None, "column": None, "fret": 12, "reason": "无法定位"}]
        score, diagnostics = compile_evidence(self.evidence)
        self.assertEqual(score["measures"][0]["unassigned_notes"][0]["fret"], 12)
        self.assertFalse(diagnostics["ready_for_playback"])

    def test_curve_does_not_become_a_guessed_technique(self):
        self.evidence["measures"][0]["connections"] = [
            {"from_column": 1, "to_column": 5, "string": 2, "mark": "curve",
             "text": None, "uncertain_items": []}]
        score, diagnostics = compile_evidence(self.evidence)
        self.assertTrue(all(not event["techniques"] for event in score["measures"][0]["events"]))
        self.assertEqual(score["measures"][0]["observed_connections"][0]["status"], "needs_review")
        self.assertFalse(diagnostics["ready_for_playback"])

    def test_polyphony_is_not_flattened_into_guessed_onsets(self):
        self.evidence["measures"][0]["rhythm_mode"] = "multiple_voices"
        score, diagnostics = compile_evidence(self.evidence)
        self.assertTrue(all(event["onset"] is None for event in score["measures"][0]["events"]))
        self.assertFalse(diagnostics["ready_for_playback"])

    def test_tuplet_marker_is_retained_as_an_unsupported_observation(self):
        self.evidence["measures"][0]["columns"][0]["rhythm"]["unsupported_marks"] = ["连音组：3"]
        score, diagnostics = compile_evidence(self.evidence)
        self.assertIsNone(score["measures"][0]["events"][0]["duration"])
        self.assertFalse(diagnostics["ready_for_playback"])

    def test_invalid_symbol_structure_is_rejected(self):
        changes = [lambda e: e["measures"][0]["columns"][0]["rhythm"].update(beam_count=True),
                   lambda e: e["measures"][0]["string_rows"].reverse(),
                   lambda e: e["measures"][0]["string_rows"][1]["notes"][0].update(column=99),
                   lambda e: e["measures"][0]["columns"][0].update(index=2),
                   lambda e: e["measures"][0]["string_rows"][1]["notes"].insert(0, {"column": 1, "fret": 0}),
                   lambda e: e.update(confidence=0.97)]
        for change in changes:
            with self.subTest(change=change):
                evidence = copy.deepcopy(self.evidence)
                change(evidence)
                with self.assertRaises(SymbolFormatError):
                    compile_evidence(evidence)

    def test_string_reading_and_column_assignment_are_scored_separately(self):
        self.evidence["measures"][0]["string_rows"][1]["notes"][0]["column"] = 2
        reading = compare_string_reading(self.evidence, self.reference)
        self.assertEqual(reading["correct_rows"], 12)
        self.assertEqual(reading["note_positions_matching"], 19)

    def test_structural_readiness_does_not_mean_transcription_accuracy(self):
        self.evidence["measures"][0]["string_rows"][1]["notes"][0]["fret"] = 9
        score, diagnostics = compile_evidence(self.evidence)
        self.assertTrue(diagnostics["ready_for_playback"])
        self.assertEqual(evaluate(score, self.reference)["exact_events"], 15)

    def test_prompts_do_not_include_target_answer(self):
        system, user = load_symbol_prompts()
        self.assertNotIn('"string":2,"fret":0', system + user)
        self.assertNotIn("16 个", system + user)
        self.assertNotIn("8 个八分", system + user)


if __name__ == "__main__":
    unittest.main()
