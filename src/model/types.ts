// Core types for the layout problem.
//
// A Layout consists of:
//   - rooms: named functional areas with a required number of cells (size).
//   - links: adjacency requirements/preferences between rooms.
//   - grid: an N×N grid where each cell is assigned to at most one room.

export type RoomId = string;

export interface Room {
  id: RoomId;
  name: string;
  size: number;        // number of cells this room needs
  color: string;       // hex string for UI
}

export interface Link {
  a: RoomId;
  b: RoomId;
  weight: number;      // soft-link relative importance (default 1)
  hard: boolean;       // if true, an unsatisfied link incurs a huge penalty
}

// A single grid cell. If unassigned, roomId is null.
// allowedRoomIds optionally restricts which rooms may be placed here
// (empty = any room allowed).
export interface Cell {
  roomId: RoomId | null;
  allowedRoomIds?: RoomId[];
}

export interface Layout {
  size: number;        // grid is size × size
  cells: Cell[][];     // cells[row][col]
  rooms: Room[];
  links: Link[];
}

// Snapshot of how each link fared in the current layout.
export interface LinkReport {
  a: RoomId;
  b: RoomId;
  weight: number;
  hard: boolean;
  sharedSides: number;       // count of 4-connected boundary cells
  satisfied: boolean;        // sharedSides > 0
}

// Snapshot of how each room placed: how many cells got assigned, and into
// how many disjoint 4-connected components.
export interface RoomReport {
  id: RoomId;
  name: string;
  size: number;
  assigned: number;
  components: number;        // 1 = single contiguous block (good)
}

export interface EnergyBreakdown {
  total: number;
  adjacency: number;         // sum of unsatisfied-link penalties
  fragmentation: number;     // sum of stray-cell penalties
  compactness: number;       // intra-room pairwise distance term
}
