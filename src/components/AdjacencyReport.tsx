import type { Layout, LinkReport } from "../model/types";

interface AdjacencyReportProps {
  layout: Layout;
  reports: LinkReport[];
}

export function AdjacencyReport({ layout, reports }: AdjacencyReportProps) {
  if (reports.length === 0) return null;
  const nameById = new Map(layout.rooms.map((r) => [r.id, r.name]));
  const satisfied = reports.filter((r) => r.satisfied).length;
  const unsat = reports.filter((r) => !r.satisfied);
  const unsatHard = unsat.filter((r) => r.hard);

  return (
    <div className="adjacency-report" style={{ marginTop: 12 }}>
      <h3 style={{ margin: "0 0 4px 0" }}>Adjacency Report</h3>
      <p style={{ margin: 0, fontSize: 13 }}>
        {satisfied}/{reports.length} links satisfechos
        {unsatHard.length > 0 && (
          <span style={{ color: "#ff5555", marginLeft: 8 }}>
            ⚠ {unsatHard.length} HARD sin satisfacer
          </span>
        )}
      </p>
      {unsat.length > 0 && (
        <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, fontSize: 12 }}>
          {unsat.map((r, i) => (
            <li
              key={i}
              style={{ color: r.hard ? "#ff5555" : "#d99000", marginBottom: 2 }}
            >
              {r.hard && <strong>[HARD] </strong>}
              {nameById.get(r.a)} ↔ {nameById.get(r.b)} (peso {r.weight})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
