import type { Cell, Layout, Room, RoomId, Link } from "./types";

// Constructor helpers + pure operations on Layout. The Layout type itself
// is a plain object — no methods, so it serializes cleanly across the
// Web Worker boundary (no class instances to revive).

export function createEmptyLayout(size: number): Layout {
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ roomId: null })),
  );
  return { size, cells, rooms: [], links: [] };
}

export function cloneLayout(layout: Layout): Layout {
  return {
    size: layout.size,
    cells: layout.cells.map((row) =>
      row.map((cell) => ({
        roomId: cell.roomId,
        ...(cell.allowedRoomIds ? { allowedRoomIds: [...cell.allowedRoomIds] } : {}),
      })),
    ),
    rooms: layout.rooms.map((r) => ({ ...r })),
    links: layout.links.map((l) => ({ ...l })),
  };
}

// Allocates an unassigned cell to room `roomId` for every room that still
// needs cells, scanning the grid in row-major order. Existing assignments
// are preserved. Returns the same layout (mutated) for chaining.
//
// This is a deterministic greedy seed; useful as initial state for the
// optimizer when the caller doesn't provide one.
export function fillUnassignedCells(layout: Layout): Layout {
  const remaining = new Map<RoomId, number>();
  for (const room of layout.rooms) {
    remaining.set(room.id, room.size);
  }
  // Subtract already-assigned cells.
  for (const row of layout.cells) {
    for (const cell of row) {
      if (cell.roomId !== null && remaining.has(cell.roomId)) {
        remaining.set(cell.roomId, remaining.get(cell.roomId)! - 1);
      }
    }
  }
  // Assign in room declaration order until each room has its size.
  const queue: RoomId[] = [];
  for (const room of layout.rooms) {
    const left = remaining.get(room.id) ?? 0;
    for (let k = 0; k < left; k += 1) queue.push(room.id);
  }
  let q = 0;
  for (let i = 0; i < layout.size && q < queue.length; i += 1) {
    for (let j = 0; j < layout.size && q < queue.length; j += 1) {
      const cell = layout.cells[i][j];
      if (cell.roomId !== null) continue;
      if (cell.allowedRoomIds && !cell.allowedRoomIds.includes(queue[q])) continue;
      cell.roomId = queue[q];
      q += 1;
    }
  }
  return layout;
}

// Indexer: for each room, the (i,j) positions of its assigned cells.
export function cellsByRoom(layout: Layout): Map<RoomId, Array<{ i: number; j: number }>> {
  const map = new Map<RoomId, Array<{ i: number; j: number }>>();
  for (const room of layout.rooms) map.set(room.id, []);
  for (let i = 0; i < layout.size; i += 1) {
    for (let j = 0; j < layout.size; j += 1) {
      const id = layout.cells[i][j].roomId;
      if (id !== null) {
        const arr = map.get(id);
        if (arr) arr.push({ i, j });
      }
    }
  }
  return map;
}

// 4-connected component count for the given coordinate set.
export function countComponents(coords: Array<{ i: number; j: number }>): number {
  if (coords.length === 0) return 0;
  const set = new Set(coords.map((c) => `${c.i},${c.j}`));
  const seen = new Set<string>();
  let comps = 0;
  for (const start of coords) {
    const key = `${start.i},${start.j}`;
    if (seen.has(key)) continue;
    comps += 1;
    const stack: Array<{ i: number; j: number }> = [start];
    while (stack.length > 0) {
      const { i, j } = stack.pop()!;
      const k = `${i},${j}`;
      if (seen.has(k)) continue;
      seen.add(k);
      for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        const nk = `${ni},${nj}`;
        if (set.has(nk) && !seen.has(nk)) stack.push({ i: ni, j: nj });
      }
    }
  }
  return comps;
}

export function addRoom(layout: Layout, room: Room): Layout {
  layout.rooms.push(room);
  return layout;
}

export function addLink(layout: Layout, link: Link): Layout {
  layout.links.push(link);
  return layout;
}

export function findRoom(layout: Layout, id: RoomId): Room | undefined {
  return layout.rooms.find((r) => r.id === id);
}

// Total cells the layout's rooms require. Must be ≤ size² for the layout
// to be satisfiable.
export function totalRoomCells(layout: Layout): number {
  return layout.rooms.reduce((acc, r) => acc + r.size, 0);
}
