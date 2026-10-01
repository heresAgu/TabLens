import copy
import json
from fractions import Fraction
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from event_pipeline import detect_columns
from rhythm_diagnostic import (REFERENCE_PATH, beam_group_geometry, brighten_grayscale,
                               evaluate_rhythm, grayscale_evidence, prepare_rhythm_samples,
                               render_beam_groups)
from symbol_reader import SymbolFormatError


def reference_rhythm(number):
    reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
    measure = next(m for m in reference["measures"] if m["number"] == number)
    observation = {"metadata": reference["metadata"], "measures": [{
        "number": number, "rhythm_mode": "single_sequence", "completeness": "complete",
        "columns": [{"index": e["index"], "kind": "notes", "rhythm": {
            **e["marks"], "note_shape": None, "rest_symbol": None, "unsupported_marks": []},
            "uncertain_items": []} for e in measure["events"]], "uncertain_items": []}], "uncertain_items": []}
    anchors = {"measures": [{"number": number, "columns": [{"index": e["index"]} for e in measure["events"]]}]}
    return observation, anchors, reference


class RhythmDiagnosticTests(unittest.TestCase):
    def test_reference_uses_continuous_fractional_times_and_complete_measures(self):
        reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
        for measure in reference["measures"]:
            cursor = Fraction(0)
            for event in measure["events"]:
                self.assertEqual(Fraction(event["onset"]), cursor)
                cursor += Fraction(event["duration"])
            self.assertEqual(cursor, 1)

    def test_group_maximum_beams_cannot_replace_per_stem_observations(self):
        observation, anchors, reference = reference_rhythm(1)
        observation["measures"][0]["columns"][-1]["rhythm"]["beam_count"] = 3
        timing, result = evaluate_rhythm(observation, anchors, reference)
        self.assertEqual(result["durations_correct"], 9)
        self.assertEqual(result["onsets_correct"], 10)
        self.assertEqual(result["valid_timelines"], 0)
        self.assertEqual(timing["measures"][0]["total_duration"], "31/32")
        self.assertFalse(result["includes_fret_or_technique_accuracy"])
        self.assertNotIn("notes", timing["measures"][0]["events"][0])

    def test_unknown_marks_stop_future_onsets_without_guessing_duration(self):
        observation, anchors, reference = reference_rhythm(4)
        observation["measures"][0]["columns"][0]["rhythm"]["beam_count"] = None
        timing, result = evaluate_rhythm(observation, anchors, reference)
        events = timing["measures"][0]["events"]
        self.assertIsNone(events[0]["duration"])
        self.assertIsNone(events[1]["onset"])
        self.assertEqual(events[1]["duration"], "1/8")
        self.assertEqual(result["durations_correct"], 9)
        self.assertEqual(result["onsets_correct"], 1)
        self.assertEqual(result["unknown_durations"], 1)

    def test_unknown_dots_do_not_hide_correct_beam_observations(self):
        observation, anchors, reference = reference_rhythm(4)
        for column in observation["measures"][0]["columns"]:
            column["rhythm"]["dot_count"] = None
        _, result = evaluate_rhythm(observation, anchors, reference)
        self.assertEqual(result["beam_counts_correct"], 10)
        self.assertEqual(result["marks_correct"], 0)
        self.assertEqual(result["durations_correct"], 0)

    def test_deleted_columns_and_unrelated_measures_fail_before_timing(self):
        observation, anchors, reference = reference_rhythm(1)
        observation["measures"][0]["columns"].pop()
        with self.assertRaises(SymbolFormatError):
            evaluate_rhythm(observation, anchors, reference)
        observation, anchors, reference = reference_rhythm(1)
        observation["measures"][0]["number"] = 4
        with self.assertRaises(SymbolFormatError):
            evaluate_rhythm(observation, anchors, reference)

    def test_thick_beam_region_does_not_merge_two_long_stems(self):
        image = Image.new("RGB", (220, 220), "white")
        draw = ImageDraw.Draw(image)
        lines = [20, 40, 60, 80, 100, 120]
        for y in lines:
            draw.line((0, y, 219, y), fill="#aaaaaa", width=2)
        for x in [0, 219]:
            draw.line((x, 20, x, 122), fill="black", width=2)
        for x in [60, 150]:
            draw.line((x, 140, x, 180), fill="black", width=2)
        draw.rectangle((60, 161, 150, 180), fill="black")
        old = detect_columns(image, lines, (4,))
        strict = detect_columns(image, lines, (4,), stem_min_length_factor=1.4)
        self.assertEqual(len(old["measures"][0]["columns"]), 1)
        self.assertEqual([c["x"] for c in strict["measures"][0]["columns"]], [60.5, 150.5])
        self.assertFalse(strict["reference_used"])

    def test_real_regions_keep_pixels_and_detect_each_stem_in_dense_group(self):
        source_path = Path(__file__).resolve().parent.parent / "lullaby.jpg"
        with tempfile.TemporaryDirectory(prefix="tablab-rhythm-") as temporary:
            paths = prepare_rhythm_samples({"whole_page": source_path}, Path(temporary))
            for number in [1, 4]:
                anchors = json.loads(paths[f"rhythm_anchors_m{number}"].read_text(encoding="utf-8"))
                self.assertEqual(len(anchors["measures"][0]["columns"]), 10)
                self.assertFalse(anchors["reference_used"])
                with Image.open(paths[f"rhythm_row_m{number}"]) as row, \
                     Image.open(paths[f"rhythm_full_m{number}"]) as full, \
                     Image.open(paths[f"rhythm_cards_m{number}"]) as cards:
                    self.assertEqual(full.crop((20, 0, 20 + row.width, row.height)).tobytes(), row.tobytes())
                    for cell in anchors["card_geometry"]:
                        snippet = row.crop(cell["source_box"])
                        enlarged = snippet.resize((snippet.width * 3, snippet.height * 3), Image.Resampling.NEAREST)
                        x, y = cell["paste_xy"]
                        self.assertEqual(cards.crop((x, y, x + enlarged.width, y + enlarged.height)).tobytes(), enlarged.tobytes())

    def test_group_detection_uses_connecting_ink_without_guessing_beam_layers(self):
        row = Image.new("RGB", (310, 220), "white")
        draw = ImageDraw.Draw(row)
        for x in (40, 110, 180, 250):
            draw.line((x, 145, x, 195), fill="black", width=2)
        draw.rectangle((40, 185, 110, 190), fill="black")
        draw.rectangle((180, 176, 250, 188), fill="black")
        # A very dark internal separator fuses layers under the connectivity
        # threshold; it must not split the group or become a beam count.
        draw.line((180, 181, 250, 181), fill=(17, 17, 17))
        anchors = {"string_y": [20, 40, 60, 80, 100, 120], "stem_search_y": [140, 205],
            "measures": [{"number": 99, "left": 0, "right": 309,
                "columns": [{"index": i, "x": x} for i, x in enumerate((40, 110, 180, 250), 1)]}]}
        geometry = beam_group_geometry(row, anchors)
        self.assertEqual([group["columns"] for group in geometry["groups"]], [[1, 2], [3, 4]])
        self.assertEqual([c["joined"] for c in geometry["connections"]], [True, False, True])
        self.assertFalse(geometry["reference_used"])
        self.assertNotIn("beam_count", json.dumps(geometry))
        self.assertNotIn("duration", json.dumps(geometry["groups"]))
        canvas, geometry = render_beam_groups(row, anchors)
        for group in geometry["groups"]:
            snippet = row.crop(group["source_box"])
            enlarged = snippet.resize((snippet.width * 4, snippet.height * 4), Image.Resampling.NEAREST)
            x, y = group["paste_xy"]
            self.assertEqual(canvas.crop((x, y, x + enlarged.width, y + enlarged.height)).tobytes(), enlarged.tobytes())

    def test_real_group_crops_keep_all_columns_connections_and_original_grayscale(self):
        source_path = Path(__file__).resolve().parent.parent / "lullaby.jpg"
        with tempfile.TemporaryDirectory(prefix="tablab-groups-") as temporary:
            paths = prepare_rhythm_samples({"whole_page": source_path}, Path(temporary), include_groups=True)
            for number in (1, 4):
                anchors = json.loads(paths[f"rhythm_anchors_m{number}"].read_text(encoding="utf-8"))
                geometry = anchors["group_geometry"]
                groups = geometry["groups"]
                self.assertEqual([c for group in groups for c in group["columns"]], list(range(1, 11)))
                self.assertEqual([g["columns"] for g in groups],
                    [[1, 2], [3, 4], [5, 6], [7, 8, 9, 10]] if number == 1 else
                    [[1, 2], [3, 4, 5, 6], [7, 8], [9, 10]])
                self.assertFalse(geometry["reference_used"])
                with Image.open(paths[f"rhythm_row_m{number}"]) as row, \
                     Image.open(paths[f"rhythm_groups_m{number}"]) as cards:
                    for group in groups:
                        snippet = row.crop(group["source_box"])
                        self.assertTrue(any(0 < v < 255 for v in snippet.convert("L").getdata()))
                        enlarged = snippet.resize((snippet.width * 4, snippet.height * 4), Image.Resampling.NEAREST)
                        x, y = group["paste_xy"]
                        self.assertEqual(cards.crop((x, y, x + enlarged.width, y + enlarged.height)).tobytes(), enlarged.tobytes())

    def test_brightening_preserves_geometry_black_white_and_intensity_order(self):
        gradient = Image.new("L", (256, 1))
        gradient.putdata(range(256))
        bright = brighten_grayscale(gradient).convert("L")
        values = list(bright.getdata())
        self.assertEqual(bright.size, gradient.size)
        self.assertEqual(values[0], 0)
        self.assertEqual(values[-1], 255)
        self.assertEqual(values, sorted(values))
        self.assertGreater(values[17], 60)
        self.assertGreater(values[31], values[17])
        self.assertEqual(brighten_grayscale(gradient, gamma=1).convert("L").tobytes(), gradient.tobytes())
        for bad in (0, -1, 2, True, "0.4"):
            with self.assertRaises(ValueError):
                brighten_grayscale(gradient, gamma=bad)

    def test_grayscale_profiles_preserve_dark_separator_without_guessing_layers(self):
        row = Image.new("L", (12, 5), "white")
        for y, value in enumerate((255, 0, 17, 0, 255)):
            for x in range(12):
                row.putpixel((x, y), value)
        geometry = {"connections": [{"measure": 99, "between_columns": [1, 2], "source_box": [0, 0, 12, 5]}]}
        evidence = grayscale_evidence(row, geometry)
        self.assertFalse(evidence["reference_used"])
        self.assertEqual([r["median_gray"] for r in evidence["spans"][0]["profile"]], [255, 0, 17, 0, 255])
        self.assertNotIn("beam_count", json.dumps(evidence))

    def test_real_contrast_changes_only_intensity_in_original_group_crops(self):
        source_path = Path(__file__).resolve().parent.parent / "lullaby.jpg"
        with tempfile.TemporaryDirectory(prefix="tablab-contrast-") as temporary:
            paths = prepare_rhythm_samples({"whole_page": source_path}, Path(temporary), include_contrast=True)
            for number in (1, 4):
                anchors = json.loads(paths[f"rhythm_anchors_m{number}"].read_text(encoding="utf-8"))
                original, adjusted = anchors["group_geometry"], anchors["contrast_geometry"]
                self.assertEqual(original["connections"], adjusted["connections"])
                with Image.open(paths[f"rhythm_row_m{number}"]) as row, \
                     Image.open(paths[f"rhythm_groups_m{number}"]) as raw, \
                     Image.open(paths[f"rhythm_contrast_m{number}"]) as bright:
                    self.assertEqual(raw.size, bright.size)
                    for a, b in zip(original["groups"], adjusted["groups"]):
                        for field in ("columns", "source_box", "paste_xy", "scale"):
                            self.assertEqual(a[field], b[field])
                        snippet = brighten_grayscale(row.crop(b["source_box"]))
                        enlarged = snippet.resize((snippet.width * 4, snippet.height * 4), Image.Resampling.NEAREST)
                        x, y = b["paste_xy"]
                        self.assertEqual(bright.crop((x, y, x + enlarged.width, y + enlarged.height)).tobytes(), enlarged.tobytes())
                evidence = json.loads(paths[f"rhythm_gray_evidence_m{number}"].read_text(encoding="utf-8"))
                self.assertFalse(evidence["reference_used"])
                self.assertEqual(len(evidence["spans"]), 9)


if __name__ == "__main__":
    unittest.main()
