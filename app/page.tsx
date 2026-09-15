'use client';
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme-toggle';

type Result = { score: number; inferenceMs: number; serverMs: number; roundtripMs: number; start: number; end: number; id: number };
type Frame = { rgba: Uint8ClampedArray; time: number };

export default function Page() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const objectUrl = useRef('');
  const sourceToken = useRef(0), generation = useRef(0), count = useRef(0);
  const active = useRef(false), available = useRef(false);
  const frames = useRef<Frame[]>([]);
  const request = useRef<AbortController | null>(null);
  const sampleInterval = useRef(7 / 30);
  const [kind, setKind] = useState<'none' | 'file' | 'camera'>('none');
  const [name, setName] = useState('Источник не выбран');
  const [ready, setReady] = useState(false), [running, setRunning] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [fps, setFps] = useState(30), [threshold, setThreshold] = useState(.7);
  const [status, setStatus] = useState('Подключение к серверу…'), [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]), [sampled, setSampled] = useState(0);
  const [liveResult, setLiveResult] = useState<Result | null>(null);
  const [backend, setBackend] = useState('Подключение…');
  const [backendSwitching, setBackendSwitching] = useState(false);
  sampleInterval.current = 7 / fps;

  function resetWindow() {
    generation.current++; frames.current = []; request.current?.abort(); setSampled(0); setLiveResult(null);
  }
  function pauseAnalysis() {
    active.current = false; setRunning(false); resetWindow(); setStatus('Анализ приостановлен');
  }
  async function changeBackend(target: 'cpu' | 'dml') {
    setBackendSwitching(true); setError('');
    try {
      const response = await fetch('/api/inference/backend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backend: target }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setBackend(result.backend); setStatus(`Бэкенд переключён · ${result.backend}`);
    } catch (e) { setError(`Не удалось переключить бэкенд: ${String(e)}`); }
    finally { setBackendSwitching(false); }
  }
  function releaseSource() {
    sourceToken.current++; pauseAnalysis();
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream.current = null;
    if (video.current) { video.current.pause(); video.current.srcObject = null; video.current.removeAttribute('src'); video.current.load(); }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = ''; setResults([]); count.current = 0;
  }
  function selectFile(file: File) {
    releaseSource(); setError(''); setKind('file'); setName(file.name);
    objectUrl.current = URL.createObjectURL(file); video.current!.src = objectUrl.current; setStatus('Открытие видео…');
  }
  async function enableCamera() {
    releaseSource(); setKind('none'); setError(''); setCameraLoading(true);
    const token = sourceToken.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Для камеры откройте сайт через localhost или HTTPS.');
      const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
      if (sourceToken.current !== token) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      media.getVideoTracks().forEach(track => { track.onended = () => { releaseSource(); setKind('none'); setError('Камера отключена. Подключите её повторно.'); }; });
      video.current!.srcObject = media; setKind('camera'); setName('Веб-камера'); await video.current!.play();
    } catch (e) {
      if (token === sourceToken.current) {
        stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
        setKind('none'); setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Доступ к камере запрещён. Разрешите его в настройках браузера.' : String(e));
      }
    } finally { if (token === sourceToken.current) setCameraLoading(false); }
  }

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function connect() {
      try {
        const response = await fetch('/api/inference', { signal: controller.signal, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (disposed) return;
        available.current = true; setReady(true); setBackend(result.backend); setError('');
        setStatus(active.current ? 'Сбор кадров для первой оценки…' : 'Сервер готов. Выберите видео или включите камеру.');
      } catch (e) {
        if (disposed) return;
        setError(`Сервер недоступен: ${String(e)}`); timer = setTimeout(connect, 3000);
      }
    }
    void connect();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let disposed = false, animation = 0, lastSample = -Infinity, lastSent = -Infinity;
    const scaled = document.createElement('canvas');
    const crop = document.createElement('canvas'); crop.width = crop.height = 320;
    const cropContext = crop.getContext('2d', { willReadFrequently: true })!;
    let seenGeneration = generation.current;
    async function submit(batch: Frame[], token: number) {
      const controller = new AbortController(); request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 30000);
      const started = performance.now();
      const body = new Uint8Array(8 * 320 * 320 * 4);
      batch.forEach((frame, index) => body.set(frame.rgba, index * 320 * 320 * 4));
      try {
        const response = await fetch('/api/inference', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body, signal: controller.signal });
        if (disposed || token !== generation.current) return;
        if (response.status === 429) { setStatus('Сервер занят · ожидаем обработку свежих кадров'); return; }
        const result = await response.json();
        if (disposed || token !== generation.current) return;
        if (!response.ok) throw new Error(result.error);
        if (!Number.isFinite(result.score)) throw new Error('Некорректная оценка сервера');
        const row: Result = { ...result, roundtripMs: performance.now() - started, start: batch[0].time, end: batch[7].time, id: ++count.current };
        setResults(previous => [...previous.slice(-99), row]); setLiveResult(row); setError(''); setStatus('Анализ в реальном времени');
      } catch (e) {
        if (!disposed && token === generation.current) setError(controller.signal.aborted ? 'Сервер не ответил за 30 секунд. Повторяем на свежих кадрах.' : String(e));
      } finally { clearTimeout(timeout); if (request.current === controller) request.current = null; }
    }
    function tick() {
      if (disposed) return;
      animation = requestAnimationFrame(tick);
      const player = video.current;
      if (seenGeneration !== generation.current) { lastSample = lastSent = -Infinity; seenGeneration = generation.current; }
      if (!player || !active.current || !available.current || player.paused || player.seeking || player.readyState < 2) return;
      const time = player.currentTime;
      if (time - lastSample < sampleInterval.current) return;
      if (Number.isFinite(lastSample) && time - lastSample > sampleInterval.current * 3) {
        frames.current = []; generation.current++; seenGeneration = generation.current; lastSent = -Infinity; setLiveResult(null);
      }
      lastSample = time;
      scaled.width = player.videoWidth <= player.videoHeight ? 340 : 453;
      scaled.height = player.videoWidth <= player.videoHeight ? 453 : 340;
      scaled.getContext('2d')!.drawImage(player, 0, 0, scaled.width, scaled.height);
      cropContext.drawImage(scaled, Math.floor((scaled.width - 320) / 2), Math.floor((scaled.height - 320) / 2), 320, 320, 0, 0, 320, 320);
      frames.current.push({ rgba: cropContext.getImageData(0, 0, 320, 320).data, time });
      if (frames.current.length > 8) frames.current.shift();
      setSampled(frames.current.length);
      if (frames.current.length === 8 && !request.current && time - lastSent >= .5) {
        lastSent = time; void submit([...frames.current], generation.current);
      }
    }
    animation = requestAnimationFrame(tick);
    return () => {
      disposed = true; cancelAnimationFrame(animation); generation.current++; sourceToken.current++;
      request.current?.abort(); stream.current?.getTracks().forEach(track => track.stop());
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const latest = liveResult;
  return <main>
    <header><a className="brand" href="/">KU <span>Fight detection</span></a><div className="header-actions"><span className="badge">SERVER / LIVE</span><ThemeToggle /></div></header>
    <section className="intro"><div className="eyebrow">PPTSM · LIVE MONITOR</div><h1>Распознавание драк.<br/><span>Во время трансляции.</span></h1><p>Откройте видео или включите веб-камеру. Сервер анализирует последние кадры, пока изображение воспроизводится без остановки.</p></section>
    <div className="workspace">
      <section className="panel viewer"><div className="panel-title"><span>01 / ТРАНСЛЯЦИЯ</span><span>{name}</span></div>
        <div className="screen live-screen"><video ref={video} hidden={kind === 'none'} controls={kind === 'file'} muted playsInline preload="auto"
          onLoadedData={() => { void video.current?.play().catch(() => setStatus('Нажмите «Продолжить анализ» для воспроизведения.')); }}
          onPlay={() => { active.current = true; setRunning(true); setStatus(available.current ? 'Сбор кадров для оценки…' : 'Видео воспроизводится · сервер запускается…'); }}
          onPause={pauseAnalysis} onSeeking={() => { resetWindow(); setResults([]); }}
          onEnded={() => { pauseAnalysis(); setStatus('Видео завершено'); }}
          onError={() => { if (video.current?.getAttribute('src')) setError('Не удалось открыть видео. Попробуйте MP4 H.264.'); }} />
          {kind === 'none' && <div className="placeholder"><div className="play">▷</div><h2>Видео или веб-камера</h2><p>Воспроизведение начинается сразу.<br/>Оценки появляются по мере анализа.</p></div>}
          {kind !== 'none' && <div className={`live-overlay ${running && latest && latest.score >= threshold ? 'danger' : ''}`}>{!running ? 'ПАУЗА' : !latest ? `СБОР КАДРОВ ${sampled}/8` : latest.score >= threshold ? `ВОЗМОЖНАЯ ДРАКА · ${(latest.score * 100).toFixed(0)}%` : `ОЦЕНКА ДРАКИ · ${(latest.score * 100).toFixed(0)}%`}</div>}
        </div>
        <div className="viewer-bottom"><label className="button secondary">Выбрать видео<input aria-label="Выбрать видео" type="file" accept="video/*" onChange={event => { const file = event.target.files?.[0]; if (file) { setCameraLoading(false); selectFile(file); } event.target.value = ''; }} /></label>
          {kind === 'camera' ? <button className="secondary" onClick={() => { releaseSource(); setKind('none'); setName('Камера выключена'); }}>Выключить камеру</button> : <button className="secondary" disabled={cameraLoading} onClick={enableCamera}>{cameraLoading ? 'Подключение…' : 'Включить веб-камеру'}</button>}</div>
      </section>
      <aside className="panel settings"><div className="panel-title">02 / МОНИТОРИНГ</div><div className="settings-body"><div className="model"><span className={`dot ${ready ? 'ready' : ''}`} /><div><strong>ppTSM Fight</strong><small>{ready ? `Сервер готов · ${backend}` : 'Модель запускается на сервере…'}</small></div></div>
        <div className="backend-switch"><button className="secondary" disabled={backendSwitching} onClick={() => changeBackend('dml')}>{backendSwitching ? 'Переключение…' : 'GPU'}</button><button className="secondary" disabled={backendSwitching} onClick={() => changeBackend('cpu')}>{backendSwitching ? 'Переключение…' : 'CPU'}</button></div>
        <label>Частота источника, FPS<input type="number" min="1" max="240" value={fps} disabled={running} onChange={e => { const value = Number(e.target.value); setFps(Math.min(240, Math.max(1, value || 30))); resetWindow(); }}/></label><small>8 кадров с интервалом 7 / FPS. При 30 FPS первая оценка требует около 2 секунд наблюдения плюс время обработки.</small>
        <label>Порог тревоги <strong>{Math.round(threshold * 100)}%</strong><input type="range" min=".1" max=".99" step=".01" value={threshold} onChange={e => setThreshold(Number(e.target.value))}/></label>
        <div className="spec"><span>Кадров в окне</span><b>{sampled} / 8</b><span>Обработка</span><b>{backend}</b><span>Очередь запросов</span><b>Без накопления</b></div>
        {running ? <button onClick={() => { video.current?.pause(); pauseAnalysis(); }}>Приостановить анализ</button> : <button disabled={kind === 'none'} onClick={() => { resetWindow(); void video.current?.play().catch(e => setError(String(e))); }}>Продолжить анализ</button>}
        <small>Для анализа кадры передаются на этот сервер. Аудио не используется, записи не сохраняются.</small>
      </div></aside>
    </div>
    <section className="panel results"><div className="panel-title"><span>03 / РЕЗУЛЬТАТЫ LIVE</span><span role="status">{status}</span></div>{error && <p role="alert" className="error">{error}</p>}<div className="metrics"><div><small>Оценка драки · последнее окно</small><strong>{latest ? `${(latest.score * 100).toFixed(1)}%` : '—'}</strong></div><div><small>Инференс на сервере</small><strong>{latest ? `${Math.round(latest.inferenceMs)} мс` : '—'}</strong></div><div><small>Запрос и ответ · без сбора кадров</small><strong>{latest ? `${Math.round(latest.roundtripMs)} мс` : '—'}</strong></div></div>
      {results.length > 0 && <div className="table-wrap"><table><thead><tr><th>Кадры, время источника</th><th>Оценка драки</th><th>Результат</th><th>Инференс</th></tr></thead><tbody>{[...results].reverse().map(row => <tr key={row.id}><td>{row.start.toFixed(2)}–{row.end.toFixed(2)} с</td><td>{(row.score * 100).toFixed(1)}%</td><td><span className={row.score >= threshold ? 'alert' : 'normal'}>{row.score >= threshold ? 'Возможная драка' : 'Ниже порога'}</span></td><td>{Math.round(row.inferenceMs)} мс</td></tr>)}</tbody></table></div>}
    </section><footer>Последние 100 оценок. Окна перекрываются. Модель оценивает сцену целиком; задержка зависит от сервера и сети.</footer>
  </main>;
}
