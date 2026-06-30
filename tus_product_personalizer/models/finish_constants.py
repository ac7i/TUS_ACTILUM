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
DEFAULT_RELIEF_MM = 0.6
