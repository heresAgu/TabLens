"""Image-only line anchors for this controlled, clean TAB row experiment."""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


class AnchorError(ValueError):
    pass


def detect_string_lines(image, allow_extra_lines=False):
    """Require six long, nearly equally spaced horizontal line groups; fail closed."""
    gray = image.convert("L")
    pixels = gray.load()
    candidates = [y for y in range(gray.height)
                  if sum(pixels[x, y] < 200 for x in range(gray.width)) >= gray.width * 0.62]
    groups = []
    for y in candidates:
        if not groups or y != groups[-1][-1] + 1:
            groups.append([y])
        else:
            groups[-1].append(y)
    if allow_extra_lines and len(groups) > 6:
        choices = []
        for start in range(len(groups) - 5):
            window = [sum(group) / len(group) for group in groups[start:start + 6]]
            gaps = [b - a for a, b in zip(window, window[1:])]
            mean = sum(gaps) / 5
            if mean >= 8 and all(abs(gap - mean) <= mean * 0.2 for gap in gaps):
                choices.append(groups[start:start + 6])
        if len(choices) != 1:
            raise AnchorError("长横线中无法唯一定位六根等距弦线，停止生成辅助图。")
        groups = choices[0]
    if len(groups) != 6:
        raise AnchorError("本轮裁剪未检测到恰好六根长横线，停止生成定位辅助图。")
    centers = [sum(group) / len(group) for group in groups]
    gaps = [b - a for a, b in zip(centers, centers[1:])]
    mean_gap = sum(gaps) / len(gaps)
    if mean_gap < 8 or any(abs(gap - mean_gap) > mean_gap * 0.2 for gap in gaps):
        raise AnchorError("六条横线的间距不符合本轮规整谱行条件。")
    return centers


def _font(size):
    try:
        return ImageFont.truetype("C:/Windows/Fonts/consola.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def prepare_anchor_samples(row_path, output_dir, allow_extra_lines=False, string_y=None):
    """Preserve pixels; add labels only in new margins and show each line separately.

    No reference score, OCR results, fret positions or expected counts are read.
    Separation keeps a little adjacent context so a numeral is not cut at a
    midpoint; edge fragments are explicitly excluded by the reading prompt.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = {"anchored_row": output_dir / "lullaby_string_labels.png",
             "separated_strings": output_dir / "lullaby_string_panels.png",
             "anchors_metadata": output_dir / "lullaby_string_anchors.json"}
    with Image.open(row_path) as source:
        source = source.convert("RGB")
        # A page parser may already have measured the six lines. Reuse those
        # pixel coordinates instead of confusing long beams with new strings.
        centers = list(string_y) if string_y is not None else detect_string_lines(source, allow_extra_lines=allow_extra_lines)
        if len(centers) != 6 or any(not isinstance(y, (int, float)) or not 0 <= y < source.height for y in centers):
            raise AnchorError('需要六条有效的弦线像素坐标')
        if any(b <= a for a, b in zip(centers, centers[1:])):
            raise AnchorError('弦线坐标需从上到下排列')
        margin = 96
        annotated = Image.new("RGB", (source.width + 2 * margin, source.height), "white")
        annotated.paste(source, (margin, 0))
        draw = ImageDraw.Draw(annotated)
        for string, center in enumerate(centers, 1):
            for x, end in [(8, margin - 1), (margin + source.width + 8, annotated.width - 1)]:
                draw.text((x, center), f"S{string}", fill="#164c9b", font=_font(18), anchor="lm")
                draw.line((x + 39, center, end, center), fill="#164c9b", width=1)
        annotated.save(paths["anchored_row"])

        gap = (centers[-1] - centers[0]) / 5
        half_height = round(gap * 0.85)
        card_height = max(90, 2 * half_height + 45)
        panels = Image.new("RGB", (source.width + 2 * margin, 6 * card_height), "white")
        draw = ImageDraw.Draw(panels)
        source_boxes = []
        for index, center in enumerate(centers):
            top, bottom = round(center) - half_height, round(center) + half_height + 1
            if top < 0 or bottom > source.height:
                raise AnchorError("弦线太靠近图片边缘，无法完整保留当前弦的字符。")
            snippet = source.crop((0, top, source.width, bottom))
            paste_y = index * card_height + (card_height - snippet.height) // 2
            panels.paste(snippet, (margin, paste_y))
            target_y = paste_y + center - top
            draw.text((8, target_y), f"S{index + 1}", fill="#164c9b", font=_font(24), anchor="lm")
            draw.line((55, target_y, margin - 1, target_y), fill="#164c9b", width=2)
            draw.text((margin + source.width + 8, target_y), f"S{index + 1}",
                      fill="#164c9b", font=_font(24), anchor="lm")
            source_boxes.append({"string": index + 1, "source_box": [0, top, source.width, bottom],
                                 "paste_xy": [margin, paste_y], "target_y": target_y})
        panels.save(paths["separated_strings"])
        metadata = {"source_size": list(source.size), "string_y": centers,
                    "labelled_source_box": [margin, 0, margin + source.width, source.height],
                    "panels": source_boxes, "reference_used": False,
                    "scope": "clean horizontal six-line row; not a general page detector"}
        paths["anchors_metadata"].write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return paths


def load_anchor_prompts(samples):
    prompt_dir = Path(__file__).resolve().parent / "prompts"
    metadata = json.loads(samples["anchors_metadata"].read_text(encoding="utf-8"))
    anchors = "；".join(f"S{index + 1}: y={center:g}" for index, center in enumerate(metadata["string_y"]))
    coordinates = (prompt_dir / "strings_coordinates_user.txt").read_text(encoding="utf-8").replace("{{STRING_Y}}", anchors)
    panels = (prompt_dir / "strings_panels_user.txt").read_text(encoding="utf-8")
    return coordinates, panels
