import type { Layout } from "../model/types";

interface GridProps {
  layout: Layout;
}

export function Grid({ layout }: GridProps) {
  const colorById = new Map(layout.rooms.map((r) => [r.id, r.color]));
  const nameById = new Map(layout.rooms.map((r) => [r.id, r.name]));

  return (
    <div
      className="grid"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${layout.size}, 1fr)`,
        gap: 2,
        aspectRatio: "1 / 1",
        maxWidth: "min(900px, 90vw)",
      }}
    >
      {layout.cells.flatMap((row, i) =>
        row.map((cell, j) => {
          const color = cell.roomId ? colorById.get(cell.roomId) ?? "#222" : "#1a1a1a";
          const label = cell.roomId ? nameById.get(cell.roomId) ?? "?" : "";
          // Compute black or white text by perceived luminance.
          const text = pickTextColor(color);
          return (
            <div
              key={`${i}-${j}`}
              className="grid-cell"
              style={{
                background: color,
                color: text,
                aspectRatio: "1 / 1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.65rem",
                lineHeight: 1.05,
                padding: 2,
                textAlign: "center",
                overflow: "hidden",
                border: cell.roomId ? "none" : "1px dashed #333",
              }}
              title={`(${i}, ${j}) — ${label || "vacía"}`}
            >
              {label}
            </div>
          );
        }),
      )}
    </div>
  );
}

function pickTextColor(hex: string): string {
  // Quick perceived luminance from a #rrggbb string.
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return "#fff";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#111" : "#fff";
}
