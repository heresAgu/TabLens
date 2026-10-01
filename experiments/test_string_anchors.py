import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from string_anchors import AnchorError, detect_string_lines, prepare_anchor_samples


class StringAnchorTests(unittest.TestCase):
    def source(self, count=6, extra=False):
        image = Image.new("RGB", (300, 160), "white")
        draw = ImageDraw.Draw(image)
        for index in range(count):
            draw.line((5, 20 + 20 * index, 295, 20 + 20 * index), fill="#aaaaaa", width=2)
        # Foreground and a short rhythm beam must not become additional string lines.
        draw.rectangle((70, 33, 85, 47), fill="black")
        draw.line((140, 147, 190, 147), fill="black", width=3)
        if extra:
            draw.line((5, 150, 295, 150), fill="black")
        return image

    def test_detects_gray_lines_and_ignores_short_beams(self):
        self.assertEqual(detect_string_lines(self.source()), [20.5, 40.5, 60.5, 80.5, 100.5, 120.5])

    def test_missing_or_extra_long_line_stops_instead_of_guessing(self):
        for image in [self.source(count=5), self.source(extra=True)]:
            with self.subTest(size=image.size), self.assertRaises(AnchorError):
                detect_string_lines(image)

    def test_irregular_spacing_is_rejected(self):
        image = Image.new("RGB", (300, 170), "white")
        draw = ImageDraw.Draw(image)
        for y in [20, 40, 60, 80, 100, 150]:
            draw.line((5, y, 295, y), fill="black")
        with self.assertRaises(AnchorError):
            detect_string_lines(image)

    def test_unique_six_line_staff_can_be_selected_above_long_beams(self):
        image = self.source(extra=True)
        self.assertEqual(detect_string_lines(image, allow_extra_lines=True),
                         [20.5, 40.5, 60.5, 80.5, 100.5, 120.5])

    def test_two_equally_spaced_staff_candidates_are_rejected(self):
        image = Image.new("RGB", (300, 180), "white")
        draw = ImageDraw.Draw(image)
        for y in range(20, 141, 20):
            draw.line((5, y, 295, y), fill="black")
        with self.assertRaises(AnchorError):
            detect_string_lines(image, allow_extra_lines=True)

    def test_labels_and_panels_preserve_original_pixels_and_report_coordinates(self):
        with tempfile.TemporaryDirectory(prefix="tablab-anchors-") as directory:
            source = self.source()
            source_path = Path(directory) / "row.png"
            source.save(source_path)
            paths = prepare_anchor_samples(source_path, Path(directory) / "samples")
            metadata = json.loads(paths["anchors_metadata"].read_text(encoding="utf-8"))
            self.assertFalse(metadata["reference_used"])
            with Image.open(paths["anchored_row"]) as labelled:
                self.assertEqual(labelled.crop(metadata["labelled_source_box"]).tobytes(), source.tobytes())
            with Image.open(paths["separated_strings"]) as panels:
                for panel in metadata["panels"]:
                    snippet = source.crop(panel["source_box"])
                    x, y = panel["paste_xy"]
                    self.assertEqual(panels.crop((x, y, x + snippet.width, y + snippet.height)).tobytes(), snippet.tobytes())


if __name__ == "__main__":
    unittest.main()
