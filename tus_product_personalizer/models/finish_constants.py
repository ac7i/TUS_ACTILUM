# Shared finish effect values (keep in sync with static/src/js/3d/finish_effects.js)

FINISH_EFFECT_SELECTION = [
    ("none", "None"),
    ("emboss", "Emboss"),
    ("deboss", "Deboss"),
    ("foil", "Hot Foil"),
    ("foil_emboss", "Foil Emboss"),
    ("gloss", "Gloss (Spot UV)"),
    ("satin", "Satin"),
    ("varnish_matte", "Matte Varnish"),
]

VARNISH_TYPE_SELECTION = [
    ("none", "No"),
    ("gloss", "Gloss"),
    ("satin", "Satin"),
]

FOIL_METAL_SELECTION = [
    ("gold", "Gold"),
    ("silver", "Silver"),
    ("copper", "Copper"),
    ("rose_gold", "Rose Gold"),
    ("holographic", "Holographic"),
]

DEFAULT_FINISH_EFFECT = "none"
DEFAULT_VARNISH_TYPE = "none"
DEFAULT_FOIL_METAL = "gold"
# 0.0 means no emboss selected; only set a positive value when emboss is active.
DEFAULT_RELIEF_MM = 0.0

# Customer-facing texture (emboss) intensity presets. Labels use the European
# decimal comma to match the client mockup; values are millimetres.
TEXTURE_INTENSITY_SELECTION = [
    ("0.2", "0,2 mm"),
    ("0.3", "0,3 mm"),
    ("0.4", "0,4 mm"),
    ("0.5", "0,5 mm"),
]
TEXTURE_INTENSITY_VALUES = frozenset(value for value, _label in TEXTURE_INTENSITY_SELECTION)
DEFAULT_TEXTURE_INTENSITY = "0.3"

# Varnish coverage area modes (client mockup: By image file / All / Zones).
VARNISH_COVER_MODE_SELECTION = [
    ("by_file", "By image file"),
    ("all", "All"),
    ("zones", "Zones"),
]
DEFAULT_VARNISH_COVER_MODE = "all"
