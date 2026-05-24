import type { Layout, RoomReport } from "../model/types";

interface RoomListProps {
  layout: Layout;
  reports: RoomReport[];
  onChange: (id: string, patch: Partial<{ name: string; size: number; color: string }>) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

export function RoomList({ layout, reports, onChange, onDelete, onAdd }: RoomListProps) {
  const reportById = new Map(reports.map((r) => [r.id, r]));
  return (
    <div className="room-list">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Salas ({layout.rooms.length})</h2>
        <button onClick={onAdd}>+ Añadir sala</button>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {layout.rooms.map((room) => {
          const report = reportById.get(room.id);
          const undersized = report ? report.assigned < room.size : false;
          const noSize = room.size <= 0;
          const fragmented = report ? report.components > 1 : false;
          return (
            <div
              key={room.id}
              className="room-row"
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr 80px 60px auto",
                gap: 6,
                alignItems: "center",
                background: "#1a1a1a",
                padding: "6px 8px",
                borderRadius: 4,
                borderLeft: `4px solid ${room.color}`,
              }}
            >
              <input
                type="color"
                value={room.color}
                onChange={(e) => onChange(room.id, { color: e.target.value })}
                style={{ width: 32, height: 28, border: "none", background: "transparent" }}
                title="Color"
              />
              <input
                type="text"
                value={room.name}
                onChange={(e) => onChange(room.id, { name: e.target.value })}
                placeholder="Nombre"
                style={{ background: "#0f0f0f", color: "#ddd", border: "1px solid #333", padding: "4px 6px", borderRadius: 3 }}
              />
              <input
                type="number"
                value={room.size}
                min={0}
                onChange={(e) => onChange(room.id, { size: Math.max(0, Number(e.target.value)) })}
                style={{ background: "#0f0f0f", color: "#ddd", border: "1px solid #333", padding: "4px 6px", borderRadius: 3, width: 70 }}
                title="Número de celdas"
              />
              <span style={{ fontSize: 12, color: report ? "#888" : "#666", fontFamily: "monospace" }}>
                {report ? `${report.assigned}/${room.size}` : `?/${room.size}`}
              </span>
              <button
                onClick={() => {
                  if (confirm(`Borrar la sala "${room.name}"? También se borrarán sus links.`)) {
                    onDelete(room.id);
                  }
                }}
                style={{ background: "#3a1f1f", color: "#fff", border: "1px solid #5a2f2f", borderRadius: 3, padding: "4px 8px" }}
                title="Borrar sala"
              >
                ✕
              </button>
              {(noSize || undersized || fragmented) && (
                <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#ff7373", marginTop: 2 }}>
                  {noSize && "⚠ Sin tamaño — no aparecerá en el layout. "}
                  {undersized && `⚠ Solo ${report?.assigned}/${room.size} celdas asignadas. `}
                  {fragmented && `⚠ Sala dividida en ${report?.components} piezas.`}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
