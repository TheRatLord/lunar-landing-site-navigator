import { useId, useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { parseLatLon, type LatLonResult } from "../../lib/coords";
import { polarInverse, type Hemisphere } from "../../lib/projection";

const N = String.raw`[+\-−]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?`;
const LABELLED = new RegExp(String.raw`^x\s*[=:]?\s*(${N})\s*m?\s*[,;\s]\s*y\s*[=:]?\s*(${N})\s*m?$`, "i");
const PAIR = new RegExp(String.raw`^(${N})\s*(m)?\s*[,;\s]\s*(${N})\s*(m)?$`, "i");

const toNum = (s: string): number => Number(s.replace("−", "-"));

function parseCoordEntry(text: string, hemisphere: Hemisphere | null): LatLonResult {
  const t = text.trim();
  if (t === "") return { ok: false, error: "Enter latitude, longitude or polar x, y" };
  const fromMetres = (x: number, y: number): LatLonResult => {
    if (!hemisphere) return { ok: false, error: "Polar x, y need the South or North polar view" };
    const r = polarInverse(hemisphere, x, y);
    return { ok: true, lat: r.lat_deg, lon: r.lon_deg };
  };
  const lab = LABELLED.exec(t);
  if (lab) return fromMetres(toNum(lab[1]!), toNum(lab[2]!));
  const pair = PAIR.exec(t);
  if (pair && (pair[2] || pair[4] || Math.abs(toNum(pair[1]!)) > 90 || Math.abs(toNum(pair[3]!)) > 360)) {
    return fromMetres(toNum(pair[1]!), toNum(pair[3]!));
  }
  const ll = parseLatLon(t);
  return ll;
}

export function CoordinateEntry({ hemisphere, onGo }: { hemisphere: Hemisphere | null; onGo(lat: number, lon: number): void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="map-goto"
      role="search"
      aria-label="Go to coordinates"
      onSubmit={(e) => {
        e.preventDefault();
        const r = parseCoordEntry(text, hemisphere);
        if (!r.ok) return setError(r.error);
        setError(null);
        onGo(r.lat, r.lon);
      }}
    >
      <Icon name="pin" size={14} />
      <input
        id={id}
        className="map-goto-input"
        value={text}
        placeholder={hemisphere ? "lat, lon  or  x, y" : "lat, lon"}
        aria-label={hemisphere ? "Go to latitude, longitude or polar x, y in metres" : "Go to latitude, longitude"}
        aria-invalid={error !== null}
        aria-describedby={error ? `-err` : undefined}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
      />
      {error && (
        <span id={`-err`} className="map-goto-err" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
