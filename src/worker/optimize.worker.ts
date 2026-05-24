import type { Layout } from "../model/types";
import { optimize } from "../optimizer/lns";
import { computeCost } from "../model/cost";

// Web Worker that runs the LNS optimizer off the main thread.
// Communicates via plain serializable messages.
//
// Messages received from main thread:
//   { type: "optimize", layout, iterations? }
//   { type: "cancel" }
//
// Messages sent to main thread:
//   { type: "progress", iteration, totalIterations, bestEnergy, improved }
//   { type: "log", message }
//   { type: "done", layout, energy, breakdown, linkReports, roomReports, durationMs }
//   { type: "error", message }

export interface OptimizeRequest {
  type: "optimize";
  layout: Layout;
  iterations?: number;
}

export interface CancelRequest {
  type: "cancel";
}

export type WorkerRequest = OptimizeRequest | CancelRequest;

export interface ProgressMessage {
  type: "progress";
  iteration: number;
  totalIterations: number;
  bestEnergy: number;
  improved: boolean;
}

export interface LogMessage {
  type: "log";
  message: string;
}

export interface DoneMessage {
  type: "done";
  layout: Layout;
  energy: number;
  breakdown: ReturnType<typeof computeCost>["energy"];
  linkReports: ReturnType<typeof computeCost>["linkReports"];
  roomReports: ReturnType<typeof computeCost>["roomReports"];
  durationMs: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type WorkerMessage = ProgressMessage | LogMessage | DoneMessage | ErrorMessage;

let abortController: AbortController | null = null;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type === "cancel") {
    abortController?.abort();
    return;
  }
  if (req.type !== "optimize") return;

  abortController = new AbortController();
  const start = performance.now();
  try {
    const result = await optimize(req.layout, {
      iterations: req.iterations,
      signal: abortController.signal,
      log: (message) => {
        const msg: LogMessage = { type: "log", message };
        self.postMessage(msg);
      },
      onProgress: (info) => {
        const msg: ProgressMessage = {
          type: "progress",
          iteration: info.iteration,
          totalIterations: info.totalIterations,
          bestEnergy: info.bestEnergy,
          improved: info.improved,
        };
        self.postMessage(msg);
      },
    });
    const cost = computeCost(result.layout);
    const done: DoneMessage = {
      type: "done",
      layout: result.layout,
      energy: result.energy,
      breakdown: cost.energy,
      linkReports: cost.linkReports,
      roomReports: cost.roomReports,
      durationMs: performance.now() - start,
    };
    self.postMessage(done);
  } catch (err) {
    const msg: ErrorMessage = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
