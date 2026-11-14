import { parseUtc, toIsoUtc } from "../../lib/time";
import type { TransferRow } from "../types";

export interface ParsedTransfer {
  rows: TransferRow[];
  errors: string[];
}

export function parseTransferTable(text: string): ParsedTransfer {
  const rows: TransferRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  let first = true;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const launch = cells[0] ? parseUtc(cells[0]) : null;
    const landing = cells[1] ? parseUtc(cells[1]) : null;
    if (first && launch === null && landing === null) {
      first = false;
      return;
    }
    first = false;
    if (cells.length < 2) return void errors.push(`Line ${i + 1}: expected "launch, landing".`);
    if (launch === null) return void errors.push(`Line ${i + 1}: “${cells[0]}” is not a UTC date and time.`);
    if (landing === null) return void errors.push(`Line ${i + 1}: “${cells[1]}” is not a UTC date and time.`);
    if (landing <= launch) return void errors.push(`Line ${i + 1}: landing is not after launch.`);
    const prev = rows[rows.length - 1];
    if (prev && launch <= (parseUtc(prev.launch_utc) ?? -Infinity)) return void errors.push(`Line ${i + 1}: launches must be strictly increasing.`);
    rows.push({ launch_utc: toIsoUtc(launch), landing_utc: toIsoUtc(landing) });
  });
  if (rows.length === 0 && errors.length === 0) errors.push("No rows found.");
  return { rows, errors };
}
