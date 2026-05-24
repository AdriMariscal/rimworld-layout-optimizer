import { cellsByRoom, cloneLayout, fillUnassignedCells } from "../model/layout";
import { computeCost } from "../model/cost";
import type { Layout, Room, RoomId } from "../model/types";

// Large Neighborhood Search optimizer.
//
// Each iteration:
//   1. DESTROY: pick k rooms whose links are mostly unsatisfied (plus a
//      few random rooms for exploration) and clear their assigned cells.
//   2. REPAIR: for each removed room (most-constrained first), grow a
//      4-connected region of cells that maximizes that room's link-adjacency
//      score. Place the room there.
//   3. ACCEPT: keep the new layout iff its total energy strictly improves.
//
// Why LNS over SA's single-cell swaps: when a room (e.g. a 3-cell dormitory)
// is in the wrong corner of the grid, moving it next to its linked rooms
// requires migrating all 3 cells coordinated. SA's pairwise swaps would
// have to pass through fragmented intermediate states (very high energy)
// and almost always rejects them. LNS sidesteps this by treating "remove
// and re-place a whole room" as a single move.

export interface LnsOptions {
  iterations?: number;       // iterations per restart
  restarts?: number;         // number of restarts; each starts from a different seed
  destroyCount?: number;     // base number of rooms destroyed per iteration
  seedSamples?: number;      // upper bound on seed cells tried per room placement
  onProgress?: (info: ProgressInfo) => void;
  signal?: AbortSignal;
  log?: (msg: string) => void;
}

export interface ProgressInfo {
  iteration: number;
  totalIterations: number;
  bestEnergy: number;
  improved: boolean;
}

export interface LnsResult {
  layout: Layout;
  energy: number;
  iterations: number;
  improvements: number;
}

const NEIGHBOR_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

const HARD_SCORE_WEIGHT = 100; // hard-link satisfaction worth 100× a soft of weight 1

export async function optimize(initial: Layout, opts: LnsOptions = {}): Promise<LnsResult> {
  const iterations = opts.iterations ?? 800;
  const restarts = opts.restarts ?? 3;
  const log = opts.log;

  // Start from a clean greedy fill as the global best.
  let globalBest = cloneLayout(initial);
  fillUnassignedCells(globalBest);
  let globalBestEnergy = computeCost(globalBest).energy.total;
  let totalImprovements = 0;

  log?.(`[lns] start: ${restarts} restarts × ${iterations} iter; initial energy=${Math.round(globalBestEnergy).toLocaleString("en-US")}`);

  for (let restart = 0; restart < restarts; restart += 1) {
    if (opts.signal?.aborted) break;
    // Restart 0 starts from the raw initial. Subsequent restarts start from
    // a randomized assignment to explore a different basin.
    const seed = restart === 0 ? globalBest : randomizeAssignments(cloneLayout(initial));
    const result = await runOneRestart(seed, iterations, opts);
    totalImprovements += result.improvements;
    if (result.energy < globalBestEnergy) {
      globalBest = result.layout;
      globalBestEnergy = result.energy;
      log?.(`[lns] restart ${restart + 1}/${restarts}: energy=${Math.round(result.energy).toLocaleString("en-US")} ↓`);
    } else {
      log?.(`[lns] restart ${restart + 1}/${restarts}: energy=${Math.round(result.energy).toLocaleString("en-US")} (best=${Math.round(globalBestEnergy).toLocaleString("en-US")})`);
    }
  }

  // --- Greedy polish: deterministic 2-swap + 3-cycle passes --------------
  const polished = greedyPolish(globalBest);
  if (polished.swaps > 0 || polished.threeCycles > 0) {
    globalBestEnergy = computeCost(globalBest).energy.total;
    log?.(`[lns] greedy polish: ${polished.swaps} swap(s) + ${polished.threeCycles} 3-cycle(s) in ${polished.passes} pass(es)`);
  }

  log?.(`[lns] done: ${totalImprovements} improvements total; final energy=${Math.round(globalBestEnergy).toLocaleString("en-US")}`);

  return { layout: globalBest, energy: globalBestEnergy, iterations, improvements: totalImprovements };
}

