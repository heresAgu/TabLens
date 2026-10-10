"""In-memory PDF sessions; pages are rasterized only when selected for TAB recognition."""
import base64
import io
import math
import threading
import uuid
from collections import OrderedDict

import pypdfium2 as pdfium
from PIL import Image

MAX_PDF_BYTES = 20_000_000
MAX_PAGES = 100
MAX_IMAGE_BYTES = 20_000_000
MAX_PIXELS = 18_000_000


class PDFImporter:
    def __init__(self):
        self.lock = threading.RLock()  # PDFium calls must not overlap across requests.
        self.sessions = OrderedDict()

    def open(self, value):
        raw = value.get('pdfDataUrl')
        if not isinstance(raw, str) or not raw.startswith('data:application/pdf;base64,') or len(raw) > 27_000_000:
            raise ValueError('请选择不超过20MB的PDF文件')
        try:
            data = base64.b64decode(raw.split(',', 1)[1], validate=True)
        except (ValueError, base64.binascii.Error):
            raise ValueError('PDF文件内容无效') from None
        if not data.startswith(b'%PDF-') or len(data) > MAX_PDF_BYTES:
            raise ValueError('请选择有效且不超过20MB的PDF文件')
        with self.lock:
            try:
                document = pdfium.PdfDocument(data)
                count = len(document)
                document.close()
            except pdfium.PdfiumError:
                raise ValueError('PDF无法打开；请确认文件完整且未加密') from None
            if not 1 <= count <= MAX_PAGES:
                raise ValueError('PDF页数需在1–100页之间')
            identifier = uuid.uuid4().hex
            self.sessions[identifier] = data
            while len(self.sessions) > 3:
                self.sessions.popitem(last=False)
        return {'id': identifier, 'pageCount': count}

    def render(self, value):
        identifier, number = value.get('id'), value.get('pageNumber')
        if not isinstance(identifier, str) or type(number) is not int:
            raise ValueError('请选择PDF页码')
        with self.lock:
            data = self.sessions.get(identifier)
            if data is None:
                raise ValueError('PDF会话已失效，请重新选择文件')
            self.sessions.move_to_end(identifier)
            document = None
            try:
                document = pdfium.PdfDocument(data)
                if not 1 <= number <= len(document):
                    raise ValueError('PDF页码超出范围')
                page = document[number - 1]
                width, height = page.get_size()
                if min(width, height) < 20 or max(width, height) > 20_000:
                    raise ValueError('PDF页面尺寸不适合识别')
                scale = min(3.0, math.sqrt(MAX_PIXELS / (width * height)))
                bitmap = page.render(scale=scale)
                image = bitmap.to_pil().convert('RGB')
                if image.width * image.height > 24_000_000:
                    raise ValueError('PDF页面过大，无法识别')
                output = io.BytesIO()
                image.save(output, format='PNG', optimize=True)
                blob, mime = output.getvalue(), 'image/png'
                if len(blob) > MAX_IMAGE_BYTES:
                    output = io.BytesIO()
                    image.save(output, format='JPEG', quality=92, optimize=True)
                    blob, mime = output.getvalue(), 'image/jpeg'
                if len(blob) > MAX_IMAGE_BYTES:
                    raise ValueError('这一页渲染后超过20MB，请缩小页面或另存为图片')
                return {'pageNumber': number, 'width': image.width, 'height': image.height,
                        'dataUrl': f'data:{mime};base64,{base64.b64encode(blob).decode("ascii")}' }
            except pdfium.PdfiumError:
                raise ValueError('PDF页面无法渲染') from None
            finally:
                if document is not None:
                    document.close()
