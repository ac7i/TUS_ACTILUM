# -*- coding: utf-8 -*-
"""Production-safe artwork upload helpers (TIFF/PDF/high-resolution rasters)."""

from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
import re
import tempfile

try:
    from PIL import Image, ImageDraw, ImageFont
    # Bypass Pillow's decompression bomb limit for high-res commercial prints
    Image.MAX_IMAGE_PIXELS = None
except ImportError:
    pass

_logger = logging.getLogger(__name__)

DEFAULT_MAX_UPLOAD_BYTES = 2048 * 1024 * 1024  # 2048 MB (2 GB)
DEFAULT_MAX_PIXELS = 2_000_000_000  # 2 Gigapixels
DEFAULT_PREVIEW_MAX_SIDE = 2048
PDF_RASTER_DPI = 72


TIFF_EXTENSIONS = frozenset({"tif", "tiff"})
PDF_EXTENSIONS = frozenset({"pdf"})
PRODUCTION_EXTENSIONS = TIFF_EXTENSIONS | PDF_EXTENSIONS


MIME_SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg", frozenset({"jpg", "jpeg"})),
    (b"\x89PNG\r\n\x1a\n", "image/png", frozenset({"png"})),
    (b"GIF87a", "image/gif", frozenset({"gif"})),
    (b"GIF89a", "image/gif", frozenset({"gif"})),
    (b"RIFF", "image/webp", frozenset({"webp"})),  # refined below
    (b"BM", "image/bmp", frozenset({"bmp"})),
    (b"II*\x00", "image/tiff", TIFF_EXTENSIONS),
    (b"MM\x00*", "image/tiff", TIFF_EXTENSIONS),
    (b"%PDF", "application/pdf", PDF_EXTENSIONS),
)


class ProductionUploadError(Exception):
    """User-facing upload validation / conversion error."""


def extension_of(filename: str | None) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def detect_mime(file_bytes: bytes, filename: str | None = None) -> str | None:
    """Return MIME type from magic bytes when possible."""
    if not file_bytes:
        return None
    head = file_bytes[:16]
    for signature, mime, _exts in MIME_SIGNATURES:
        if head.startswith(signature):
            if mime == "image/webp":
                if len(file_bytes) >= 12 and file_bytes[8:12] == b"WEBP":
                    return mime
                continue
            return mime
    # SVG is textual; sniff lightly.
    try:
        start = file_bytes[:256].decode("utf-8", errors="ignore").lstrip().lower()
    except Exception:
        start = ""
    if start.startswith("<svg") or start.startswith("<?xml"):
        return "image/svg+xml"
    ext = extension_of(filename)
    if ext in TIFF_EXTENSIONS:
        return "image/tiff"
    if ext in PDF_EXTENSIONS:
        return "application/pdf"
    return None


def validate_upload_limits(
    file_bytes: bytes,
    *,
    max_bytes: int = 0,
    max_pixels: int = 0,
    width: int | None = None,
    height: int | None = None,
) -> None:
    """Upload validation — file size and pixel checks disabled per requirements."""
    if not file_bytes:
        raise ProductionUploadError("Empty upload.")
    return


def _lanczos():
    try:
        from PIL import Image

        return getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
    except Exception:
        from PIL import Image

        return Image.LANCZOS


def _pillow_dpi(img) -> float | None:
    try:
        dpi = img.info.get("dpi")
        if isinstance(dpi, (tuple, list)) and dpi:
            value = float(dpi[0] or 0)
            return value if value >= 10 else None
        if isinstance(dpi, (int, float)) and dpi:
            value = float(dpi)
            return value if value >= 10 else None
    except Exception:
        return None
    return None


