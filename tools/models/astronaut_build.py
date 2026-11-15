import json

from astronaut import seated_improved, standing_current, standing_improved
from cockpit import build_improved as improved_cockpit
from common import OUT, export, render_angles, reset, triangles
from rover import build_improved as improved_rover


STANDING_ANGLES = {
    "front": (0, 1.8, -4),
    "side": (4, 1.8, 0),
    "back": (0, 1.8, 4),
    "three_quarter": (3.2, 2.3, -3.3),
}
SEATED_ANGLES = {
    "side": (-4.5, 2.2, 0),
    "three_quarter": (-4.2, 3.1, -4.2),
}


def main():
    manifest = {}
    for name, builder in [
        ("current_astronaut", standing_current),
        ("improved_astronaut", standing_improved),
        ("astronaut_seated", seated_improved),
    ]:
        reset()
        obj = builder()
        path = export(obj, name)
        manifest[name] = {"glb": path.name, "triangles": triangles(obj), "bytes": path.stat().st_size}
        if name != "astronaut_seated":
            render_angles(name, STANDING_ANGLES, target=(0, 0.95, 0), scale=2.8)
        else:
            improved_rover()
            improved_cockpit()
            render_angles("astronaut_seated_rover", SEATED_ANGLES, target=(-0.3, 1.25, -0.1), scale=4.1)
        print(name, manifest[name], flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "astronaut_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
