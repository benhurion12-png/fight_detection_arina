import { switchBackend } from '../../../../server/engine';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const requested = body?.backend;
  if (requested !== 'cpu' && requested !== 'dml') return Response.json({ error: 'Expected backend: "cpu" or "dml"' }, { status: 400 });
  try {
    const engine = await switchBackend(requested);
    if (engine.failed) throw new Error(engine.failed);
    return Response.json({ backend: engine.backend === 'dml' ? 'GPU / DirectML' : 'CPU' });
  } catch (error) { return Response.json({ error: String(error) }, { status: 503 }); }
}
