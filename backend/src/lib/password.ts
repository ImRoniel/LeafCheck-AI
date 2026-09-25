import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { HttpError } from "./http.js";

type Request = {
  operation: "hash" | "verify";
  password: string;
  stored?: string;
};
type Job = {
  request: Request;
  resolve: (result: string | boolean) => void;
  reject: (error: Error) => void;
};
type Slot = { worker: Worker; job?: Job; timer?: NodeJS.Timeout };
const unavailable = () =>
  new HttpError(
    503,
    "AUTH_BUSY",
    "Authentication temporarily unavailable. Please retry.",
  );

function setting(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export class PasswordPool {
  private slots = new Set<Slot>();
  private queue: Job[] = [];
  private closed = false;

  constructor(
    private readonly size = setting(
      "AUTH_HASH_WORKERS",
      Math.min(2, availableParallelism()),
      1,
      8,
    ),
    private readonly queueLimit = setting("AUTH_HASH_QUEUE_LIMIT", 32, 0, 256),
    private readonly timeoutMs = 30000,
    private readonly workerUrl = new URL(
      "./password-worker.mjs",
      import.meta.url,
    ),
  ) {
    if (
      !Number.isInteger(size) ||
      size < 1 ||
      size > 8 ||
      !Number.isInteger(queueLimit) ||
      queueLimit < 0 ||
      queueLimit > 256 ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0
    ) {
      throw new Error("Invalid password pool limits.");
    }
  }

  run(request: Request): Promise<string | boolean> {
    if (this.closed) return Promise.reject(unavailable());
    let slot = [...this.slots].find((entry) => !entry.job);
    if (!slot && this.slots.size < this.size) {
      try {
        const worker = new Worker(this.workerUrl, { execArgv: [] });
        slot = { worker };
        const current = slot;
        this.slots.add(current);
        worker.on(
          "message",
          (message: { result?: string | boolean; failed?: boolean }) => {
            const job = current.job;
            if (!job) return;
            clearTimeout(current.timer);
            current.job = undefined;
            if (
              message.failed ||
              typeof message.result !==
                (job.request.operation === "hash" ? "string" : "boolean")
            )
              job.reject(unavailable());
            else job.resolve(message.result!);
            worker.unref();
            this.drain(current);
          },
        );
        worker.on("error", () => this.fail(current));
        worker.on("exit", () => this.fail(current));
        worker.unref();
      } catch {
        return Promise.reject(unavailable());
      }
    }
    if (!slot && this.queue.length >= this.queueLimit)
      return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const job = { request, resolve, reject };
      if (slot) this.dispatch(slot, job);
      else this.queue.push(job);
    });
  }

  private dispatch(slot: Slot, job: Job) {
    slot.job = job;
    slot.worker.ref();
    slot.timer = setTimeout(() => this.fail(slot), this.timeoutMs);
    try {
      slot.worker.postMessage(job.request);
    } catch {
      this.fail(slot);
    }
  }

  private drain(slot: Slot) {
    const job = this.queue.shift();
    if (job) this.dispatch(slot, job);
  }

  private fail(slot: Slot) {
    if (!this.slots.delete(slot)) return;
    clearTimeout(slot.timer);
    slot.job?.reject(unavailable());
    slot.job = undefined;
    void slot.worker.terminate();
    // Fail queued callers promptly. Future requests lazily create replacements.
    for (const job of this.queue.splice(0)) job.reject(unavailable());
  }

  async close() {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(unavailable());
    const workers = [...this.slots];
    this.slots.clear();
    await Promise.all(
      workers.map((slot) => {
        clearTimeout(slot.timer);
        slot.job?.reject(unavailable());
        return slot.worker.terminate();
      }),
    );
  }
}

const pool = new PasswordPool();
export const hashPassword = (password: string) =>
  pool.run({ operation: "hash", password }) as Promise<string>;
export const verifyPassword = (password: string, stored?: string) =>
  pool.run({ operation: "verify", password, stored }) as Promise<boolean>;
