import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';

type Prediction = { score: number; inferenceMs: number; serverMs: number };
type Engine = { worker: Worker; ready: Promise<void>; busy: boolean; backend?: string; failed?: string; pending?: { resolve: (value: Prediction) => void; reject: (error: Error) => void } };
const shared = globalThis as typeof globalThis & { fightEngine?: Engine };

export function getEngine() {
  if (shared.fightEngine) return shared.fightEngine;
  const worker = new Worker(resolve(process.cwd(), 'server/inference.mjs'));
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Initialization may begin before the first request attaches its await.
  void ready.catch(() => {});
  const engine: Engine = { worker, ready, busy: false };
  shared.fightEngine = engine;
  const fail = (message: string) => {
    engine.failed = message; readyReject(new Error(message));
    engine.pending?.reject(new Error(message)); engine.pending = undefined;
  };
  worker.on('message', message => {
    if (message.type === 'ready') { engine.backend = message.backend; readyResolve(); }
    else if (message.type === 'fatal') fail(message.error);
    else {
      if (message.type === 'result') engine.pending?.resolve(message);
      else engine.pending?.reject(new Error(message.error));
      engine.pending = undefined;
    }
  });
  worker.on('error', error => fail(error.message));
  worker.on('exit', code => fail(`Inference worker exited (${code})`));
  return engine;
}

export async function predict(engine: Engine, rgba: Uint8Array<ArrayBuffer>): Promise<Prediction> {
  await engine.ready;
  if (engine.failed) throw new Error(engine.failed);
  return new Promise((resolve, reject) => {
    engine.pending = { resolve, reject };
    engine.worker.postMessage({ rgba }, [rgba.buffer]);
  });
}
