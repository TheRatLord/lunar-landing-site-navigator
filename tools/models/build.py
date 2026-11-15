import json

from common import OUT, export, render_angles, render_pov, reset, triangles
from cockpit import build_current as current_inside
from cockpit import build_improved as improved_cockpit
from rover import build_current as current_rover
from rover import build_improved as improved_rover


COCKPIT_ANGLES = {
    "front": (0, 2.5, -5.0),
    "side": (5.0, 2.4, 0),
    "top": (0, 6.0, 0),
    "three_quarter": (4.0, 2.9, 4.3),
}


def main():
    manifest = {}
    for name, builder, cockpit in [
        ("current_rover", current_rover, False),
        ("improved_rover", improved_rover, False),
        ("current_inside", current_inside, True),
        ("improved_cockpit", improved_cockpit, True),
    ]:
        reset()
        obj = builder()
        count = triangles(obj)
        path = export(obj, name)
        manifest[name] = {"triangles": count, "bytes": path.stat().st_size, "glb": path.name}
        if cockpit:
            render_angles(name, COCKPIT_ANGLES, target=(0, 1.45, -0.2), floor_top=0.53 if name == "current_inside" else 0.895, scale=3.6)
            render_pov(name)
        else:
            render_angles(name)
        print(name, manifest[name], flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
