import math

import bpy

from common import box, cylinder, material, parent_keep, rod, root, xyz


WHEELS = {
    "FL": (-0.95, -1.25),
    "FR": (0.95, -1.25),
    "RL": (-0.95, 1.25),
    "RR": (0.95, 1.25),
}


def palette():
    return {
        "shell": material("Ivory ceramic", (0.73, 0.77, 0.76), 0.18, 0.56),
        "armor": material("Warm gray armor", (0.38, 0.43, 0.47), 0.42, 0.48),
        "dark": material("Graphite", (0.07, 0.09, 0.12), 0.1, 0.72),
        "tyre": material("Regolith tire", (0.045, 0.05, 0.055), 0.0, 0.9),
        "hub": material("Machined aluminum", (0.55, 0.6, 0.63), 0.75, 0.32),
        "gold": material("Gold foil", (0.65, 0.39, 0.09), 0.72, 0.35),
        "solar": material("Solar cell blue", (0.025, 0.065, 0.14), 0.38, 0.23),
        "glass": material("Camera glass", (0.035, 0.10, 0.16), 0.36, 0.18),
        "lamp": material("Headlight lens", (0.91, 0.9, 0.72), 0.08, 0.25, 1.7),
    }


def build_current():
    p = palette()
    obj = root("CurrentRoverReconstruction")
    box("Current_Chassis", 0, 0.62, 0, 1.7, 0.18, 2.9, p["shell"], obj)
    box("Current_GoldDeck", 0, 0.85, 1.05, 1.5, 0.3, 0.6, p["gold"], obj)
    for side, x in [("L", -0.38), ("R", 0.38)]:
        box(f"Current_SeatBase_{side}", x, 0.78, -0.15, 0.52, 0.1, 0.5, p["armor"], obj)
        box(f"Current_SeatBack_{side}", x, 1.05, 0.12, 0.52, 0.55, 0.08, p["armor"], obj)
    box("Current_FrontHousing", 0, 0.98, -0.95, 0.9, 0.5, 0.25, p["armor"], obj)
    box("Current_FrontGlass", 0, 1.0, -1.09, 0.7, 0.28, 0.04, p["glass"], obj)
    cylinder("Current_Mast", 0.55, 1.35, -1.1, 0.05, 1.3, p["armor"], obj, vertices=8)
    box("Current_MastCamera", 0.55, 2.02, -1.1, 0.32, 0.16, 0.16, p["shell"], obj)
    cylinder("Current_DishPole", -0.45, 1.25, 1.0, 0.03, 0.9, p["armor"], obj, vertices=8)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=18, ring_count=8, radius=0.42, location=xyz(-0.45, 1.75, 1.0))
    dish = bpy.context.object
    dish.name = "Current_Dish"
    dish.scale.z = 0.35
    dish.data.materials.append(p["shell"])
    parent_keep(dish, obj)
    for label, (x, z) in WHEELS.items():
        cylinder(f"Current_Wheel_{label}", x, 0.42, z, 0.42, 0.3, p["tyre"], obj, vertices=20, axis="x")
        box(f"Current_Fender_{label}", x, 0.9, z, 0.36, 0.06, 0.95, p["shell"], obj)
    return obj


def wheel(obj, label, x, z, p):
    pivot = bpy.data.objects.new(f"Steer_{label}", None)
    bpy.context.collection.objects.link(pivot)
    pivot.location = xyz(x, 0.42, z)
    parent_keep(pivot, obj)
    tyre = cylinder(f"Wheel_{label}", x, 0.42, z, 0.42, 0.3, p["tyre"], vertices=20, axis="x")
    parent_keep(tyre, pivot)
    hub = cylinder(f"Hub_{label}", x + (0.157 if x > 0 else -0.157), 0.42, z, 0.21, 0.016, p["hub"], vertices=16, axis="x")
    parent_keep(hub, tyre)
    cap = cylinder(f"HubCap_{label}", x + (0.168 if x > 0 else -0.168), 0.42, z, 0.085, 0.02, p["gold"], vertices=12, axis="x")
    parent_keep(cap, tyre)
    for i in range(12):
        a = i * math.tau / 12
        y = 0.42 + math.sin(a) * 0.34
        zz = z + math.cos(a) * 0.34
        tread = box(f"Tread_{label}_{i:02}", x, y, zz, 0.32, 0.07, 0.16, p["dark"], edge=0.012)
        tread.rotation_euler.x = -a
        parent_keep(tread, tyre)
    return pivot