// Randomize cell assignments while respecting allowedRoomIds and each room's
// required size. Used as fresh seed for additional restarts.
function randomizeAssignments(layout: Layout): Layout {
  // Build the queue of room slots (each roomId repeated `size` times).
  const queue: string[] = [];
  for (const room of layout.rooms) {
    for (let k = 0; k < room.size; k += 1) queue.push(room.id);
  }
  // Shuffle the queue.
  for (let i = queue.length - 1; i > 0; i -= 1) {
    const j = (Math.random() * (i + 1)) | 0;
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  // Clear assignments.
  for (const row of layout.cells) for (const c of row) c.roomId = null;
  // Pick random cell positions until each room is fully placed.
  const positions: Array<{ i: number; j: number }> = [];
  for (let i = 0; i < layout.size; i += 1) {
    for (let j = 0; j < layout.size; j += 1) positions.push({ i, j });
  }
  for (let i = positions.length - 1; i > 0; i -= 1) {
    const j = (Math.random() * (i + 1)) | 0;
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  let q = 0;
  for (const { i, j } of positions) {
    if (q >= queue.length) break;
    const cell = layout.cells[i][j];
    if (cell.allowedRoomIds && !cell.allowedRoomIds.includes(queue[q])) continue;
    cell.roomId = queue[q];
    q += 1;
  }
  return layout;
}

interface RestartResult {
  layout: Layout;
  energy: number;
  improvements: number;
}

async function runOneRestart(seed: Layout, iterations: number, opts: LnsOptions): Promise<RestartResult> {
  const destroyBase = opts.destroyCount ?? 4;
  const seedSamples = opts.seedSamples ?? 25;

  let best = cloneLayout(seed);
  let bestEnergy = computeCost(best).energy.total;
  let improvements = 0;
  let stale = 0;
  let lastReport = 0;

  for (let iter = 0; iter < iterations; iter += 1) {
    if (opts.signal?.aborted) {
      opts.log?.(`[lns] aborted at iter ${iter}`);
      break;
    }

    // Adaptive destroy count: more rooms when stuck (broader exploration).
    const k = Math.min(best.rooms.length, destroyBase + Math.floor(stale / 8));

    const candidate = cloneLayout(best);
    const removed = pickRoomsToDestroy(candidate, k);
    const removedIds = new Set(removed.map((r) => r.id));

    // Clear the cells of the removed rooms.
    for (let i = 0; i < candidate.size; i += 1) {
      for (let j = 0; j < candidate.size; j += 1) {
        const id = candidate.cells[i][j].roomId;
        if (id !== null && removedIds.has(id)) candidate.cells[i][j].roomId = null;
      }
    }

    // Re-place each removed room. Most-constrained first (most hard links).
    const ordered = orderByHardLinkCount(removed, candidate);
    let repairOk = true;
    for (const room of ordered) {
      const region = findBestRegion(candidate, room, seedSamples);
      if (!region) {
        repairOk = false;
        break;
      }
      for (const { i, j } of region) candidate.cells[i][j].roomId = room.id;
    }

    if (!repairOk) {
      stale += 1;
      continue;
    }

    const candidateEnergy = computeCost(candidate).energy.total;
    const improved = candidateEnergy < bestEnergy;
    if (improved) {
      best = candidate;
      bestEnergy = candidateEnergy;
      improvements += 1;
      stale = 0;
    } else {
      stale += 1;
    }

    if (opts.onProgress && (iter - lastReport >= 5 || improved)) {
      opts.onProgress({
        iteration: iter + 1,
        totalIterations: iterations,
        bestEnergy,
        improved,
      });
      lastReport = iter;
      // Yield to the event loop so a UI can repaint.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return { layout: best, energy: bestEnergy, improvements };
}

// Try every (i,j) cell pair and accept any swap that strictly lowers energy.
// Then try 3-cycles among geographically close triples. Repeat until no
// improvement is found in a full pass.
function greedyPolish(layout: Layout): { passes: number; swaps: number; threeCycles: number } {
  // Collect swappable cell coordinates (those with no allowedRoomIds
  // restriction, or with multiple allowed roomIds).
  const swappable: Array<{ i: number; j: number }> = [];
  for (let i = 0; i < layout.size; i += 1) {
    for (let j = 0; j < layout.size; j += 1) {
      const cell = layout.cells[i][j];
      if (cell.allowedRoomIds && cell.allowedRoomIds.length <= 1) continue;
      swappable.push({ i, j });
    }
  }
  if (swappable.length < 2) return { passes: 0, swaps: 0, threeCycles: 0 };

  let totalSwaps = 0;
  let totalThreeCycles = 0;
  let passes = 0;
  let improved = true;
  while (improved && passes < 8) {
    improved = false;
    passes += 1;
    let currentEnergy = computeCost(layout).energy.total;
    // --- Pass A: 2-swap until no pairwise improvement ---
    for (let p = 0; p < swappable.length; p += 1) {
      for (let q = p + 1; q < swappable.length; q += 1) {
        const a = swappable[p];
        const b = swappable[q];
        const cellA = layout.cells[a.i][a.j];
        const cellB = layout.cells[b.i][b.j];
        const rA = cellA.roomId;
        const rB = cellB.roomId;
        if (rA === rB) continue;
        if (cellA.allowedRoomIds && rB !== null && !cellA.allowedRoomIds.includes(rB)) continue;
        if (cellB.allowedRoomIds && rA !== null && !cellB.allowedRoomIds.includes(rA)) continue;
        cellA.roomId = rB;
        cellB.roomId = rA;
        const newEnergy = computeCost(layout).energy.total;
        if (newEnergy < currentEnergy) {
          currentEnergy = newEnergy;
          totalSwaps += 1;
          improved = true;
        } else {
          cellA.roomId = rA;
          cellB.roomId = rB;
        }
      }
    }
    // --- Pass B: 3-cycle moves on geographically-close triples ---
    // Triples whose 3 cells lie within manhattan diameter 4 of each other.
    // Bounded so we don't pay O(N³) on the full grid.
    const TRIPLE_DIAMETER = 4;
    for (let p = 0; p < swappable.length; p += 1) {
      for (let q = p + 1; q < swappable.length; q += 1) {
        const a = swappable[p];
        const b = swappable[q];
        if (Math.abs(a.i - b.i) + Math.abs(a.j - b.j) > TRIPLE_DIAMETER) continue;
        for (let r = q + 1; r < swappable.length; r += 1) {
          const c = swappable[r];
          if (Math.abs(a.i - c.i) + Math.abs(a.j - c.j) > TRIPLE_DIAMETER) continue;
          if (Math.abs(b.i - c.i) + Math.abs(b.j - c.j) > TRIPLE_DIAMETER) continue;
          const cellA = layout.cells[a.i][a.j];
          const cellB = layout.cells[b.i][b.j];
          const cellC = layout.cells[c.i][c.j];
          const rA = cellA.roomId;
          const rB = cellB.roomId;
          const rC = cellC.roomId;
          if (rA === rB || rB === rC || rA === rC) continue;
          // Try cycle 1: A←rC, B←rA, C←rB
          if (
            (rC === null || !cellA.allowedRoomIds || cellA.allowedRoomIds.includes(rC)) &&
            (rA === null || !cellB.allowedRoomIds || cellB.allowedRoomIds.includes(rA)) &&
            (rB === null || !cellC.allowedRoomIds || cellC.allowedRoomIds.includes(rB))
          ) {
            cellA.roomId = rC;
            cellB.roomId = rA;
            cellC.roomId = rB;
            const newEnergy = computeCost(layout).energy.total;
            if (newEnergy < currentEnergy) {
              currentEnergy = newEnergy;
              totalThreeCycles += 1;
              improved = true;
              continue;
            }
            cellA.roomId = rA;
            cellB.roomId = rB;
            cellC.roomId = rC;
          }
          // Try cycle 2: A←rB, B←rC, C←rA
          if (
            (rB === null || !cellA.allowedRoomIds || cellA.allowedRoomIds.includes(rB)) &&
            (rC === null || !cellB.allowedRoomIds || cellB.allowedRoomIds.includes(rC)) &&
            (rA === null || !cellC.allowedRoomIds || cellC.allowedRoomIds.includes(rA))
          ) {
            cellA.roomId = rB;
            cellB.roomId = rC;
            cellC.roomId = rA;
            const newEnergy = computeCost(layout).energy.total;
            if (newEnergy < currentEnergy) {
              currentEnergy = newEnergy;
              totalThreeCycles += 1;
              improved = true;
              continue;
            }
            cellA.roomId = rA;
            cellB.roomId = rB;
            cellC.roomId = rC;
          }
        }
      }
    }
  }
  return { passes, swaps: totalSwaps, threeCycles: totalThreeCycles };
}

// --- Destroy helpers ---------------------------------------------------------

function pickRoomsToDestroy(layout: Layout, count: number): Room[] {
  if (count >= layout.rooms.length) return [...layout.rooms];

  const picked = pickProblematicRooms(layout, count);
  // Expand by 1 level along hard links: if a destroyed room has hard partners,
  // destroy them too. Otherwise, re-placing the room is constrained by a
  // stationary partner that may be in a bad position, causing local-minimum
  // lock-in on hard adjacencies that span "compatible" sub-regions.
  return expandWithHardPartners(layout, picked);
}

// Expand the destroy set with hard-linked partners, transitively, up to a
// cap. Destroying an entire hard-link cluster together lets the repair
// re-arrange the whole cluster from scratch instead of having to fit a
// single room next to a stationary partner in a bad spot.
const MAX_DESTROY_SET = 12;

function expandWithHardPartners(layout: Layout, picked: Room[]): Room[] {
  const ids = new Set(picked.map((r) => r.id));
  const queue: Room[] = [...picked];
  const result: Room[] = [...picked];
  while (queue.length > 0 && result.length < MAX_DESTROY_SET) {
    const room = queue.shift()!;
    for (const link of layout.links) {
      if (!link.hard) continue;
      const otherId = link.a === room.id ? link.b : link.b === room.id ? link.a : null;
      if (otherId === null || ids.has(otherId)) continue;
      const other = layout.rooms.find((r) => r.id === otherId);
      if (other) {
        result.push(other);
        ids.add(otherId);
        queue.push(other);
        if (result.length >= MAX_DESTROY_SET) break;
      }
    }
  }
  return result;
}

function pickProblematicRooms(layout: Layout, count: number): Room[] {

  // Score each room by how much "problem" it accumulates: weighted sum of
  // its unsatisfied links, hard counts heavier.
  const cellsMap = cellsByRoom(layout);
  const score = new Map<RoomId, number>();
  for (const room of layout.rooms) score.set(room.id, 0);

  for (const link of layout.links) {
    const cellsA = cellsMap.get(link.a) ?? [];
    const cellsB = cellsMap.get(link.b) ?? [];
    if (cellsA.length === 0 || cellsB.length === 0) continue;
    const setB = new Set(cellsB.map((c) => `${c.i},${c.j}`));
    let satisfied = false;
    for (const a of cellsA) {
      if (
        setB.has(`${a.i - 1},${a.j}`) ||
        setB.has(`${a.i + 1},${a.j}`) ||
        setB.has(`${a.i},${a.j - 1}`) ||
        setB.has(`${a.i},${a.j + 1}`)
      ) {
        satisfied = true;
        break;
      }
    }
    if (!satisfied) {
      const w = link.weight * (link.hard ? HARD_SCORE_WEIGHT : 1);
      score.set(link.a, (score.get(link.a) ?? 0) + w);
      score.set(link.b, (score.get(link.b) ?? 0) + w);
    }
  }

  // ~70% from highest-scoring (problematic) rooms, ~30% random for exploration.
  const sorted = [...layout.rooms].sort(
    (a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0),
  );
  const fromProblematic = Math.ceil(count * 0.7);
  const fromRandom = count - fromProblematic;

  const picked: Room[] = sorted.slice(0, Math.min(fromProblematic, sorted.length));
  const remaining = sorted.slice(picked.length);
  for (let i = 0; i < fromRandom && remaining.length > 0; i += 1) {
    const idx = (Math.random() * remaining.length) | 0;
    picked.push(remaining.splice(idx, 1)[0]);
  }
  return picked;
}

function orderByHardLinkCount(rooms: Room[], layout: Layout): Room[] {
  const count = new Map<RoomId, number>();
  for (const room of rooms) count.set(room.id, 0);
  for (const link of layout.links) {
    if (!link.hard) continue;
    if (count.has(link.a)) count.set(link.a, (count.get(link.a) ?? 0) + 1);
    if (count.has(link.b)) count.set(link.b, (count.get(link.b) ?? 0) + 1);
  }
  return [...rooms].sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0));
}

// Check that every hard link of `room`, whose other endpoint is already
// placed in `layout`, has at least one shared wall between `region` and
// the other endpoint's cells. Returns true if all such hards are satisfied.
function hardsSatisfiedForRoom(
  layout: Layout,
  room: Room,
  region: Array<{ i: number; j: number }>,
): boolean {
  const regionSet = new Set(region.map((c) => `${c.i},${c.j}`));
  const cellsMap = cellsByRoom(layout);
  for (const link of layout.links) {
    if (!link.hard) continue;
    const otherId = link.a === room.id ? link.b : link.b === room.id ? link.a : null;
    if (otherId === null) continue;
    const otherCells = cellsMap.get(otherId);
    if (!otherCells || otherCells.length === 0) continue; // partner not placed yet
    let touches = false;
    for (const o of otherCells) {
      if (
        regionSet.has(`${o.i - 1},${o.j}`) ||
        regionSet.has(`${o.i + 1},${o.j}`) ||
        regionSet.has(`${o.i},${o.j - 1}`) ||
        regionSet.has(`${o.i},${o.j + 1}`)
      ) {
        touches = true;
        break;
      }
    }
    if (!touches) return false;
  }
  return true;
}

// --- Repair helpers ----------------------------------------------------------

function findBestRegion(
  layout: Layout,
  room: Room,
  seedSamples: number,
): Array<{ i: number; j: number }> | null {
  const freeCells: Array<{ i: number; j: number }> = [];
  for (let i = 0; i < layout.size; i += 1) {
    for (let j = 0; j < layout.size; j += 1) {
      if (layout.cells[i][j].roomId === null) freeCells.push({ i, j });
    }
  }
  if (freeCells.length < room.size) return null;

  // Sample seeds (cap to seedSamples for speed on large grids).
  const seeds = freeCells.length > seedSamples ? sampleSeeds(freeCells, seedSamples) : freeCells;

  const freeSet = new Set(freeCells.map((c) => `${c.i},${c.j}`));

  let bestRegion: Array<{ i: number; j: number }> | null = null;
  let bestScore = -Infinity;

  for (const seed of seeds) {
    const region = growRegion(layout, seed, room, freeSet);
    if (region && region.length === room.size) {
      const score = scoreRegion(layout, room, region);
      if (score > bestScore) {
        bestScore = score;
        bestRegion = region;
      }
    }
  }

  // Fallback: if no region grew to size (rare with enough free cells),
  // just take the first `room.size` free cells in row-major order.
  if (bestRegion === null && freeCells.length >= room.size) {
    bestRegion = freeCells.slice(0, room.size);
  }

  return bestRegion;
}

function sampleSeeds(
  cells: Array<{ i: number; j: number }>,
  n: number,
): Array<{ i: number; j: number }> {
  const pool = [...cells];
  const out: Array<{ i: number; j: number }> = [];
  while (out.length < n && pool.length > 0) {
    const idx = (Math.random() * pool.length) | 0;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

// Greedily grow a 4-connected region from `seed`, adding the candidate cell
// that maximizes the link-satisfaction score for `room` at each step.
function growRegion(
  layout: Layout,
  seed: { i: number; j: number },
  room: Room,
  freeSet: Set<string>,
): Array<{ i: number; j: number }> | null {
  const region: Array<{ i: number; j: number }> = [seed];
  const inRegion = new Set([`${seed.i},${seed.j}`]);
  const candidates = new Set<string>();
  for (const [di, dj] of NEIGHBOR_OFFSETS) {
    const k = `${seed.i + di},${seed.j + dj}`;
    if (freeSet.has(k) && !inRegion.has(k)) candidates.add(k);
  }

  while (region.length < room.size && candidates.size > 0) {
    let bestCand: { i: number; j: number } | null = null;
    let bestCandScore = -Infinity;
    for (const k of candidates) {
      const [i, j] = k.split(",").map(Number);
      const score = scoreCellForRoom(layout, room, { i, j });
      if (score > bestCandScore) {
        bestCandScore = score;
        bestCand = { i, j };
      }
    }
    if (bestCand === null) break;
    region.push(bestCand);
    inRegion.add(`${bestCand.i},${bestCand.j}`);
    candidates.delete(`${bestCand.i},${bestCand.j}`);
    for (const [di, dj] of NEIGHBOR_OFFSETS) {
      const k = `${bestCand.i + di},${bestCand.j + dj}`;
      if (freeSet.has(k) && !inRegion.has(k)) candidates.add(k);
    }
  }

  return region.length === room.size ? region : null;
}

// Score for placing `room` at `region`. Hard links carry an enormous
// reward when satisfied and an equally enormous penalty when missed
// (only if the partner is already placed — otherwise we can't evaluate).
// Soft links contribute their weight. This makes findBestRegion strongly
// prefer regions that satisfy hards.
const HARD_SCORE_REWARD = 1_000_000;

function scoreRegion(
  layout: Layout,
  room: Room,
  region: Array<{ i: number; j: number }>,
): number {
  const inRegion = new Set(region.map((c) => `${c.i},${c.j}`));
  let score = 0;
  for (const link of layout.links) {
    const otherId = link.a === room.id ? link.b : link.b === room.id ? link.a : null;
    if (otherId === null) continue;
    // Does the partner exist on the grid right now?
    let partnerPresent = false;
    let touches = false;
    for (let i = 0; i < layout.size; i += 1) {
      for (let j = 0; j < layout.size; j += 1) {
        if (layout.cells[i][j].roomId !== otherId) continue;
        partnerPresent = true;
        for (const [di, dj] of NEIGHBOR_OFFSETS) {
          if (inRegion.has(`${i + di},${j + dj}`)) {
            touches = true;
            break;
          }
        }
        if (touches) break;
      }
      if (touches) break;
    }
    if (link.hard) {
      if (touches) score += HARD_SCORE_REWARD * link.weight;
      else if (partnerPresent) score -= HARD_SCORE_REWARD * link.weight; // miss = huge penalty
      // partner not placed → no penalty, can't evaluate yet
    } else if (touches) {
      score += link.weight;
    }
  }
  return score;
}

// Local score: if `cell` were added to `room`, what's the immediate
// link-satisfaction gain from this single cell's 4 neighbors.
function scoreCellForRoom(layout: Layout, room: Room, cell: { i: number; j: number }): number {
  let score = 0;
  for (const [di, dj] of NEIGHBOR_OFFSETS) {
    const ni = cell.i + di;
    const nj = cell.j + dj;
    if (ni < 0 || ni >= layout.size || nj < 0 || nj >= layout.size) continue;
    const neighborId = layout.cells[ni][nj].roomId;
    if (neighborId === null) continue;
    for (const link of layout.links) {
      if (
        (link.a === room.id && link.b === neighborId) ||
        (link.b === room.id && link.a === neighborId)
      ) {
        score += link.weight * (link.hard ? HARD_SCORE_WEIGHT : 1);
        break;
      }
    }
  }
  return score;
}
