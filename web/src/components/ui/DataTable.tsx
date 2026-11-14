import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: ReactNode;
  numeric?: boolean;
  unit?: string;
  width?: string;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  selectedKey?: string | null;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}

export function DataTable<T>({ columns, rows, rowKey, caption, selectedKey, onRowClick, empty }: DataTableProps<T>) {
  return (
    <table className="table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={c.numeric ? "num-col" : undefined} style={{ width: c.width }}>
              {c.header}
              {c.unit && <span className="unit"> {c.unit}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="table-empty">
              {empty ?? "No rows"}
            </td>
          </tr>
        )}
        {rows.map((row) => {
          const k = rowKey(row);
          return (
            <tr
              key={k}
              aria-selected={selectedKey === undefined ? undefined : selectedKey === k}
              className={onRowClick ? "clickable" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? "num-col num" : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
