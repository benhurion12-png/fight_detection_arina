import type { NextConfig } from 'next';

// The inference route loads its worker (server/inference.mjs), the ONNX model
// (public/models/*) and onnxruntime-node's native binary at runtime via
// process.cwd()-relative paths, so Next's automatic file tracer never sees
// them as static imports and drops them from the serverless function bundle
// on hosts like Netlify. List them explicitly so they get packaged.
const inferenceRuntimeFiles = [
  './server/inference.mjs',
  './public/models/fight.onnx',
  './public/models/manifest.json',
  './node_modules/onnxruntime-node/dist/**/*',
  './node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*',
  './node_modules/onnxruntime-common/**/*',
];
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  outputFileTracingIncludes: {
    // Both routes spawn the same worker (server/inference.mjs) via engine.ts.
    '/api/inference': inferenceRuntimeFiles,
    '/api/inference/backend': inferenceRuntimeFiles,
  },
};
export default config;
