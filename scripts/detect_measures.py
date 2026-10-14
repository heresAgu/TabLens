"""TabLens Measure Detector and Manifest Generator

Automatically detects guitar tab systems (staff lines) and measure bar lines
from score page images, calculates per-measure bounding boxes, and generates
manifest.json for tablens.agent.v2 packaging.

Usage:
  python scripts/detect_measures.py --input <image_or_dir> [--output-manifest manifest.json] [--crop-dir <dir>]
"""

import argparse
import json
from pathlib import Path
import sys
from typing import Dict, List, Tuple
import numpy as np
from PIL import Image, ImageOps

if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass


def find_staff_systems(img_gray: np.ndarray) -> List[Tuple[int, int]]:
    """Locate vertical ranges (y_start, y_end) of guitar tab staves (6 lines)."""
    h, w = img_gray.shape
    # Profile center 60% of page horizontally to find staff lines
    center_x0, center_x1 = int(w * 0.2), int(w * 0.8)
    row_means = np.mean(img_gray[:, center_x0:center_x1], axis=1)

    # Find dark valleys (local minima < 160)
    valleys = []
    for y in range(15, h - 15):
        if row_means[y] < 160 and row_means[y] <= row_means[y - 1] and row_means[y] <= row_means[y + 1]:
            valleys.append(y)

    # Deduplicate closely adjacent valleys (within 5px)
    merged = []
    for v in valleys:
        if not merged or v - merged[-1] > 5:
            merged.append(v)

    # Search for groups of 6 lines with spacing roughly 10-18 pixels
    systems = []
    i = 0
    while i <= len(merged) - 6:
        sub = merged[i:i + 6]
        diffs = [sub[j + 1] - sub[j] for j in range(5)]
        mean_diff = np.mean(diffs)
        # Check if roughly equidistant (spacing variance small)
        if 9 <= mean_diff <= 22 and max(diffs) - min(diffs) <= 6:
            systems.append((sub[0], sub[-1]))
            i += 6  # jump past this staff
        else:
            i += 1

    return systems


def find_system_bar_lines(img_gray: np.ndarray, y_top: int, y_bot: int) -> List[int]:
    """Find vertical bar line x positions for a detected staff system."""
    h, w = img_gray.shape
    staff_h = y_bot - y_top
    if staff_h <= 0:
        return []

    # Score each column x across the width
    # Bar lines are dark inside y_top..y_bot, but relatively light above and below
    bar_candidates = []
    for x in range(20, w - 20):
        in_staff_frac = np.mean(img_gray[y_top:y_bot + 1, x] < 140)
        # Above staff (10px above y_top)
        above_y0 = max(0, y_top - 14)
        above_y1 = max(0, y_top - 2)
        above_frac = np.mean(img_gray[above_y0:above_y1, x] < 140) if above_y1 > above_y0 else 0
        # Below staff (10px below y_bot)
        below_y0 = min(h - 1, y_bot + 2)
        below_y1 = min(h, y_bot + 14)
        below_frac = np.mean(img_gray[below_y0:below_y1, x] < 140) if below_y1 > below_y0 else 0

        # Bar line criteria: high in-staff darkness, low above/below
        if in_staff_frac > 0.8 and above_frac < 0.35 and below_frac < 0.35:
            bar_candidates.append(x)

    # Cluster adjacent column candidates
    bars = []
    grp = []
    for c in bar_candidates:
        if not grp or c == grp[-1] + 1:
            grp.append(c)
        else:
            bars.append(int(np.mean(grp)))
            grp = [c]
    if grp:
        bars.append(int(np.mean(grp)))

    # Ensure left and right margins of the system are included if not present
    # Left margin usually around x=30..60, right around w-60..w-30
    if not bars or bars[0] > 100:
        bars.insert(0, 40)
    if bars[-1] < w - 120:
        bars.append(w - 40)

    # Merge adjacent double bar lines (e.g. repeat lines or final double bar within 18px)
    merged_bars = []
    for b in bars:
        if not merged_bars or b - merged_bars[-1] > 18:
            merged_bars.append(b)
        else:
            merged_bars[-1] = (merged_bars[-1] + b) // 2
    bars = merged_bars

    # Filter out initial clef/time-sig margins if width < 90
    if len(bars) >= 2 and bars[1] - bars[0] < 90:
        bars = bars[1:]

    return bars