def build_improved():
    p = palette()
    obj = root("RoverRoot")
    box("Chassis", 0, 0.66, 0, 1.66, 0.28, 2.76, p["shell"], obj, 0.075)
    box("Belly", 0, 0.47, 0, 1.4, 0.14, 2.4, p["dark"], obj, 0.03)
    box("Deck", 0, 0.87, 0.02, 1.54, 0.1, 2.55, p["armor"], obj, 0.035)
    box("Nose", 0, 0.79, -1.45, 1.52, 0.22, 0.25, p["shell"], obj, 0.035)
    box("FrontBumper", 0, 0.51, -1.55, 1.62, 0.13, 0.12, p["armor"], obj, 0.025)
    for side, x in [("L", -0.72), ("R", 0.72)]:
        box(f"SideRail_{side}", x, 0.98, 0, 0.1, 0.16, 2.45, p["shell"], obj, 0.025)
        box(f"ArmorInset_{side}", x * 1.04, 0.69, 0.12, 0.045, 0.13, 1.7, p["gold"], obj, 0.01)
        for n, z in enumerate([-0.7, -0.46, -0.22]):
            box(f"Vent_{side}_{n}", x * 0.91, 1.02, z, 0.07, 0.018, 0.12, p["dark"], obj, 0.005)
    for n, z in enumerate([-1.12, -0.86, 0.93, 1.16]):
        box(f"DeckSeam_{n}", 0, 0.925, z, 1.28, 0.012, 0.012, p["dark"], obj)
    box("SolarFrame", 0, 1.01, 1.05, 1.45, 0.07, 0.5, p["gold"], obj, 0.015)
    box("SolarBacking", 0, 1.055, 1.05, 1.35, 0.025, 0.44, p["dark"], obj)
    for row in range(2):
        for col in range(5):
            x = -0.535 + col * 0.2675
            z = 0.94 + row * 0.22
            box(f"SolarCell_{row}_{col}", x, 1.073, z, 0.235, 0.01, 0.19, p["solar"], obj, 0.004)
    mast = root("Mast")
    parent_keep(mast, obj)
    rod("MastPole", (0.53, 0.95, -1.0), (0.53, 1.91, -1.0), 0.045, p["hub"], mast, 10)
    box("MastCameraHousing", 0.53, 1.98, -1.0, 0.32, 0.16, 0.22, p["shell"], mast, 0.025)
    box("MastCameraLens", 0.53, 1.98, -1.125, 0.18, 0.09, 0.012, p["glass"], mast, 0.004)
    rod("AntennaStem", (-0.42, 1.0, 0.9), (-0.42, 1.71, 0.9), 0.025, p["hub"], mast, 8)
    cylinder("AntennaDish", -0.42, 1.78, 0.9, 0.26, 0.07, p["shell"], mast, vertices=24)
    rod("AntennaTip", (-0.42, 1.8, 0.9), (-0.42, 2.06, 0.9), 0.012, p["gold"], mast, 8)
    for side, x in [("L", -0.52), ("R", 0.52)]:
        box(f"HeadlightBezel_{side}", x, 0.91, -1.58, 0.22, 0.16, 0.055, p["dark"], obj, 0.018)
        box(f"Headlight_{side}", x, 0.91, -1.612, 0.15, 0.09, 0.012, p["lamp"], obj, 0.008)
    for label, (x, z) in WHEELS.items():
        rod(f"SuspensionUpper_{label}", (x * 0.65, 0.63, z * 0.82), (x, 0.58, z), 0.048, p["hub"], obj)
        rod(f"SuspensionLower_{label}", (x * 0.65, 0.43, z * 0.82), (x, 0.42, z), 0.055, p["armor"], obj)
        cylinder(f"Spring_{label}", x * 0.77, 0.54, z * 0.9, 0.085, 0.23, p["gold"], obj, vertices=12)
        box(f"Fender_{label}", x, 0.91, z, 0.34, 0.07, 0.94, p["shell"], obj, 0.028)
        wheel(obj, label, x, z, p)
    return obj
