import type { Layout } from "../model/types";
import { fillUnassignedCells } from "../model/layout";

const KEY = "rimworld-layout-optimizer:layout";

export function saveLayout(layout: Layout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch (err) {
    // Quota / private mode: log and move on, the app still works in memory.
    // eslint-disable-next-line no-console
    console.warn("Failed to save layout to localStorage:", err);
  }
}

export function loadLayout(): Layout | null {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Layout;
    // Basic shape check.
    if (
      typeof parsed.size !== "number" ||
      !Array.isArray(parsed.cells) ||
      !Array.isArray(parsed.rooms) ||
      !Array.isArray(parsed.links)
    ) {
      throw new Error("invalid layout shape");
    }
    fillUnassignedCells(parsed);
    return parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to parse stored layout, discarding:", err);
    localStorage.removeItem(KEY);
    return null;
  }
}

export function clearStoredLayout(): void {
  localStorage.removeItem(KEY);
}
