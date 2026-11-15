from common import box, cylinder, material, rod, root, screen


def palette():
    return {
        "shell": material("Cabin ceramic", (0.72, 0.77, 0.76), 0.15, 0.58),
        "frame": material("Cabin frame", (0.28, 0.34, 0.38), 0.55, 0.44),
        "dash": material("Dashboard graphite", (0.075, 0.095, 0.12), 0.16, 0.7),
        "seat": material("Seat fabric", (0.25, 0.29, 0.31), 0.0, 0.92),
        "gold": material("Cabin brass", (0.65, 0.39, 0.1), 0.7, 0.4),
        "glass": material("Window tint", (0.05, 0.12, 0.16), 0.35, 0.2),
        "screen": material("Inactive display", (0.015, 0.09, 0.14), 0.08, 0.25, 0.6),
        "button": material("Control indicator", (0.38, 0.73, 0.66), 0.15, 0.32, 0.5),
    }


def build_current():
    p = palette()
    obj = root("CurrentInsideAreaReconstruction")
    box("Current_Chassis", 0, 0.62, 0, 1.7, 0.18, 2.9, p["shell"], obj)
    box("Current_RearDeck", 0, 0.85, 1.05, 1.5, 0.3, 0.6, p["gold"], obj)
    for side, x in [("L", -0.38), ("R", 0.38)]:
        box(f"Current_SeatBase_{side}", x, 0.78, -0.15, 0.52, 0.1, 0.5, p["frame"], obj)
        box(f"Current_SeatBack_{side}", x, 1.05, 0.12, 0.52, 0.55, 0.08, p["frame"], obj)
    box("Current_FrontHousing", 0, 0.98, -0.95, 0.9, 0.5, 0.25, p["frame"], obj)
    box("Current_FrontGlass", 0, 1.0, -1.09, 0.7, 0.28, 0.04, p["glass"], obj)
    return obj


def build_improved():
    p = palette()
    obj = root("CockpitRoot")
    box("CabinFloor", 0, 0.93, -0.27, 1.5, 0.07, 2.16, p["frame"], obj, 0.025)
    box("FloorGripLeft", -0.45, 0.972, -0.38, 0.5, 0.012, 0.63, p["dash"], obj, 0.01)
    box("FloorGripRight", 0.45, 0.972, -0.38, 0.5, 0.012, 0.63, p["dash"], obj, 0.01)
    for side, x in [("L", -0.39), ("R", 0.39)]:
        box(f"SeatFrame_{side}", x, 0.99, 0.28, 0.55, 0.22, 0.66, p["frame"], obj, 0.035)
        box(f"SeatCushion_{side}", x, 1.1, 0.26, 0.48, 0.1, 0.57, p["seat"], obj, 0.035)
        box(f"SeatBack_{side}", x, 1.43, 0.59, 0.52, 0.63, 0.1, p["seat"], obj, 0.045)
        box(f"Headrest_{side}", x, 1.83, 0.6, 0.35, 0.16, 0.14, p["seat"], obj, 0.04)
        box(f"SeatHarness_{side}", x, 1.43, 0.523, 0.09, 0.56, 0.014, p["gold"], obj, 0.005)
        box(f"Armrest_{side}", x + (-0.25 if x < 0 else 0.25), 1.2, 0.24, 0.07, 0.08, 0.45, p["frame"], obj, 0.02)
    box("CenterConsole", 0, 1.08, -0.23, 0.17, 0.24, 0.8, p["dash"], obj, 0.035)
    for side, x in [("L", -0.6), ("R", 0.6)]:
        box(f"DashboardSupport_{side}", x, 1.02, -1.04, 0.07, 0.14, 0.1, p["frame"], obj, 0.015)
    box("DashboardLower", 0, 1.19, -1.0, 1.5, 0.32, 0.3, p["frame"], obj, 0.07)
    for n, x in enumerate([-0.58, -0.29, 0, 0.29, 0.58]):
        z = -0.89 - 0.11 * (1 - abs(x) / 0.58)
        box(f"DashboardArc_{n}", x, 1.47, z, 0.31, 0.12, 0.23, p["dash"], obj, 0.035)
    for label, x in [("Nav", -0.48), ("Status", 0), ("Comms", 0.48)]:
        box(f"ScreenBezel_{label}", x, 1.56, -0.855, 0.39, 0.29, 0.045, p["frame"], obj, 0.015)
        screen(f"Screen_{label}", x, 1.56, -0.826, 0.33, 0.23, p["screen"], obj)
        box(f"ScreenKey_{label}", x, 1.38, -0.81, 0.13, 0.025, 0.035, p["button"], obj, 0.008)
    for side, x in [("L", -0.45), ("R", 0.45)]:
        rod(f"ControlStick_{side}", (x, 1.0, -0.52), (x, 1.22, -0.61), 0.035, p["frame"], obj, 10)
        cylinder(f"StickGrip_{side}", x, 1.23, -0.61, 0.07, 0.13, p["dash"], obj, vertices=12)
    rod("YokeStem", (-0.38, 1.1, -0.87), (-0.38, 1.12, -0.67), 0.035, p["frame"], obj, 10)
    rod("YokeBar", (-0.6, 1.15, -0.67), (-0.16, 1.15, -0.67), 0.035, p["frame"], obj, 10)
    for side, x in [("L", -0.76), ("R", 0.76)]:
        rod(f"WindowPillar_{side}", (x, 1.02, -1.35), (x * 0.9, 2.0, -1.25), 0.052, p["frame"], obj, 10)
    rod("WindshieldTop", (-0.69, 2.0, -1.25), (0.69, 2.0, -1.25), 0.05, p["frame"], obj, 10)
    rod("WindshieldLower", (-0.76, 1.13, -1.35), (0.76, 1.13, -1.35), 0.045, p["frame"], obj, 10)
    rod("RoofRailLeft", (-0.68, 2.0, -1.25), (-0.68, 1.98, 0.68), 0.042, p["frame"], obj, 10)
    rod("RoofRailRight", (0.68, 2.0, -1.25), (0.68, 1.98, 0.68), 0.042, p["frame"], obj, 10)
    box("HatchFrame", 0.77, 1.34, 0.25, 0.07, 0.75, 0.84, p["frame"], obj, 0.025)
    box("HatchPanel", 0.815, 1.31, 0.25, 0.025, 0.59, 0.68, p["shell"], obj, 0.008)
    box("HatchHandle", 0.835, 1.29, -0.02, 0.02, 0.07, 0.13, p["gold"], obj, 0.004)
    return obj
