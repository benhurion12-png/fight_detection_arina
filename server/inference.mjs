import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as ort from 'onnxruntime-node';

try {
  const directory = resolve(process.cwd(), 'public/models');
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  let backend = process.env.FIGHT_BACKEND || (process.platform === 'win32' ? 'dml' : 'cpu');
  async function createSession(provider) {
    return ort.InferenceSession.create(resolve(directory, 'fight.onnx'), {
      executionProviders: [provider], intraOpNumThreads: 4, interOpNumThreads: 1,
      graphOptimizationLevel: 'all', enableMemPattern: provider !== 'dml', executionMode: 'sequential',
    });
  }
  let session;
  try { session = await createSession(backend); }
  catch (error) {
    if (process.env.FIGHT_BACKEND || backend === 'cpu') throw error;
    console.warn('DirectML unavailable; using CPU:', String(error));
    backend = 'cpu'; session = await createSession(backend);
  }
  const pixels = 320 * 320;
  const buffer = new Float32Array(8 * 3 * pixels);
  const tensor = new ort.Tensor('float32', buffer, manifest.inputShape);
  const warmup = await session.run({ [manifest.inputName]: tensor });
  Object.values(warmup).forEach(value => value.dispose());
  parentPort.postMessage({ type: 'ready', backend });
  parentPort.on('message', async ({ rgba }) => {
    try {
      const started = performance.now();
      const mean = [.485, .456, .406], std = [.229, .224, .225];
      for (let t = 0; t < 8; t++) for (let c = 0; c < 3; c++) {
        const offset = (t * 3 + c) * pixels;
        for (let p = 0; p < pixels; p++) buffer[offset + p] = (rgba[(t * pixels + p) * 4 + c] / 255 - mean[c]) / std[c];
      }
      const inferenceStart = performance.now();
      const outputs = await session.run({ [manifest.inputName]: tensor });
      const logits = Array.from(outputs[manifest.outputName].data);
      const maximum = Math.max(...logits);
      const exp = logits.map(value => Math.exp(value - maximum));
      const score = exp[1] / exp.reduce((a, b) => a + b, 0);
      Object.values(outputs).forEach(value => value.dispose());
      if (!Number.isFinite(score)) throw new Error('Invalid model output');
      parentPort.postMessage({ type: 'result', score, inferenceMs: performance.now() - inferenceStart, serverMs: performance.now() - started });
    } catch (error) { parentPort.postMessage({ type: 'error', error: String(error) }); }
  });
} catch (error) { parentPort.postMessage({ type: 'fatal', error: String(error) }); }
