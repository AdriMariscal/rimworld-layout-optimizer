import type { Layout } from "../model/types";
import type { DoneMessage, ProgressMessage, WorkerMessage } from "./optimize.worker";

// Thin client wrapper around the optimizer Web Worker. The UI uses this so
// it can `await` an optimization and subscribe to progress/log events.

export interface RunOptions {
  iterations?: number;
  onProgress?: (info: ProgressMessage) => void;
  onLog?: (message: string) => void;
}

export class OptimizerClient {
  private worker: Worker | null = null;

  private spawn(): Worker {
    return new Worker(new URL("./optimize.worker.ts", import.meta.url), { type: "module" });
  }

  async run(layout: Layout, opts: RunOptions = {}): Promise<DoneMessage> {
    // Terminate any previous worker before starting a new one.
    this.cancel();
    const worker = this.spawn();
    this.worker = worker;

    return new Promise<DoneMessage>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const msg = e.data;
        switch (msg.type) {
          case "progress":
            opts.onProgress?.(msg);
            break;
          case "log":
            opts.onLog?.(msg.message);
            break;
          case "done":
            resolve(msg);
            worker.terminate();
            this.worker = null;
            break;
          case "error":
            reject(new Error(msg.message));
            worker.terminate();
            this.worker = null;
            break;
        }
      };
      worker.onerror = (err) => {
        reject(err);
        worker.terminate();
        this.worker = null;
      };
      worker.postMessage({ type: "optimize", layout, iterations: opts.iterations });
    });
  }

  cancel(): void {
    if (this.worker) {
      this.worker.postMessage({ type: "cancel" });
      this.worker.terminate();
      this.worker = null;
    }
  }
}
