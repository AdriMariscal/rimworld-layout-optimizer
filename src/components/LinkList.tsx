import type { Layout, LinkReport, RoomId } from "../model/types";

interface LinkListProps {
  layout: Layout;
  reports: LinkReport[];
  onChange: (index: number, patch: Partial<{ a: RoomId; b: RoomId; weight: number; hard: boolean }>) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}

export function LinkList({ layout, reports, onChange, onDelete, onAdd }: LinkListProps) {
  const nameById = new Map(layout.rooms.map((r) => [r.id, r.name]));
  return (
    <div className="link-list">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Links ({layout.links.length})</h2>
        <button onClick={onAdd} disabled={layout.rooms.length < 2}>+ Añadir link</button>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {layout.links.map((link, idx) => {
          const report = reports[idx];
          return (
            <div
              key={idx}
              className="link-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 70px 50px 90px auto",
                gap: 6,
                alignItems: "center",
                background: "#1a1a1a",
                padding: "4px 8px",
                borderRadius: 3,
              }}
            >
              <select
                value={link.a}
                onChange={(e) => onChange(idx, { a: e.target.value })}
                style={{ background: "#0f0f0f", color: "#ddd", border: "1px solid #333", padding: "2px 4px", borderRadius: 3 }}
              >
                {layout.rooms.map((r) => (
                  <option key={r.id} value={r.id}>{nameById.get(r.id)}</option>
                ))}
              </select>
              <select
                value={link.b}
                onChange={(e) => onChange(idx, { b: e.target.value })}
                style={{ background: "#0f0f0f", color: "#ddd", border: "1px solid #333", padding: "2px 4px", borderRadius: 3 }}
              >
                {layout.rooms.map((r) => (
                  <option key={r.id} value={r.id}>{nameById.get(r.id)}</option>
                ))}
              </select>
              <input
                type="number"
                value={link.weight}
                step={0.5}
                min={0}
                onChange={(e) => onChange(idx, { weight: Math.max(0, Number(e.target.value)) })}
                style={{ background: "#0f0f0f", color: "#ddd", border: "1px solid #333", padding: "2px 4px", borderRadius: 3 }}
                title="Peso"
              />
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={link.hard}
                  onChange={(e) => onChange(idx, { hard: e.target.checked })}
                /> hard
              </label>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "monospace",
                  color: report?.satisfied ? "#5fcf5f" : link.hard ? "#ff5555" : "#d99000",
                }}
                title={report?.satisfied ? `${report.sharedSides} shared sides` : "no adjacent"}
              >
                {report?.satisfied ? `✓ ${report.sharedSides}` : "✗ no adj"}
              </span>
              <button
                onClick={() => onDelete(idx)}
                style={{ background: "#3a1f1f", color: "#fff", border: "1px solid #5a2f2f", borderRadius: 3, padding: "2px 6px" }}
                title="Borrar link"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
