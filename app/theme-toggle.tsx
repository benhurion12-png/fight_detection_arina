'use client';

export default function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = theme;
    try { localStorage.setItem('ku-theme', theme); } catch { /* Theme still works when storage is unavailable. */ }
  }
  return <button className="secondary theme-toggle" onClick={toggle} aria-label="Переключить тему">
    <span className="to-dark"><span aria-hidden="true">☾</span> Тёмная тема</span>
    <span className="to-light"><span aria-hidden="true">☀</span> Светлая тема</span>
  </button>;
}
