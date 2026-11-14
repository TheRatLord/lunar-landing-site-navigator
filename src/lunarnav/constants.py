"""Physical and convention constants shared by every module."""

R_MOON_M = 1_737_400.0
"""LOLA reference sphere radius. All terrain heights are relative to this sphere."""

BODY_FIXED_FRAME = "MOON_ME"
"""Mean-Earth/polar-axis frame. LOLA products and all site coordinates use it."""

R_SUN_KM = 695_700.0
AU_KM = 149_597_870.7
SOLAR_CONSTANT_W_M2 = 1361.0
"""Total solar irradiance at 1 au."""

DEFAULT_HORIZON_AZIMUTHS = 720
