import { useEffect, useRef, type MutableRefObject } from "react";
import { animate } from "animejs";
import { clamp } from "./motion";

/** One capped-resolution canvas, animated by Anime.js, instead of many DOM nodes. */
export default function StoryParticles({ progress, running }: { progress: MutableRefObject<number>; running: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controls = useRef<{ refresh: () => void } | null>(null);
  const runningRef = useRef(running); runningRef.current = running;
  useEffect(() => {
    const el = canvas.current!, ctx = el.getContext("2d");
    if (!ctx) return;
    let width = 1, height = 1, visible = true;
    let points: { x: number; y: number }[] = [];
    const clock = { time: 0 };
    const draw = () => {
      const p = progress.current, t = clock.time;
      ctx.clearRect(0, 0, width, height);
      const gather = clamp((p - .12) / .32), scatter = clamp((p - .67) / .28);
      const count = width < 700 ? 64 : 150;
      ctx.globalAlpha = (1 - scatter) * .85;
      for (let i = 0; i < count; i++) {
        const seed = ((i * 16807 + 137) % 997) / 997, angle = seed * Math.PI * 2 + t * (.2 + seed * .15);
        const originX = width * (.5 + Math.cos(angle) * (.1 + seed * .2));
        const originY = height * (.48 + Math.sin(angle * 1.3) * .18) - (t * 7 + i * 3) % (height * .2);
        const target = points[i % Math.max(1, points.length)] || { x: width / 2, y: height / 2 };
        const x = originX + (target.x - originX) * gather + Math.cos(angle) * scatter * width * .8;
        const y = originY + (target.y - originY) * gather + Math.sin(angle) * scatter * height * .7;
        ctx.fillStyle = i % 4 ? "#eed9a5" : "#a8dbcb";
        ctx.beginPath(); ctx.arc(x, y, .8 + seed * 1.6, 0, Math.PI * 2); ctx.fill();
        if (i % 9 === 0) { ctx.globalAlpha *= .24; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = (1 - scatter) * .85; }
      }
    };
    const resize = () => {
      width = el.clientWidth; height = el.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      el.width = Math.max(1, Math.round(width * ratio)); el.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const stencil = document.createElement("canvas"); stencil.width = Math.max(1, Math.round(width)); stencil.height = Math.max(1, Math.round(height));
      const pen = stencil.getContext("2d", { willReadFrequently: true });
      points = [];
      if (pen && width && height) {
        pen.font = `italic ${Math.min(width * .14, 160)}px Georgia`;
        pen.textAlign = "center"; pen.textBaseline = "middle"; pen.fillText("ParaMyth", width / 2, height * .48);
        const pixels = pen.getImageData(0, 0, stencil.width, stencil.height).data;
        for (let y = 0; y < stencil.height; y += 8) for (let x = 0; x < stencil.width; x += 8) if (pixels[(y * stencil.width + x) * 4 + 3] > 150) points.push({ x, y });
        // Spread the particles over the full word rather than only its first glyph.
        const sampled = points; points = Array.from({ length: width < 700 ? 64 : 150 }, (_, i) => sampled[Math.floor(i * sampled.length / (width < 700 ? 64 : 150))]).filter(Boolean);
      }
      draw();
    };
    const animation = animate(clock, { time: [0, 20], duration: 20000, loop: true, ease: "linear", frameRate: 30, autoplay: false, onUpdate: draw });
    const refresh = () => { if (runningRef.current && visible && !document.hidden) animation.resume(); else animation.pause(); };
    controls.current = { refresh };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); }); observer.observe(el);
    const bounds = new ResizeObserver(resize); bounds.observe(el);
    document.addEventListener("visibilitychange", refresh); resize(); refresh();
    return () => { animation.revert(); observer.disconnect(); bounds.disconnect(); document.removeEventListener("visibilitychange", refresh); controls.current = null; ctx.clearRect(0, 0, width, height); };
  }, [progress]);
  useEffect(() => { controls.current?.refresh(); }, [running]);
  return <canvas ref={canvas} className="story-particles" aria-hidden="true" />;
}
