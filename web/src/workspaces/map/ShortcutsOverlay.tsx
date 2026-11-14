import { Modal } from "../../components/ui/Modal";

const KEYS: ReadonlyArray<[string[], string]> = [
  [["Drag", "←↑↓→"], "Pan"],
  [["Wheel", "+", "−"], "Zoom"],
  [["Double-click"], "Zoom in"],
  [["1", "2", "3"], "South, North, Global"],
  [["F"], "Zoom to plan site"],
  [["R"], "Zoom to region"],
  [["S"], "Pick plan site on map"],
  [["Ctrl", "Z"], "Undo"],
  [["M"], "Measure"],
  [["Backspace"], "Remove point"],
  [["Esc"], "Cancel"],
  [["G"], "Graticule"],
  [["L"], "Side panel"],
  [["/"], "Search sites"],
  [["?"], "Keyboard shortcuts"],
];

export function ShortcutsOverlay({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={420}>
      <dl className="map-keys">
        {KEYS.map(([keys, name]) => (
          <div key={name} className="map-keys-row">
            <dt>{name}</dt>
            <dd>
              {keys.map((k) => (
                <kbd key={k} className="kbd">
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
