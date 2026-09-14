import { getEngine, predict } from '../../../server/engine';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const bytes = 8 * 320 * 320 * 4;

export async function GET() {
  try {
    const engine = getEngine();
    await engine.ready;
    if (engine.failed) throw new Error(engine.failed);
    return Response.json({ ready: true, backend: engine.backend === 'dml' ? 'GPU / DirectML' : 'CPU', frames: 8 });
  } catch (error) { return Response.json({ error: String(error) }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (request.headers.get('content-type') !== 'application/octet-stream') return Response.json({ error: 'Expected RGBA binary frames' }, { status: 415 });
  const engine = getEngine();
  if (engine.busy) return Response.json({ error: 'Сервер занят, следующий запрос обработает свежие кадры.' }, { status: 429 });
  engine.busy = true;
  try {
    // Bound the body while reading, including requests without Content-Length.
    const rgba = new Uint8Array(bytes);
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: 'Missing body' }, { status: 400 });
    let offset = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > bytes) { await reader.cancel(); return Response.json({ error: 'Too many frame bytes' }, { status: 413 }); }
      rgba.set(value, offset); offset += value.length;
    }
    if (offset !== bytes) return Response.json({ error: 'Expected exactly eight 320x320 RGBA frames' }, { status: 400 });
    const result = await predict(engine, rgba);
    return Response.json(result);
  } catch (error) { return Response.json({ error: String(error) }, { status: 500 }); }
  finally { engine.busy = false; }
}
