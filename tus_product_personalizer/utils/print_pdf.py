# -*- coding: utf-8 -*-
"""Multi-page PDF merge helper for Print-Ready downloads.

Exact-size page generation lives in ``print_vector.build_exact_size_print_pdf``.
This module only concatenates per-side PDFs (front + back, etc.).
"""

import io
import logging

_logger = logging.getLogger(__name__)


def merge_pdf_bytes_list(pdf_bytes_list):
    """Merge a list of PDF byte strings into one multi-page PDF.

    Returns the first page alone if merge is unnecessary or PyPDF2 fails.
    """
    pages = [p for p in (pdf_bytes_list or []) if p]
    if not pages:
        return None
    if len(pages) == 1:
        return pages[0]

    try:
        import PyPDF2

        writer = PyPDF2.PdfFileWriter()
        for pdf_bytes in pages:
            reader = PyPDF2.PdfFileReader(io.BytesIO(pdf_bytes))
            for page_idx in range(len(reader.pages)):
                writer.addPage(reader.getPage(page_idx))
        buf = io.BytesIO()
        writer.write(buf)
        return buf.getvalue()
    except Exception as exc:
        _logger.warning("PyPDF2 PDF merge failed: %s", exc)
        return pages[0]
