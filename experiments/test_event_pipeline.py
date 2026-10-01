import copy
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from event_pipeline import (detect_columns, grouping_diagnostic, merge_observations,
                            position_evidence, prepare_event_samples, rhythm_evidence)
from recognition_lab import REFERENCE_PATH, evaluate
from string_anchors import AnchorError, prepare_anchor_samples
from symbol_reader import SymbolFormatError
from test_symbol_reader import reference_symbols


def reference_parts():
    evidence = reference_symbols()
    positions = {"measures": [{key: copy.deepcopy(measure[key]) for key in
                              ["number", "string_rows", "unassigned_notes", "uncertain_items"]}
                             for measure in evidence["measures"]], "uncertain_items": []}
    rhythm = {"metadata": copy.deepcopy(evidence["metadata"]),
              "measures": [{key: copy.deepcopy(measure[key]) for key in
                            ["number", "rhythm_mode", "completeness", "columns", "uncertain_items"]}
                           for measure in evidence["measures"]], "uncertain_items": []}
    anchors = {"string_y": [20, 40, 60, 80, 100, 120], "row_file": "local-fixture.png",
               "measures": [{"number": measure["number"],
                             "columns": [{"index": c["index"], "x": c["index"] * 50}
                                         for c in measure["columns"]]} for measure in evidence["measures"]]}
    return positions, rhythm, anchors


class EventPipelineTests(unittest.TestCase):
    def setUp(self):
        self.positions, self.rhythm, self.anchors = reference_parts()
        self.reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))

    def test_merge_preserves_simultaneous_groups_order_and_source_locations(self):
        before = copy.deepcopy((self.positions, self.rhythm, self.anchors))
        _, score, diagnostics = merge_observations(self.positions, self.rhythm, self.anchors)
        comparison = evaluate(score, self.reference)
        groups = grouping_diagnostic(comparison, score, self.reference)
        self.assertEqual(comparison["exact_events"], 16)
        self.assertEqual(groups["correct_simultaneous_groups"], 4)
        self.assertEqual(groups["correct_single_groups"], 12)
        self.assertTrue(diagnostics["ready_for_playback"])
        self.assertEqual([event["duration"] for event in score["measures"][0]["events"]], ["1/8"] * 8)
        first = score["measures"][0]["events"][0]
        self.assertEqual(len(first["notes"]), 2)
        self.assertTrue(all(note["source"]["x"] == 50 for note in first["notes"]))
        self.assertNotEqual(first["notes"][0]["source"]["y"], first["notes"][1]["source"]["y"])
        self.assertEqual(before, (self.positions, self.rhythm, self.anchors))

    def test_same_chord_count_with_wrong_notes_is_not_counted_as_correct(self):
        self.positions["measures"][0]["string_rows"][1]["notes"][0]["fret"] = 9
        _, score, _ = merge_observations(self.positions, self.rhythm, self.anchors)
        groups = grouping_diagnostic(evaluate(score, self.reference), score, self.reference)
        self.assertEqual(groups["actual_simultaneous_groups"], 4)
        self.assertEqual(groups["correct_simultaneous_groups"], 3)

    def test_unknown_rhythm_does_not_get_guessed_from_other_columns(self):
        self.rhythm["measures"][0]["columns"][1]["rhythm"]["beam_count"] = None
        _, score, diagnostics = merge_observations(self.positions, self.rhythm, self.anchors)
        events = score["measures"][0]["events"]
        self.assertEqual(events[1]["onset"], "1/8")
        self.assertIsNone(events[1]["duration"])
        self.assertIsNone(events[2]["onset"])
        self.assertEqual(events[2]["duration"], "1/8")
        self.assertFalse(diagnostics["ready_for_playback"])

    def test_columns_cannot_be_silently_deleted_or_referenced_outside_manifest(self):
        self.positions["measures"][0]["string_rows"][1]["notes"][0]["column"] = 99
        with self.assertRaises(SymbolFormatError):
            position_evidence(self.positions, self.anchors)
        self.rhythm["measures"][0]["columns"].pop()
        with self.assertRaises(SymbolFormatError):
            rhythm_evidence(self.rhythm, self.anchors)

    def test_missing_measure_and_extra_output_fields_are_rejected(self):
        self.positions["measures"].pop()
        with self.assertRaises(SymbolFormatError):
            position_evidence(self.positions, self.anchors)
        self.rhythm["measures"][0]["duration"] = "1/8"
        with self.assertRaises(SymbolFormatError):
            rhythm_evidence(self.rhythm, self.anchors)


class ColumnImageTests(unittest.TestCase):
    def source(self):
        image = Image.new("RGB", (600, 220), "white")
        draw = ImageDraw.Draw(image)
        for y in [20, 40, 60, 80, 100, 120]:
            draw.line((0, y, 599, y), fill="#aaaaaa", width=2)
        for x in [0, 300, 599]:
            draw.line((x, 20, x, 122), fill="black", width=2)
        for x in [60, 150, 400, 500]:
            draw.line((x, 140, x, 180), fill="black", width=2)
        draw.line((60, 180, 150, 180), fill="black", width=5)
        draw.line((400, 180, 500, 180), fill="black", width=5)
        return image

    def test_detects_stem_columns_without_an_expected_event_count(self):
        anchors = detect_columns(self.source(), [20, 40, 60, 80, 100, 120])
        self.assertFalse(anchors["reference_used"])
        self.assertEqual([len(m["columns"]) for m in anchors["measures"]], [2, 2])
        self.assertEqual([c["x"] for m in anchors["measures"] for c in m["columns"]], [60.5, 150.5, 400.5, 500.5])

    def test_missing_boundary_fails_instead_of_inventing_measures(self):
        image = self.source()
        ImageDraw.Draw(image).rectangle((298, 0, 303, 219), fill="white")
        with self.assertRaises(AnchorError):
            detect_columns(image, [20, 40, 60, 80, 100, 120])

    def test_column_labels_do_not_overwrite_original_score_pixels(self):
        with tempfile.TemporaryDirectory(prefix="tablab-events-") as temporary:
            root = Path(temporary)
            row_path = root / "row.png"
            source = self.source()
            source.save(row_path)
            samples = {"row": row_path, **prepare_anchor_samples(row_path, root)}
            generated = prepare_event_samples(samples, root)
            geometry = json.loads(samples["anchors_metadata"].read_text(encoding="utf-8"))
            margin = geometry["labelled_source_box"][0]
            with Image.open(generated["rhythm_columns"]) as rhythm:
                self.assertEqual(rhythm.crop((margin, 0, margin + source.width, source.height)).tobytes(), source.tobytes())
            with Image.open(generated["positioned_panels"]) as panels:
                for panel in geometry["panels"]:
                    snippet = source.crop(panel["source_box"])
                    x, y = panel["paste_xy"]
                    self.assertEqual(panels.crop((x, y, x + snippet.width, y + snippet.height)).tobytes(), snippet.tobytes())


if __name__ == "__main__":
    unittest.main()
