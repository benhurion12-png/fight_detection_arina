import './style.css';
export const metadata = { title: 'KU Fight detection', description: 'KU Fight detection — серверный анализ видео и веб-камеры с ppTSM' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ru" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('ku-theme')==='dark'?'dark':'light'}catch{}" }} /></head><body>{children}</body></html>;
}
