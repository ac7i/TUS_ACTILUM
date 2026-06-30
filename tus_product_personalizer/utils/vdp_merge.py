"""Merge variable data rows into exported designer payloads."""

import copy
import json
import logging

_logger = logging.getLogger(__name__)


def merge_vdp_row_into_design(design_data, row_data):
    """Return a deep copy of *design_data* with VDP text fields replaced.

    *design_data* matches the client export shape (list of side dicts with
    ``canvas_vals`` entries).  Variable fields are identified by
    ``tus_vdp_key`` on each canvas_val.
    """
    if not design_data or not row_data:
        return design_data

    # Create a normalized lookup dictionary (keys stripped and lowercased)
    normalized_row = {str(k).lower().strip(): v for k, v in row_data.items()}

    merged = copy.deepcopy(design_data)
    for side_obj in merged:
        for canvas_val in side_obj.get("canvas_vals") or []:
            key = canvas_val.get("tus_vdp_key")
            if not key:
                continue
            key_norm = str(key).lower().strip()
            if key_norm not in normalized_row:
                continue
            value = normalized_row.get(key_norm) or ""
            if canvas_val.get("type") in ("i-text", "text", "textbox", "curved-text"):
                canvas_val["text"] = value
    return merged


def design_data_from_json(payload):
    if not payload:
        return []
    if isinstance(payload, (list, dict)):
        return payload
    try:
        return json.loads(payload)
    except (TypeError, ValueError):
        _logger.warning("Invalid VDP design JSON payload")
        return []