def analyze_page(image_path: Path, start_measure: int = 1) -> Tuple[List[dict], int, Image.Image]:
    """Analyze one page image and return list of measure box dicts and next measure index."""
    pil_img = Image.open(image_path)
    pil_img = ImageOps.exif_transpose(pil_img)
    w, h = pil_img.size
    gray = np.array(pil_img.convert('L'))

    systems = find_staff_systems(gray)
    print(f"[{image_path.name}] Found {len(systems)} systems (Staff lines at y: {systems})")

    measure_boxes = []
    current_m = start_measure

    for idx, (y_top, y_bot) in enumerate(systems):
        # Calculate system vertical boundaries with headroom (for chords) and footroom (for lyrics)
        # Headroom: roughly halfway to previous staff or ~120px
        if idx == 0:
            sys_y0 = max(0, y_top - 120)
        else:
            prev_y_bot = systems[idx - 1][1]
            sys_y0 = max(0, (prev_y_bot + y_top) // 2)

        # Footroom: roughly halfway to next staff or ~100px
        if idx == len(systems) - 1:
            sys_y1 = min(h, y_bot + 120)
        else:
            next_y_top = systems[idx + 1][0]
            sys_y1 = min(h, (y_bot + next_y_top) // 2)

        bars = find_system_bar_lines(gray, y_top, y_bot)
        print(f"   System {idx + 1} (y: {sys_y0}..{sys_y1}): detected bars at x = {bars}")

        # Each pair of adjacent bar lines defines a measure
        for b_idx in range(len(bars) - 1):
            x0 = max(0, bars[b_idx] - 4)
            x1 = min(w, bars[b_idx + 1] + 4)
            measure_boxes.append({
                "number": current_m,
                "box": [x0, sys_y0, x1, sys_y1]
            })
            current_m += 1

    return measure_boxes, current_m, pil_img


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', '-i', type=Path, required=True, help='Score page image or directory of images')
    parser.add_argument('--output-manifest', '-o', type=Path, help='Output manifest JSON path')
    parser.add_argument('--crop-dir', '-c', type=Path, help='Optional directory to save cropped measure images')
    args = parser.parse_args()

    input_path = args.input.resolve()
    if input_path.is_dir():
        image_files = sorted(
            [f for f in input_path.iterdir() if f.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')],
            key=lambda p: (len(p.stem), p.stem)
        )
    else:
        image_files = [input_path]

    if not image_files:
        raise ValueError(f"No image files found at {input_path}")

    manifest_pages = []
    manifest_measures = []
    measure_counter = 1

    if args.crop_dir:
        args.crop_dir.mkdir(parents=True, exist_ok=True)

    for p_idx, img_path in enumerate(image_files, 1):
        page_id = f"page-{p_idx}"
        manifest_pages.append({
            "id": page_id,
            "file": str(img_path)
        })
        m_boxes, measure_counter, pil_img = analyze_page(img_path, start_measure=measure_counter)
        for mb in m_boxes:
            mb["pageId"] = page_id
            manifest_measures.append(mb)

            if args.crop_dir:
                box = mb["box"]
                cropped = pil_img.crop((box[0], box[1], box[2], box[3]))
                crop_path = args.crop_dir / f"m{mb['number']:02d}.png"
                cropped.save(crop_path)

    manifest_data = {
        "pages": manifest_pages,
        "measures": manifest_measures
    }

    if args.output_manifest:
        args.output_manifest.write_text(json.dumps(manifest_data, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"\n[OK] Manifest saved to: {args.output_manifest} ({len(manifest_pages)} pages, {len(manifest_measures)} measures)")
    else:
        print(f"\n[OK] Detection completed: {len(manifest_pages)} pages, {len(manifest_measures)} measures.")


if __name__ == '__main__':
    main()