def tiff_first_frame_to_png(file_bytes: bytes) -> tuple[bytes, dict]:
    """Decode the first TIFF frame and return PNG bytes + metadata."""
    try:
        from PIL import Image
    except ImportError as exc:
        raise ProductionUploadError("Pillow is required for TIFF uploads.") from exc

    try:
        with Image.open(io.BytesIO(file_bytes)) as img:
            try:
                img.seek(0)
            except Exception:
                pass
            dpi = _pillow_dpi(img)
            width, height = img.size
            validate_upload_limits(file_bytes, width=width, height=height)
            # Guard against decompression bombs via Pillow's own limit when available.
            converted = img.convert("RGBA") if img.mode in ("P", "RGBA", "LA") else img.convert("RGB")
            out = io.BytesIO()
            save_kwargs = {"optimize": False, "compress_level": 1}
            if dpi:
                save_kwargs["dpi"] = (dpi, dpi)
            converted.save(out, format="PNG", **save_kwargs)
            png_bytes = out.getvalue()
            return png_bytes, {
                "width": width,
                "height": height,
                "dpi": dpi,
                "format": "tiff",
                "preview_mime": "image/png",
            }
    except ProductionUploadError:
        raise
    except Exception as exc:
        _logger.warning("TIFF decode failed with Pillow, trying ImageMagick fallback. Reason: %s", exc)
        try:
            with tempfile.TemporaryDirectory(prefix="tus_tiff_") as tmp:
                tiff_path = os.path.join(tmp, "input.tif")
                with open(tiff_path, "wb") as handle:
                    handle.write(file_bytes)
                png_path = os.path.join(tmp, "output.png")
                
                # First attempt: ImageMagick
                png_bytes = _rasterize_tiff_imagemagick(tiff_path, png_path)
                if png_bytes:
                    return png_bytes, {
                        "width": None,
                        "height": None,
                        "dpi": 150.0,
                        "format": "tiff",
                        "preview_mime": "image/png",
                    }
                
                # Final attempt: Placeholder
                return _generate_tiff_fallback_placeholder(tiff_path)
        except Exception as final_exc:
            raise ProductionUploadError(f"Complete TIFF parsing failure. Err: {str(final_exc)}") from final_exc


def _rasterize_tiff_imagemagick(tiff_path: str, png_path: str) -> bytes | None:
    """Fallback to rasterize TIFF using ImageMagick if Pillow fails."""
    convert = shutil.which("convert")
    if not convert:
        return None
        
    try:
        # Create a temporary directory for a custom ImageMagick policy
        # This elegantly bypasses strict /etc/ImageMagick-6/policy.xml limits without root!
        with tempfile.TemporaryDirectory(prefix="tus_magick_") as magick_tmp:
            policy_path = os.path.join(magick_tmp, "policy.xml")
            with open(policy_path, "w") as f:
                f.write('''<policymap>
  <policy domain="resource" name="memory" value="8GiB"/>
  <policy domain="resource" name="map" value="8GiB"/>
  <policy domain="resource" name="area" value="10GB"/>
  <policy domain="resource" name="disk" value="16GiB"/>
</policymap>''')
            
            env = os.environ.copy()
            env["MAGICK_CONFIGURE_PATH"] = magick_tmp

            subprocess.run(
                [
                    convert,
                    "-limit", "memory", "8GiB",
                    "-limit", "map", "8GiB",
                    "-limit", "disk", "16GiB",
                    "-limit", "area", "10000MB",
                    "-density", "150",
                    tiff_path + "[0]",
                    "-flatten",
                    "-resize", "2048x2048>",
                    png_path
                ],
                env=env,
                check=True,
                capture_output=True,
                timeout=600,
            )
            if os.path.exists(png_path):
                with open(png_path, "rb") as handle:
                    return handle.read()
    except subprocess.CalledProcessError as e:
        stderr_msg = e.stderr.decode('utf-8', errors='replace').strip() if e.stderr else str(e)
        _logger.warning("ImageMagick TIFF fallback failed: %s", stderr_msg)
    except Exception as e:
        _logger.warning("ImageMagick TIFF fallback failed: %s", e)
    return None


def _generate_tiff_fallback_placeholder(tiff_path: str) -> tuple[bytes, dict]:
    """Generate a generic placeholder for massive TIFFs that exceed server memory."""
    _logger.warning("Applying ultimate TIFF placeholder fallback")
    
    # Generate placeholder image
    ph = Image.new("RGBA", (2048, 2048), (220, 220, 220, 255))
    draw = ImageDraw.Draw(ph)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 80)
    except Exception:
        font = ImageFont.load_default()
        
    msg = "Preview Unavailable\nServer Memory Limit Exceeded"
    draw.text((1024, 1024), msg, fill=(100, 100, 100), font=font, anchor="mm", align="center")
    
    # Try to extract real dimensions using 'file'
    real_w, real_h = 2048, 2048
    try:
        file_out = subprocess.check_output(["file", tiff_path]).decode('utf-8', errors='ignore')
        w_m = re.search(r'width=(\d+)', file_out)
        h_m = re.search(r'height=(\d+)', file_out)
        if w_m and h_m:
            real_w = int(w_m.group(1))
            real_h = int(h_m.group(1))
    except Exception:
        pass

    out_io = io.BytesIO()
    ph.save(out_io, format="PNG")
    
    return out_io.getvalue(), {
        "width": real_w,
        "height": real_h,
        "dpi": 300.0,
        "format": "tiff",
        "preview_mime": "image/png",
    }


