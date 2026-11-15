import bpy

from common import box, cylinder, material, parent_keep, rod, root, xyz


def sphere(name, x, y, z, rx, ry, rz, mat, parent=None, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=xyz(x, y, z))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (rx, rz, ry)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if parent:
        parent_keep(obj, parent)
    return obj


def capsule(name, x, y, z, radius, length, mat, parent):
    cylinder(f"{name}_Center", x, y, z, radius, length, mat, parent, vertices=16)
    sphere(f"{name}_Top", x, y + length / 2, z, radius, radius, radius, mat, parent)
    sphere(f"{name}_Bottom", x, y - length / 2, z, radius, radius, radius, mat, parent)


def palette():
    return {
        "suit": material("White suit fabric", (0.79, 0.82, 0.79), 0.02, 0.82),
        "armor": material("Ceramic armor", (0.91, 0.91, 0.85), 0.08, 0.52),
        "joint": material("Flexible joints", (0.20, 0.24, 0.26), 0.04, 0.82),
        "boot": material("Boot tread", (0.13, 0.16, 0.18), 0.08, 0.72),
        "trim": material("Metal trim", (0.52, 0.60, 0.61), 0.58, 0.34),
        "visor": material("Gold visor", (0.64, 0.34, 0.075), 0.84, 0.18),
        "glass": material("Display glass", (0.025, 0.15, 0.22), 0.22, 0.22, 0.25),
        "red": material("Flag red", (0.61, 0.08, 0.07), 0.0, 0.8),
        "blue": material("Flag blue", (0.035, 0.11, 0.30), 0.0, 0.8),
    }


def flag(x, y, z, p, parent):
    box("FlagPatch", x, y, z, 0.016, 0.095, 0.14, p["suit"], parent, 0.003)
    for n, dz in enumerate([-0.046, -0.002, 0.042]):
        box(f"FlagStripe_{n}", x - 0.010, y - 0.027 + n * 0.027, z + dz, 0.004, 0.014, 0.05, p["red"], parent)
    box("FlagCanton", x - 0.012, y + 0.025, z - 0.039, 0.005, 0.037, 0.055, p["blue"], parent)


def standing_current():
    p = palette()
    obj = root("CurrentAstronautReconstruction")
    for side, x in [("L", -0.14), ("R", 0.14)]:
        limb = root(f"Current_Leg_{side}")
        limb.location = xyz(x, 0.42, 0)
        parent_keep(limb, obj)
        capsule(f"Current_LegShell_{side}", x, 0.42, 0, 0.12, 0.55, p["suit"], limb)
    capsule("Current_Torso", 0, 1.12, 0, 0.27, 0.42, p["suit"], obj)
    box("Current_Backpack", 0, 1.2, 0.3, 0.5, 0.62, 0.26, p["suit"], obj)
    box("Current_ChestPanel", 0, 1.12, -0.3, 0.28, 0.16, 0.08, p["joint"], obj)
    for side, x in [("L", -0.38), ("R", 0.38)]:
        limb = root(f"Current_Arm_{side}")
        limb.location = xyz(x, 1.1, 0)
        parent_keep(limb, obj)
        capsule(f"Current_ArmShell_{side}", x, 1.1, 0, 0.09, 0.5, p["suit"], limb)
    sphere("Current_Helmet", 0, 1.66, 0, 0.22, 0.22, 0.22, p["suit"], obj, 20, 14)
    sphere("Current_Visor", 0, 1.66, -0.175, 0.175, 0.12, 0.055, p["visor"], obj, 20, 14)
    return obj


