import { useEffect, useMemo, useRef, useState } from "react";
import { Grid } from "./components/Grid";
import { RoomList } from "./components/RoomList";
import { LinkList } from "./components/LinkList";
import { AdjacencyReport } from "./components/AdjacencyReport";
import { createLateGameVanillaLayout } from "./presets/late-game-vanilla";
import { computeCost } from "./model/cost";
import { addLink, addRoom, cloneLayout, fillUnassignedCells } from "./model/layout";
import type { Layout, RoomId } from "./model/types";
import { loadLayout, saveLayout } from "./app/storage";
import { OptimizerClient } from "./worker/client";

export default function App() {
  const [layout, setLayoutState] = useState<Layout>(() => {
    return loadLayout() ?? createLateGameVanillaLayout();
  });
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [progress, setProgress] = useState<{ iter: number; total: number; energy: number } | null>(null);
  const [message, setMessage] = useState<string>("Listo.");
  const [logs, setLogs] = useState<string[]>([]);
  const clientRef = useRef<OptimizerClient | null>(null);
  if (clientRef.current === null) clientRef.current = new OptimizerClient();

  // Persist on every change.
  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  const cost = useMemo(() => computeCost(layout), [layout]);
  const totalRoomCells = useMemo(() => layout.rooms.reduce((s, r) => s + r.size, 0), [layout]);
  const gridCapacity = layout.size * layout.size;

  const setLayout = (next: Layout) => {
    fillUnassignedCells(next);
    setLayoutState(next);
  };

  const updateRoom = (id: RoomId, patch: Partial<{ name: string; size: number; color: string }>) => {
    const next = cloneLayout(layout);
    const idx = next.rooms.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const oldSize = next.rooms[idx].size;
    next.rooms[idx] = { ...next.rooms[idx], ...patch };
    // If the size shrunk, free the surplus cells of this room before refilling.
    if (patch.size !== undefined && patch.size < oldSize) {
      let toFree = oldSize - patch.size;
      for (let i = next.size - 1; i >= 0 && toFree > 0; i -= 1) {
        for (let j = next.size - 1; j >= 0 && toFree > 0; j -= 1) {
          if (next.cells[i][j].roomId === id) {
            next.cells[i][j].roomId = null;
            toFree -= 1;
          }
        }
      }
    }
    setLayout(next);
  };

  const deleteRoom = (id: RoomId) => {
    const next = cloneLayout(layout);
    next.rooms = next.rooms.filter((r) => r.id !== id);
    next.links = next.links.filter((l) => l.a !== id && l.b !== id);
    for (let i = 0; i < next.size; i += 1) {
      for (let j = 0; j < next.size; j += 1) {
        if (next.cells[i][j].roomId === id) next.cells[i][j].roomId = null;
      }
    }
    setLayout(next);
  };

  const addNewRoom = () => {
    const next = cloneLayout(layout);
    const id = `room-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    addRoom(next, {
      id,
      name: "Nueva sala",
      size: 1,
      color: randomColor(),
    });
    setLayout(next);
  };

  const updateLink = (index: number, patch: Partial<{ a: RoomId; b: RoomId; weight: number; hard: boolean }>) => {
    const next = cloneLayout(layout);
    if (index < 0 || index >= next.links.length) return;
    next.links[index] = { ...next.links[index], ...patch };
    setLayout(next);
  };

  const deleteLink = (index: number) => {
    const next = cloneLayout(layout);
    next.links = next.links.filter((_, i) => i !== index);
    setLayout(next);
  };

  const addNewLink = () => {
    if (layout.rooms.length < 2) return;
    const next = cloneLayout(layout);
    addLink(next, { a: layout.rooms[0].id, b: layout.rooms[1].id, weight: 1, hard: false });
    setLayout(next);
  };

  const runOptimize = async () => {
    if (isOptimizing) return;
    setIsOptimizing(true);
    setProgress({ iter: 0, total: 0, energy: cost.energy.total });
    setLogs([]);
    setMessage("Optimizando...");
    const energyBefore = cost.energy.total;
    try {
      const result = await clientRef.current!.run(layout, {
        onProgress: (info) => {
          setProgress({ iter: info.iteration, total: info.totalIterations, energy: info.bestEnergy });
        },
        onLog: (msg) => {
          setLogs((prev) => [...prev, msg].slice(-30));
        },
      });
      // Only commit if better (defensive — LNS already enforces this).
      if (result.energy <= energyBefore) {
        setLayoutState(result.layout);
        setMessage(`Optimización completada. Energía ${Math.round(energyBefore).toLocaleString("en-US")} → ${Math.round(result.energy).toLocaleString("en-US")} en ${(result.durationMs / 1000).toFixed(1)}s.`);
      } else {
        setMessage(`Optimización completada — la nueva solución no mejora la actual, no se ha aplicado.`);
      }
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsOptimizing(false);
      setProgress(null);
    }
  };

  const cancelOptimize = () => {
    clientRef.current?.cancel();
    setIsOptimizing(false);
    setProgress(null);
    setMessage("Optimización cancelada.");
  };

  const loadPreset = () => {
    if (!confirm("Cargar el preset late-game vainilla? Esto reemplazará tu config actual.")) return;
    setLayout(createLateGameVanillaLayout());
    setMessage("Preset cargado.");
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rimworld-layout-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Layout;
      if (!parsed.size || !parsed.cells || !parsed.rooms || !parsed.links) {
        throw new Error("JSON no válido como Layout");
      }
      fillUnassignedCells(parsed);
      setLayout(parsed);
      setMessage(`Importado layout desde ${file.name}`);
    } catch (err) {
      setMessage(`Error importando: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div style={{
      fontFamily: "system-ui, sans-serif",
      background: "#0a0a0a",
      color: "#ddd",
      minHeight: "100vh",
      padding: 16,
    }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: "1.4rem" }}>RimWorld Layout Optimizer</h1>
        <span style={{ fontSize: 12, color: "#888" }}>v2 · LNS optimizer</span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 420px)", gap: 24 }}>
        <main>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <button
              onClick={runOptimize}
              disabled={isOptimizing || layout.rooms.length === 0}
              style={{ padding: "8px 16px", background: "#2a4a2a", color: "#fff", border: "1px solid #3a6a3a", borderRadius: 4, fontWeight: 600 }}
            >
              {isOptimizing && progress
                ? `Optimizando... ${progress.iter}/${progress.total}`
                : "Optimize"}
            </button>
            {isOptimizing && (
              <button onClick={cancelOptimize} style={{ padding: "8px 16px" }}>Cancelar</button>
            )}
            <button onClick={loadPreset} disabled={isOptimizing}>Cargar preset: late-game vainilla</button>
            <button onClick={exportJson} disabled={isOptimizing}>Exportar JSON</button>
            <label style={{ padding: "6px 10px", background: "#222", border: "1px solid #333", borderRadius: 4, cursor: "pointer" }}>
              Importar JSON
              <input
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJson(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "center" }}>
            <Grid layout={layout} />
          </div>

          <div style={{ marginTop: 12, padding: "8px 12px", background: "#1a1a1a", borderRadius: 4 }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              <strong>Energía:</strong> {Math.round(cost.energy.total).toLocaleString("en-US")}
              <span style={{ color: "#888", marginLeft: 8 }}>
                (adj: {Math.round(cost.energy.adjacency).toLocaleString("en-US")},
                {" "}frag: {Math.round(cost.energy.fragmentation).toLocaleString("en-US")},
                {" "}compact: {Math.round(cost.energy.compactness).toLocaleString("en-US")})
              </span>
            </p>
            <p style={{ margin: "4px 0 0 0", fontSize: 13 }}>
              <strong>Grid:</strong> {layout.size}×{layout.size} = {gridCapacity} celdas · usadas por salas: {totalRoomCells} · libres: {gridCapacity - totalRoomCells}
            </p>
            <p style={{ margin: "4px 0 0 0", fontSize: 13, color: message.startsWith("Error") ? "#ff5555" : "#888" }}>
              {message}
            </p>
          </div>

          <AdjacencyReport layout={layout} reports={cost.linkReports} />

          {logs.length > 0 && (
            <details style={{ marginTop: 12, fontSize: 11, color: "#888" }}>
              <summary style={{ cursor: "pointer" }}>Log del optimizer ({logs.length})</summary>
              <pre style={{ background: "#1a1a1a", padding: 8, borderRadius: 4, overflow: "auto", maxHeight: 200, fontSize: 11, color: "#ccc" }}>
                {logs.join("\n")}
              </pre>
            </details>
          )}
        </main>

        <aside style={{ overflowY: "auto", maxHeight: "calc(100vh - 80px)" }}>
          <RoomList
            layout={layout}
            reports={cost.roomReports}
            onChange={updateRoom}
            onDelete={deleteRoom}
            onAdd={addNewRoom}
          />
          <div style={{ marginTop: 16 }}>
            <LinkList
              layout={layout}
              reports={cost.linkReports}
              onChange={updateLink}
              onDelete={deleteLink}
              onAdd={addNewLink}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function randomColor(): string {
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `#${hex}`;
}