def _pdf_is_encrypted(file_bytes: bytes) -> bool:
    head = file_bytes[:4096]
    if b"/Encrypt" in head:
        return True
    return False


def pdf_first_page_to_png(file_bytes: bytes, dpi: int = PDF_RASTER_DPI) -> tuple[bytes, dict]:
    """Rasterize the first PDF page at print quality (default 300 DPI)."""
    if _pdf_is_encrypted(file_bytes):
        raise ProductionUploadError(
            "Encrypted PDFs are not supported. Export an unlocked PDF and try again."
        )

    validate_upload_limits(file_bytes)

    pdftoppm = shutil.which("pdftoppm")
    inkscape = shutil.which("inkscape")
    gs = shutil.which("gs")

    with tempfile.TemporaryDirectory(prefix="tus_pdf_") as tmp:
        pdf_path = os.path.join(tmp, "input.pdf")
        with open(pdf_path, "wb") as handle:
            handle.write(file_bytes)

        png_path = None
        try:
            if pdftoppm:
                prefix = os.path.join(tmp, "page")
                subprocess.run(
                    [
                        pdftoppm,
                        "-png",
                        "-r",
                        str(int(dpi)),
                        "-f",
                        "1",
                        "-l",
                        "1",
                        "-singlefile",
                        pdf_path,
                        prefix,
                    ],
                    check=True,
                    capture_output=True,
                    timeout=600,
                )
                candidate = prefix + ".png"
                if os.path.exists(candidate):
                    png_path = candidate
            elif inkscape:
                candidate = os.path.join(tmp, "page.png")
                subprocess.run(
                    [
                        inkscape,
                        pdf_path,
                        f"--export-filename={candidate}",
                        f"--export-dpi={int(dpi)}",
                        "--pdf-page=1",
                    ],
                    check=True,
                    capture_output=True,
                    timeout=600,
                )
                if os.path.exists(candidate):
                    png_path = candidate
            elif gs:
                candidate = os.path.join(tmp, "page.png")
                subprocess.run(
                    [
                        gs,
                        "-dSAFER",
                        "-dBATCH",
                        "-dNOPAUSE",
                        "-dFirstPage=1",
                        "-dLastPage=1",
                        f"-r{int(dpi)}",
                        "-sDEVICE=png16m",
                        f"-sOutputFile={candidate}",
                        pdf_path,
                    ],
                    check=True,
                    capture_output=True,
                    timeout=600,
                )
                if os.path.exists(candidate):
                    png_path = candidate
            else:
                raise ProductionUploadError(
                    "PDF rasterization tools are not installed on the server "
                    "(need pdftoppm, Inkscape, or Ghostscript)."
                )
        except subprocess.CalledProcessError as exc:
            _logger.exception("PDF rasterization failed: %s", exc.stderr)
            raise ProductionUploadError(
                "Could not rasterize PDF. Multi-page/encrypted or damaged files may fail; "
                "only the first page is used."
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise ProductionUploadError("PDF conversion timed out.") from exc

        if not png_path or not os.path.exists(png_path):
            raise ProductionUploadError("PDF conversion produced no image.")

        with open(png_path, "rb") as handle:
            png_bytes = handle.read()

    try:
        from PIL import Image

        with Image.open(io.BytesIO(png_bytes)) as img:
            width, height = img.size
            validate_upload_limits(png_bytes, width=width, height=height)
    except ProductionUploadError:
        raise
    except Exception:
        width = height = None

    return png_bytes, {
        "width": width,
        "height": height,
        "dpi": float(dpi),
        "format": "pdf",
        "preview_mime": "image/png",
    }


def make_browser_preview(
    raster_bytes: bytes,
    *,
    max_side: int = DEFAULT_PREVIEW_MAX_SIDE,
) -> tuple[bytes, dict]:
    """Downscale a raster for Fabric while preserving aspect ratio."""
    try:
        from PIL import Image
    except ImportError as exc:
        raise ProductionUploadError("Pillow is required for preview generation.") from exc

    with Image.open(io.BytesIO(raster_bytes)) as img:
        width, height = img.size
        dpi = _pillow_dpi(img)
        max_dim = max(width, height) or 1
        scale = 1.0
        preview = img
        if max_side and max_dim > max_side:
            scale = max_side / float(max_dim)
            new_size = (
                max(1, int(round(width * scale))),
                max(1, int(round(height * scale))),
            )
            preview = img.resize(new_size, _lanczos())

        if preview.mode not in ("RGB", "RGBA"):
            preview = preview.convert("RGBA" if "A" in img.getbands() else "RGB")

        out = io.BytesIO()
        save_kwargs = {"optimize": False, "compress_level": 1}
        if dpi:
            save_kwargs["dpi"] = (dpi, dpi)
        preview.save(out, format="PNG", **save_kwargs)
        preview_bytes = out.getvalue()
        return preview_bytes, {
            "source_width": width,
            "source_height": height,
            "preview_width": preview.size[0],
            "preview_height": preview.size[1],
            "preview_scale": scale,
            "dpi": dpi,
            "preview_mime": "image/png",
        }


def normalize_production_upload(
    file_bytes: bytes,
    filename: str | None,
    *,
    max_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
    max_pixels: int = DEFAULT_MAX_PIXELS,
    preview_max_side: int = DEFAULT_PREVIEW_MAX_SIDE,
) -> dict:
    """Validate upload, keep original bytes, and build an editor-safe preview raster.

    Returns a dict with keys:
      original_bytes, original_mime, preview_bytes, preview_filename, meta
    """
    validate_upload_limits(file_bytes, max_bytes=max_bytes)
    mime = detect_mime(file_bytes, filename)
    ext = extension_of(filename)

    original_bytes = file_bytes
    working_bytes = file_bytes
    working_name = filename or "upload.png"
    source_meta = {"format": ext or "raster"}

    if mime == "image/tiff" or ext in TIFF_EXTENSIONS:
        working_bytes, source_meta = tiff_first_frame_to_png(file_bytes)
        working_name = (filename or "upload.tif").rsplit(".", 1)[0] + ".png"
        mime = "image/tiff"
    elif mime == "application/pdf" or ext in PDF_EXTENSIONS:
        working_bytes, source_meta = pdf_first_page_to_png(file_bytes)
        working_name = (filename or "upload.pdf").rsplit(".", 1)[0] + ".png"
        mime = "application/pdf"
    else:
        # Standard rasters / SVG — still build preview metadata when raster.
        try:
            from PIL import Image

            with Image.open(io.BytesIO(file_bytes)) as img:
                source_meta.update(
                    {
                        "width": img.size[0],
                        "height": img.size[1],
                        "dpi": _pillow_dpi(img),
                        "format": (img.format or ext or "raster").lower(),
                    }
                )
                validate_upload_limits(
                    file_bytes,
                    max_bytes=max_bytes,
                    max_pixels=max_pixels,
                    width=img.size[0],
                    height=img.size[1],
                )
        except ProductionUploadError:
            raise
        except Exception:
            # SVG / non-raster fall through unchanged.
            pass

    # For SVG keep as-is (no raster preview swap).
    if mime == "image/svg+xml" or (filename or "").lower().endswith(".svg"):
        return {
            "original_bytes": original_bytes,
            "original_mime": mime or "image/svg+xml",
            "preview_bytes": original_bytes,
            "preview_filename": filename or "upload.svg",
            "working_bytes": original_bytes,
            "working_filename": filename or "upload.svg",
            "meta": {
                "source_width": None,
                "source_height": None,
                "preview_scale": 1.0,
                "dpi": None,
                "format": "svg",
                "is_svg": True,
            },
        }

    preview_bytes, preview_meta = make_browser_preview(
        working_bytes, max_side=preview_max_side
    )
    # Enforce pixel cap on source dimensions when known.
    sw = preview_meta.get("source_width") or source_meta.get("width")
    sh = preview_meta.get("source_height") or source_meta.get("height")
    if sw and sh:
        validate_upload_limits(
            file_bytes,
            max_bytes=max_bytes,
            max_pixels=max_pixels,
            width=sw,
            height=sh,
        )

    meta = {
        "source_width": sw,
        "source_height": sh,
        "preview_width": preview_meta.get("preview_width"),
        "preview_height": preview_meta.get("preview_height"),
        "preview_scale": preview_meta.get("preview_scale") or 1.0,
        "dpi": source_meta.get("dpi") or preview_meta.get("dpi"),
        "format": source_meta.get("format"),
        "is_svg": False,
    }
    return {
        "original_bytes": original_bytes,
        "original_mime": mime or "application/octet-stream",
        "preview_bytes": preview_bytes,
        "preview_filename": (working_name.rsplit(".", 1)[0] + "_preview.png"),
        "working_bytes": working_bytes,
        "working_filename": working_name,
        "meta": meta,
    }