def standing_improved():
    p = palette()
    obj = root("AstronautRoot")
    body = root("AstronautBody")
    parent_keep(body, obj)
    for side, x in [("L", -0.14), ("R", 0.14)]:
        leg = root(f"Leg_{side}")
        leg.location = xyz(x, 0.42, 0)
        parent_keep(leg, body)
        cylinder(f"UpperLeg_{side}", x, 0.59, 0, 0.13, 0.31, p["suit"], leg, vertices=16)
        cylinder(f"KneeRing_{side}", x, 0.39, 0, 0.145, 0.07, p["joint"], leg, vertices=16)
        cylinder(f"LowerLeg_{side}", x, 0.25, 0, 0.125, 0.27, p["suit"], leg, vertices=16)
        box(f"ShinArmor_{side}", x, 0.23, -0.115, 0.19, 0.22, 0.045, p["armor"], leg, 0.025)
        box(f"Boot_{side}", x, 0.105, -0.055, 0.27, 0.16, 0.36, p["boot"], leg, 0.035)
        box(f"BootToe_{side}", x, 0.11, -0.21, 0.27, 0.12, 0.15, p["armor"], leg, 0.025)
        box(f"BootSole_{side}", x, 0.033, -0.08, 0.28, 0.035, 0.38, p["joint"], leg, 0.012)
    box("TorsoPressureShell", 0, 1.12, 0, 0.52, 0.65, 0.4, p["suit"], body, 0.11)
    box("TorsoChestArmor", 0, 1.17, -0.205, 0.42, 0.42, 0.07, p["armor"], body, 0.045)
    cylinder("WaistSeal", 0, 0.77, 0, 0.25, 0.09, p["joint"], body, vertices=18)
    box("LifeSupportPack", 0, 1.19, 0.32, 0.48, 0.61, 0.23, p["armor"], body, 0.045)
    box("LifeSupportPanel", 0, 1.21, 0.448, 0.36, 0.44, 0.018, p["trim"], body, 0.015)
    for n, x in enumerate([-0.1, 0, 0.1]):
        box(f"LifeSupportVent_{n}", x, 1.11, 0.462, 0.055, 0.19, 0.008, p["joint"], body, 0.004)
    box("ChestControls", 0, 1.19, -0.253, 0.29, 0.21, 0.035, p["joint"], body, 0.025)
    box("ChestDisplay", 0, 1.22, -0.274, 0.16, 0.085, 0.006, p["glass"], body, 0.006)
    for n, x in enumerate([-0.09, 0, 0.09]):
        box(f"ChestKey_{n}", x, 1.12, -0.274, 0.04, 0.025, 0.006, p["trim"], body, 0.004)
    for side, x in [("L", -0.38), ("R", 0.38)]:
        arm = root(f"Arm_{side}")
        arm.location = xyz(x, 1.1, 0)
        parent_keep(arm, body)
        sphere(f"Shoulder_{side}", x, 1.38, 0, 0.15, 0.15, 0.15, p["armor"], arm)
        cylinder(f"UpperArm_{side}", x, 1.22, 0, 0.105, 0.27, p["suit"], arm, vertices=14)
        cylinder(f"ElbowSeal_{side}", x, 1.075, 0, 0.105, 0.065, p["joint"], arm, vertices=14)
        cylinder(f"Forearm_{side}", x, 0.93, 0, 0.095, 0.24, p["suit"], arm, vertices=14)
        box(f"Glove_{side}", x, 0.80, -0.005, 0.19, 0.17, 0.18, p["joint"], arm, 0.045)
        cylinder(f"WristRing_{side}", x, 0.84, 0, 0.108, 0.045, p["trim"], arm, vertices=14)
    flag(-0.497, 1.23, -0.012, p, body)
    cylinder("NeckRing", 0, 1.51, 0, 0.205, 0.08, p["joint"], body, vertices=18)
    sphere("HelmetShell", 0, 1.66, 0, 0.22, 0.22, 0.22, p["armor"], body, 20, 12)
    sphere("VisorFrame", 0, 1.66, -0.17, 0.195, 0.155, 0.07, p["joint"], body, 20, 12)
    sphere("GoldVisor", 0, 1.66, -0.22, 0.17, 0.125, 0.052, p["visor"], body, 20, 12)
    cylinder("HelmetSidePort_L", -0.22, 1.66, 0.035, 0.07, 0.025, p["trim"], body, vertices=12, axis="x")
    cylinder("HelmetSidePort_R", 0.22, 1.66, 0.035, 0.07, 0.025, p["trim"], body, vertices=12, axis="x")
    return obj


