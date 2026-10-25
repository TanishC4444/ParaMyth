import { useEffect, useRef, useState } from "react";
import { INSTAGRAM_PROFILE } from "./contact";

declare global { interface Window { instgrm?: { Embeds: { process: () => void } } } }
let embedScript: Promise<void> | undefined;
function loadInstagram() {
  if (!embedScript) embedScript = new Promise<void>((resolve, reject) => {
    if (window.instgrm) { resolve(); return; }
    const script = document.createElement("script");
    script.async = true; script.src = "https://www.instagram.com/embed.js";
    script.onload = () => resolve(); script.onerror = () => { script.remove(); embedScript = undefined; reject(Error("Instagram unavailable")); };
    document.head.append(script);
  });
  return embedScript;
}
/** Uses the supplied official profile embed. Never requests it during the opening book. */
export default function Instagram({ enabled }: { enabled: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void loadInstagram().then(() => { if (!stopped) window.instgrm?.Embeds.process(); }).catch(() => { if (!stopped) setFailed(true); });
    }, { rootMargin: "200px" });
    observer.observe(host.current!);
    return () => { stopped = true; observer.disconnect(); };
  }, [enabled, retry]);
  return <div className="instagram-panel" ref={host}>
    <div className="instagram-heading"><h3>People & Updates</h3><a href={INSTAGRAM_PROFILE} target="_blank" rel="noreferrer">@paramythofficial ↗</a></div>
    <p>Meet the people building with ParaMyth and follow our latest updates.</p>
    <div className="instagram-frame">
      <blockquote className="instagram-media" data-instgrm-permalink={INSTAGRAM_PROFILE} data-instgrm-version="14"><a href={INSTAGRAM_PROFILE} target="_blank" rel="noreferrer">View ParaMyth on Instagram ↗</a></blockquote>
    </div>
    {failed && <div className="instagram-retry" role="status">Instagram couldn’t load. <button onClick={() => { setFailed(false); setRetry(retry + 1); }}>Try Again</button></div>}
    <a className="instagram-fallback" href={INSTAGRAM_PROFILE} target="_blank" rel="noreferrer">Open Instagram ↗</a>
  </div>;
}
