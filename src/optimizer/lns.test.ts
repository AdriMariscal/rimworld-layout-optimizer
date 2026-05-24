import { describe, expect, test } from "vitest";
import { createLateGameVanillaLayout } from "../presets/late-game-vanilla";
import { cellsByRoom, countComponents, createEmptyLayout, addRoom, addLink, fillUnassignedCells } from "../model/layout";
import { computeCost } from "../model/cost";
import { optimize } from "./lns";

describe("LNS optimize", () => {
  test("monotonic: re-running on an optimized layout never raises energy", async () => {
    const layout = createLateGameVanillaLayout();
    const first = await optimize(layout, { iterations: 50 });
    const second = await optimize(first.layout, { iterations: 50 });
    expect(second.energy).toBeLessThanOrEqual(first.energy);
  }, 60000);

  test("satisfies all hard links on a small scenario", async () => {
    const layout = createEmptyLayout(6);
    const rooms = [
      { id: "kitchen", name: "kitchen", size: 1, color: "#f00" },
      { id: "freezer", name: "freezer", size: 1, color: "#0ff" },
      { id: "cooler", name: "cooler", size: 1, color: "#00f" },
      { id: "dining", name: "dining", size: 2, color: "#fa0" },
      { id: "filler", name: "filler", size: 31, color: "#888" },
    ];
    for (const r of rooms) addRoom(layout, r);
    addLink(layout, { a: "kitchen", b: "freezer", weight: 1, hard: true });
    addLink(layout, { a: "kitchen", b: "cooler", weight: 1, hard: true });
    addLink(layout, { a: "cooler", b: "dining", weight: 1, hard: true });
    fillUnassignedCells(layout);

    const result = await optimize(layout, { iterations: 80 });
    const report = computeCost(result.layout);
    const unsatHard = report.linkReports.filter((r) => !r.satisfied && r.hard);
    expect(unsatHard).toEqual([]);
  }, 60000);

  test("late-game preset: 0 hard unsatisfied and all rooms contiguous", async () => {
    const layout = createLateGameVanillaLayout();
    const result = await optimize(layout, { iterations: 500 });
    const report = computeCost(result.layout);

    const unsatHard = report.linkReports.filter((r) => !r.satisfied && r.hard);
    if (unsatHard.length > 0) {
      const byId = new Map(result.layout.rooms.map((r) => [r.id, r.name]));
      // eslint-disable-next-line no-console
      console.log("unsatisfied hard:", unsatHard.map((u) => `${byId.get(u.a)} <-> ${byId.get(u.b)}`));
    }
    expect(unsatHard).toEqual([]);

    // All rooms must be a single 4-connected block.
    const map = cellsByRoom(result.layout);
    const fragmented: string[] = [];
    for (const room of result.layout.rooms) {
      const cells = map.get(room.id) ?? [];
      if (cells.length === 0) continue;
      const comp = countComponents(cells);
      if (comp > 1) fragmented.push(`${room.name} (${comp})`);
    }
    expect(fragmented).toEqual([]);
  }, 120000);
});