def seated_improved():
    p = palette()
    obj = root("AstronautSeatedRoot")
    body = root("AstronautBody")
    parent_keep(body, obj)
    for side, x in [("L", -0.52), ("R", -0.26)]:
        leg = root(f"Leg_{side}")
        leg.location = xyz(x, 1.2, 0.23)
        parent_keep(leg, body)
        rod(f"Thigh_{side}", (x, 1.22, 0.23), (x, 1.14, -0.2), 0.12, p["suit"], leg, 14)
        sphere(f"Knee_{side}", x, 1.14, -0.2, 0.13, 0.13, 0.13, p["joint"], leg)
        rod(f"Shin_{side}", (x, 1.12, -0.2), (x, 1.06, -0.42), 0.105, p["suit"], leg, 14)
        box(f"Boot_{side}", x, 1.045, -0.50, 0.24, 0.14, 0.29, p["boot"], leg, 0.025)
        box(f"BootToe_{side}", x, 1.05, -0.61, 0.22, 0.095, 0.11, p["armor"], leg, 0.017)
    box("TorsoPressureShell", -0.39, 1.47, 0.22, 0.48, 0.51, 0.37, p["suit"], body, 0.09)
    box("TorsoChestArmor", -0.39, 1.48, 0.027, 0.4, 0.32, 0.055, p["armor"], body, 0.035)
    box("LifeSupportPack", -0.39, 1.48, 0.47, 0.43, 0.48, 0.15, p["armor"], body, 0.035)
    box("LifeSupportPanel", -0.39, 1.48, 0.553, 0.29, 0.28, 0.01, p["trim"], body, 0.01)
    box("ChestControls", -0.39, 1.47, -0.012, 0.27, 0.17, 0.025, p["joint"], body, 0.018)
    box("ChestDisplay", -0.39, 1.49, -0.028, 0.15, 0.07, 0.005, p["glass"], body, 0.005)
    for side, shoulder, elbow, hand in [
        ("L", (-0.62, 1.57, 0.08), (-0.59, 1.37, -0.27), (-0.45, 1.23, -0.61)),
        ("R", (-0.16, 1.57, 0.08), (-0.16, 1.36, -0.3), (-0.25, 1.15, -0.67)),
    ]:
        arm = root(f"Arm_{side}")
        arm.location = xyz(*shoulder)
        parent_keep(arm, body)
        sphere(f"Shoulder_{side}", *shoulder, 0.125, 0.125, 0.125, p["armor"], arm)
        rod(f"UpperArm_{side}", shoulder, elbow, 0.095, p["suit"], arm, 14)
        sphere(f"Elbow_{side}", *elbow, 0.1, 0.1, 0.1, p["joint"], arm)
        rod(f"Forearm_{side}", elbow, hand, 0.087, p["suit"], arm, 14)
        sphere(f"Glove_{side}", *hand, 0.075, 0.08, 0.08, p["joint"], arm)
    flag(-0.755, 1.52, 0.04, p, body)
    cylinder("NeckRing", -0.39, 1.69, 0.17, 0.19, 0.06, p["joint"], body, vertices=18)
    sphere("HelmetShell", -0.39, 1.76, 0.15, 0.21, 0.21, 0.21, p["armor"], body, 20, 12)
    sphere("VisorFrame", -0.39, 1.76, -0.015, 0.185, 0.145, 0.06, p["joint"], body, 20, 12)
    sphere("GoldVisor", -0.39, 1.76, -0.06, 0.16, 0.12, 0.045, p["visor"], body, 20, 12)
    return obj
