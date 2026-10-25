import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { chapterMotion } from "./motion";

/** A local Earth texture; no map API, account, tiles or third-party requests. */
export default function LandingEarth({ progress, running }: { progress: MutableRefObject<number>; running: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const runningRef = useRef(running); runningRef.current = running;
  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" }); }
    catch { el.classList.add("earth-fallback"); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor(0, 0); el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
    const geometry = new THREE.SphereGeometry(1, 64, 48);
    const material = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 12, specular: 0x274351 });
    const earth = new THREE.Mesh(geometry, material); scene.add(earth);
    earth.rotation.z = .15;
    const light = new THREE.DirectionalLight(0xfff5dc, 2.5); light.position.set(-3, 3, 4); scene.add(light);
    scene.add(new THREE.AmbientLight(0x819faf, 1.5));
    let disposed = false, texture: THREE.Texture | null = null;
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}landing/earth.jpg`, loaded => {
      if (disposed) { loaded.dispose(); return; }
      texture = loaded; loaded.colorSpace = THREE.SRGBColorSpace; material.map = loaded; material.needsUpdate = true;
    }, undefined, () => el.classList.add("earth-fallback"));
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let frame = 0, rotation = 0, last = 0, lastProgress = -1;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      const p = progress.current;
      if (document.hidden || p < .55 || p >= 1 || time - last < 33) return;
      if (!runningRef.current && p === lastProgress) return;
      lastProgress = p;
      const delta = Math.min((time - last) / 1000, .05); last = time;
      if (runningRef.current) rotation += delta * .07;
      const { zoom } = chapterMotion(p);
      camera.position.set(0, .12, 3.9 - zoom * 2.35);
      earth.rotation.y = -.8 + rotation + zoom * .5;
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(draw);
    const lost = (event: Event) => { event.preventDefault(); el.classList.add("earth-fallback"); };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); renderer.domElement.removeEventListener("webglcontextlost", lost); geometry.dispose(); material.dispose(); texture?.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, [progress]);
  return <div ref={host} className="landing-earth" aria-hidden="true"><div className="earth-halo" /></div>;
}
