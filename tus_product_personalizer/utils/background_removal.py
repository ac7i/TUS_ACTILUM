# -*- coding: utf-8 -*-
"""Server-side background removal helpers (rembg + lightweight model)."""

import io
import logging
from functools import lru_cache

_logger = logging.getLogger(__name__)

# u2netp is much smaller than u2net (~4 MB vs ~176 MB) and uses less RAM.
REMBG_MODEL = "u2netp"
DEFAULT_MAX_SIDE = 1536
FALLBACK_MAX_SIDE = 1024


@lru_cache(maxsize=1)
def _get_rembg_session():
    from rembg import new_session

    _logger.info("Loading rembg session model=%s", REMBG_MODEL)
    return new_session(REMBG_MODEL)


def _load_image(raw_bytes):
    from PIL import Image

    img = Image.open(io.BytesIO(raw_bytes))
    if img.mode in ("RGBA", "LA"):
        return img.convert("RGBA")
    if img.mode == "P" and "transparency" in img.info:
        return img.convert("RGBA")
    return img.convert("RGB")


def _encode_image(img):
    buf = io.BytesIO()
    if img.mode == "RGBA":
        img.save(buf, format="PNG", optimize=True)
    else:
        img.convert("RGB").save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def _resize_image(img, max_side):
    width, height = img.size
    longest = max(width, height)
    if longest <= max_side:
        return img, False
    scale = max_side / float(longest)
    new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    from PIL import Image

    return img.resize(new_size, Image.Resampling.LANCZOS), True


def _upscale_rgba_png(png_bytes, target_size):
    from PIL import Image

    result = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    if result.size == target_size:
        return png_bytes
    result = result.resize(target_size, Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    result.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def remove_image_background(raw_bytes, max_side=DEFAULT_MAX_SIDE):
    """
    Remove background from image bytes.

    Images are downscaled before inference to limit ONNX memory use, then the
    transparent result is upscaled back to the original pixel dimensions.
    """
    from rembg import remove

    if not raw_bytes:
        raise ValueError("Empty image data.")

    original = _load_image(raw_bytes)
    original_size = original.size
    working, _was_resized = _resize_image(original, max_side)
    session = _get_rembg_session()
    output = remove(_encode_image(working), session=session)

    if working.size != original_size:
        output = _upscale_rgba_png(output, original_size)
    return output


def remove_image_background_safe(raw_bytes):
    """Try default limits first, then retry with a smaller working size."""
    try:
        return remove_image_background(raw_bytes, max_side=DEFAULT_MAX_SIDE)
    except Exception as first_error:
        _logger.warning(
            "Background removal failed at max_side=%s, retrying at %s: %s",
            DEFAULT_MAX_SIDE,
            FALLBACK_MAX_SIDE,
            first_error,
        )
        try:
            return remove_image_background(raw_bytes, max_side=FALLBACK_MAX_SIDE)
        except Exception:
            raise first_error
