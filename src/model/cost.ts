import { cellsByRoom } from "./layout";
import type { EnergyBreakdown, Layout, LinkReport, RoomReport } from "./types";

// Penalty weights. Tuned so that:
//   - any unsatisfied hard link dominates everything else (~100×).
//   - any room fragmentation (room split into >1 piece) is strictly worse
//     than dropping a single high-weight soft link, so the optimizer never
//     ships layouts that aren't physically buildable in-game.
//   - compactness is a low-magnitude gradient that helps the optimizer
//     pick compact shapes when other costs are tied.
export const HARD_PENALTY = 100_000;
export const SOFT_PENALTY = 1_000;
export const FRAGMENTATION_PENALTY_PER_CELL = 5_000;
export const COMPACTNESS_WEIGHT = 0.5;

interface CostResult {
  energy: EnergyBreakdown;
  linkReports: LinkReport[];
  roomReports: RoomReport[];
}

// Pure: takes a Layout, returns its cost breakdown and reports.
// Does NOT mutate the layout.
export function computeCost(layout: Layout): CostResult {
  const cellsMap = cellsByRoom(layout);

  // --- Link adjacency cost ---
  let adjacency = 0;
  const linkReports: LinkReport[] = [];
  for (const link of layout.links) {
    const cellsA = cellsMap.get(link.a) ?? [];
    const cellsB = cellsMap.get(link.b) ?? [];
    let sharedSides = 0;
    if (cellsA.length > 0 && cellsB.length > 0) {
      const setB = new Set(cellsB.map((c) => `${c.i},${c.j}`));
      for (const a of cellsA) {
        if (setB.has(`${a.i - 1},${a.j}`)) sharedSides += 1;
        if (setB.has(`${a.i + 1},${a.j}`)) sharedSides += 1;
        if (setB.has(`${a.i},${a.j - 1}`)) sharedSides += 1;
        if (setB.has(`${a.i},${a.j + 1}`)) sharedSides += 1;
      }
    }
    const satisfied = sharedSides > 0;
    if (!satisfied) {
      // Flat penalty + manhattan gradient to give the optimizer a "pull"
      // toward the other room even when not yet touching.
      let minManhattan = 0;
      if (cellsA.length > 0 && cellsB.length > 0) {
        minManhattan = Infinity;
        for (const a of cellsA) {
          for (const b of cellsB) {
            const d = Math.abs(a.i - b.i) + Math.abs(a.j - b.j);
            if (d < minManhattan) minManhattan = d;
          }
        }
      }
      const flat = link.hard ? HARD_PENALTY : SOFT_PENALTY;
      adjacency += link.weight * (flat + minManhattan * minManhattan);
    }
    linkReports.push({
      a: link.a,
      b: link.b,
      weight: link.weight,
      hard: link.hard,
      sharedSides,
      satisfied,
    });
  }

  // --- Fragmentation cost + room reports ---
  // For each room with >1 component, every cell outside the largest
  // component costs (manhattan_to_largest + 1) × FRAGMENTATION_PENALTY_PER_CELL.
  let fragmentation = 0;
  const roomReports: RoomReport[] = [];
  for (const room of layout.rooms) {
    const cells = cellsMap.get(room.id) ?? [];
    if (cells.length <= 1) {
      roomReports.push({
        id: room.id,
        name: room.name,
        size: room.size,
        assigned: cells.length,
        components: cells.length === 0 ? 0 : 1,
      });
      continue;
    }
    // Find components.
    const set = new Set(cells.map((c) => `${c.i},${c.j}`));
    const seen = new Set<string>();
    const components: Array<Array<{ i: number; j: number }>> = [];
    for (const start of cells) {
      const key = `${start.i},${start.j}`;
      if (seen.has(key)) continue;
      const comp: Array<{ i: number; j: number }> = [];
      const stack: Array<{ i: number; j: number }> = [start];
      while (stack.length > 0) {
        const { i, j } = stack.pop()!;
        const k = `${i},${j}`;
        if (seen.has(k)) continue;
        seen.add(k);
        comp.push({ i, j });
        for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
          if (set.has(`${ni},${nj}`) && !seen.has(`${ni},${nj}`)) {
            stack.push({ i: ni, j: nj });
          }
        }
      }
      components.push(comp);
    }
    roomReports.push({
      id: room.id,
      name: room.name,
      size: room.size,
      assigned: cells.length,
      components: components.length,
    });
    if (components.length <= 1) continue;
    // Penalize cells outside the largest component.
    let mainIdx = 0;
    for (let k = 1; k < components.length; k += 1) {
      if (components[k].length > components[mainIdx].length) mainIdx = k;
    }
    const main = components[mainIdx];
    for (let k = 0; k < components.length; k += 1) {
      if (k === mainIdx) continue;
      for (const stray of components[k]) {
        let minDist = Infinity;
        for (const m of main) {
          const d = Math.abs(stray.i - m.i) + Math.abs(stray.j - m.j);
          if (d < minDist) minDist = d;
        }
        fragmentation += (minDist + 1) * FRAGMENTATION_PENALTY_PER_CELL;
      }
    }
  }

  // --- Compactness (intra-room squared-distance, normalized) ---
  // Encourages each room's cells to be close together. Low magnitude so it
  // doesn't fight with the bigger adjacency / fragmentation costs.
  let intraEnergy = 0;
  let intraCount = 0;
  for (const room of layout.rooms) {
    const cells = cellsMap.get(room.id) ?? [];
    for (let p = 0; p < cells.length; p += 1) {
      for (let q = p + 1; q < cells.length; q += 1) {
        const di = cells[p].i - cells[q].i;
        const dj = cells[p].j - cells[q].j;
        intraEnergy += di * di + dj * dj;
        intraCount += 1;
      }
    }
  }
  const compactness =
    intraCount === 0 ? 0 : Math.pow(intraEnergy / intraCount, COMPACTNESS_WEIGHT);

  const total = adjacency + fragmentation + compactness;
  return {
    energy: { total, adjacency, fragmentation, compactness },
    linkReports,
    roomReports,
  };
}
