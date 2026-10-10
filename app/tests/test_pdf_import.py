import base64
import io
import sys
import unittest
from pathlib import Path
from PIL import Image
import pypdfium2 as pdfium

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pdf_import import PDFImporter


class PDFImportTests(unittest.TestCase):
    def setUp(self):
        document = pdfium.PdfDocument.new()
        document.new_page(300, 400)
        document.new_page(320, 450)
        output = io.BytesIO()
        document.save(output)
        document.close()
        self.data_url = 'data:application/pdf;base64,' + base64.b64encode(output.getvalue()).decode()
        self.importer = PDFImporter()

    def test_open_and_render_selected_page(self):
        session = self.importer.open({'pdfDataUrl': self.data_url})
        self.assertEqual(session['pageCount'], 2)
        page = self.importer.render({'id': session['id'], 'pageNumber': 2})
        self.assertEqual(page['pageNumber'], 2)
        self.assertEqual((page['width'], page['height']), (960, 1350))
        self.assertTrue(page['dataUrl'].startswith('data:image/png;base64,'))
        image = Image.open(io.BytesIO(base64.b64decode(page['dataUrl'].split(',', 1)[1])))
        self.assertEqual(image.size, (960, 1350))

    def test_rejects_invalid_pdf_and_page(self):
        with self.assertRaisesRegex(ValueError, 'PDF'):
            self.importer.open({'pdfDataUrl': 'data:application/pdf;base64,' + base64.b64encode(b'not pdf').decode()})
        session = self.importer.open({'pdfDataUrl': self.data_url})
        with self.assertRaisesRegex(ValueError, '页码'):
            self.importer.render({'id': session['id'], 'pageNumber': 3})


if __name__ == '__main__':
    unittest.main()
