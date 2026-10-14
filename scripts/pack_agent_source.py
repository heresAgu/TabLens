"""Attach source images and one source rectangle per measure to an Agent v1 draft.

The Agent supplies a music-only draft and a manifest of image files/crop boxes.
This script reads the pixels and writes one self-contained tablens.agent.v2 JSON.
"""

import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

from PIL import Image, ImageOps


MAX_IMAGE_DATA_CHARS = 40_000_000


def read_page(path):
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened)
        width, height = image.size
        if width < 1 or height < 1 or width > 20000 or height > 20000:
            raise ValueError('原图尺寸必须在 1–20000 像素内')
        if image.mode not in ('RGB', 'RGBA'):
            image = image.convert('RGBA' if 'A' in image.getbands() else 'RGB')
        output = BytesIO()
        image.save(output, format='WEBP', lossless=True, method=6)
    return width, height, 'data:image/webp;base64,' + base64.b64encode(output.getvalue()).decode('ascii')


def pack(draft, manifest, manifest_dir):
    if draft.get('format') != 'tablens.agent.v1':
        raise ValueError('输入乐谱必须是 tablens.agent.v1 草稿')
    pages = manifest.get('pages')
    regions = manifest.get('measures')
    if not isinstance(pages, list) or not pages or not isinstance(regions, list):
        raise ValueError('区域清单需要 pages 和 measures')
    result = json.loads(json.dumps(draft, ensure_ascii=False))
    result['format'] = 'tablens.agent.v2'
    result['sources'] = []
    sizes = {}
    total = 0
    for page in pages:
        if not isinstance(page, dict) or set(page) != {'id', 'file'}:
            raise ValueError('每张原图须填写 id 和 file')
        identifier = page['id']
        if not isinstance(identifier, str) or not identifier or identifier in sizes or len(identifier) > 80:
            raise ValueError('原图 id 无效或重复')
        if not isinstance(page['file'], str) or not page['file']:
            raise ValueError('原图 file 须为图片文件路径')
        image_path = (manifest_dir / page['file']).resolve()
        if not image_path.is_file():
            raise ValueError(f'找不到原图：{page["file"]}')
        width, height, data_url = read_page(image_path)
        total += len(data_url)
        if total > MAX_IMAGE_DATA_CHARS:
            raise ValueError('原图累计超过40MB，请先缩小图片再打包')
        sizes[identifier] = (width, height)
        result['sources'].append({'id': identifier, 'name': image_path.name,
                                  'width': width, 'height': height, 'dataUrl': data_url})
    by_number = {}
    for region in regions:
        if not isinstance(region, dict) or set(region) != {'number', 'pageId', 'box'}:
            raise ValueError('每个小节的区域须填写 number、pageId 和 box')
        number, page_id, box = region['number'], region['pageId'], region['box']
        if type(number) is not int or number < 1:
            raise ValueError('小节 number 须为正整数')
        if number in by_number:
            raise ValueError(f'第 {number} 小节的区域重复')
        if page_id not in sizes:
            raise ValueError(f'第 {number} 小节引用的原图不存在')
        width, height = sizes[page_id]
        if not isinstance(box, list) or len(box) != 4 or any(type(v) is not int for v in box) or not (
            0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height
        ):
            raise ValueError(f'第 {number} 小节的裁切范围无效；请按原图像素坐标填写')
        by_number[number] = {'pageId': page_id, 'box': box}
    expected = {measure.get('number') for measure in result.get('measures', [])}
    if set(by_number) != expected or len(result.get('measures', [])) != len(by_number):
        raise ValueError('区域清单必须为乐谱中的每个小节各写一条')
    for measure in result['measures']:
        measure['source'] = by_number[measure['number']]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('draft', type=Path, help='音乐结构草稿，tablens.agent.v1 JSON')
    parser.add_argument('manifest', type=Path, help='原图文件和每小节裁切框清单 JSON')
    parser.add_argument('output', type=Path, help='输出的自包含 tablens.agent.v2 JSON')
    args = parser.parse_args()
    draft = json.loads(args.draft.read_text(encoding='utf-8'))
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    result = pack(draft, manifest, args.manifest.resolve().parent)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'已生成 {args.output}：{len(result["sources"])} 张原图、{len(result["measures"])} 个小节')


if __name__ == '__main__':
    main()
