import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { geoEquirectangular, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { feature, mesh } from "topojson-client";
import worldUrl from "world-atlas/countries-50m.json?url";
import { ink } from "../atlas";
import type { AtlasPin } from "../types";

type Props = {
  stories: AtlasPin[];
  selectedId: string | null;
  focus: { id: string; at: number } | null;
  onSelect: (id: string) => void;
  onView: (ids: string[]) => void;
  onCluster: (ids: string[]) => void;
  onFallback: () => void;
};
type Marker = { x: number; y: number; stories: AtlasPin[] };
type Topology = Parameters<typeof mesh>[0];
type MapLabel = { text: string; lat: number; lng: number; kind: "continent" | "water" | "place" };
const LETTERING: MapLabel[] = [
  { text: "AFRICA", lat: 1, lng: 20, kind: "continent" },
  { text: "EUROPE", lat: 55, lng: 21, kind: "continent" },
  { text: "ASIA", lat: 48, lng: 83, kind: "continent" },
  { text: "NORTH AMERICA", lat: 48, lng: -104, kind: "continent" },
  { text: "SOUTH AMERICA", lat: -16, lng: -60, kind: "continent" },
  { text: "AUSTRALIA", lat: -25, lng: 134, kind: "continent" },
  { text: "Atlantic Ocean", lat: 5, lng: -33, kind: "water" },
  { text: "Indian Ocean", lat: -20, lng: 75, kind: "water" },
  { text: "Pacific Ocean", lat: 10, lng: -140, kind: "water" },
  { text: "Pacific Ocean", lat: 5, lng: 155, kind: "water" },
  ...([
    ["London", 51.5, -.12], ["Paris", 48.85, 2.35], ["Rome", 41.9, 12.5],
    ["Athens", 37.98, 23.72], ["Cairo", 30.04, 31.24], ["Istanbul", 41, 28.98],
    ["Nairobi", -1.29, 36.82], ["Cape Town", -33.92, 18.42], ["Lagos", 6.52, 3.38],
    ["New Delhi", 28.61, 77.21], ["Beijing", 39.9, 116.4], ["Tokyo", 35.68, 139.69],
    ["Bangkok", 13.76, 100.5], ["Jakarta", -6.2, 106.85], ["Sydney", -33.87, 151.21],
    ["New York", 40.71, -74], ["Mexico City", 19.43, -99.13], ["Lima", -12.05, -77.04],
    ["Buenos Aires", -34.6, -58.38], ["Rio de Janeiro", -22.91, -43.17],
  ] as [string, number, number][]).map(([text, lat, lng]) => ({ text, lat, lng, kind: "place" as const })),
];

// Matches the equirectangular UVs of Three's sphere, including the date-line seam.
const position = (lat: number, lng: number) => {
  const a = THREE.MathUtils.degToRad(lat), b = THREE.MathUtils.degToRad(lng);
  return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b));
};

async function makeTexture(signal: AbortSignal) {
  const [response, water] = await Promise.all([
    fetch(worldUrl, { signal }),
    fetch(`${import.meta.env.BASE_URL}atlas/hydrography.json`, { signal })
      .then((r) => r.ok ? r.json() as Promise<{ rivers: FeatureCollection; lakes: FeatureCollection }> : null).catch(() => null),
  ]);
  if (!response.ok) throw new Error("World geometry unavailable");
  const topology = await response.json() as Topology;
  const canvas = document.createElement("canvas");
  canvas.width = 4096; canvas.height = 2048;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#8bc7f2"; ctx.fillRect(0, 0, 4096, 2048);
  const path = geoPath(geoEquirectangular().scale(4096 / (2 * Math.PI)).translate([2048, 1024]), ctx);
  const land = feature(topology, topology.objects.land);
  // A light coastal shelf and soft country tints keep detailed geography readable.
  ctx.beginPath(); path(land); ctx.strokeStyle = "#afd9ec"; ctx.lineWidth = 7; ctx.stroke();
  ctx.fillStyle = "#c4dca7"; ctx.fill();
  const countryFeatures = feature(topology, topology.objects.countries) as FeatureCollection;
  const colors = ["#cce3b5", "#b9dfb7", "#ede0b8", "#bde1cf", "#edcfb8", "#cce4bf", "#dfdfb7"];
  for (const country of countryFeatures.features) {
    ctx.beginPath(); path(country); ctx.fillStyle = Number(country.id) === 10 ? "#eef4f4" : colors[Number(country.id) % colors.length]; ctx.fill();
  }
  const countries = topology.objects.countries as NonNullable<Parameters<typeof mesh>[1]>;
  ctx.beginPath(); path(mesh(topology, countries, (a, b) => a !== b));
  ctx.strokeStyle = "#91ac91"; ctx.lineWidth = 1; ctx.stroke();
  if (water) {
    ctx.beginPath(); path(water.rivers); ctx.strokeStyle = "#8bbfdb"; ctx.lineWidth = .9; ctx.stroke();
    ctx.beginPath(); path(water.lakes); ctx.fillStyle = "#8bc7f2"; ctx.fill();
  }
  ctx.beginPath(); path(land); ctx.strokeStyle = "#71a4ae"; ctx.lineWidth = .8; ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ring(stories: AtlasPin[]) {
  const counts = new Map<string, number>();
  stories.forEach((s) => counts.set(s.region, (counts.get(s.region) || 0) + 1));
  let at = 0;
  return `conic-gradient(${[...counts].map(([r, count]) => {
    const start = at; at += count / stories.length * 360;
    return `${ink(r)} ${start}deg ${at}deg`;
  }).join(",")})`;
}

export default function AtlasGlobe(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const api = useRef<{ redraw: () => void; focus: (s: AtlasPin) => void; rotate: (x: number, y: number) => void; zoom: (factor: number) => void; reset: () => void } | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [labels, setLabels] = useState<(MapLabel & { x: number; y: number })[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setFailed(true); latest.current.onView(latest.current.stories.map((s) => s.id)); return; }
    const abort = new AbortController();
    let disposed = false, frame = 0, lastView = "";
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    const homeDistance = () => Math.max(3.5, 1.12 / Math.sin(Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) * Math.min(camera.aspect, 1))));
    const home = () => camera.position.copy(position(25, 25).multiplyScalar(homeDistance()));
    home(); camera.lookAt(0, 0, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-label", "Interactive story globe. Drag to rotate, use arrow keys to turn and plus or minus to zoom.");
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.tabIndex = 0;
    container.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    // Let wheel gestures scroll the landing page. Explicit buttons also work on touch screens.
    controls.enableZoom = false;
    controls.enableDamping = false;
    controls.rotateSpeed = .65;
    controls.minPolarAngle = .12; controls.maxPolarAngle = Math.PI - .12;
    const geometry = new THREE.SphereGeometry(1, 128, 96);
    const material = new THREE.MeshPhongMaterial({ color: "#ffffff", shininess: 5 });
    scene.add(new THREE.Mesh(geometry, material));
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const light = new THREE.DirectionalLight(0xfffaf2, 1.6);
    light.position.set(-3, 4, 5); camera.add(light); scene.add(camera);

    const draw = () => {
      frame = 0;
      if (disposed) return;
      const width = container.clientWidth, height = container.clientHeight;
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      const points: Marker[] = [];
      const ids: string[] = [];
      for (const story of latest.current.stories) {
        const normal = position(story.lat, story.lng);
        // Perspective horizon test: points on the far side must never be clickable.
        if (normal.dot(camera.position.clone().sub(normal)) <= .04) continue;
        const point = normal.multiplyScalar(1.006).project(camera);
        if (Math.abs(point.x) > .96 || Math.abs(point.y) > .9) continue;
        const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
        ids.push(story.id);
        const group = points.find((p) => Math.hypot(p.x - x, p.y - y) < 32);
        if (group) group.stories.push(story); else points.push({ x, y, stories: [story] });
      }
      setMarkers(points);
      const nextLabels: (MapLabel & { x: number; y: number })[] = [];
      for (const label of LETTERING) {
        if (label.kind === "place" && camera.position.length() > homeDistance() * .9) continue;
        const normal = position(label.lat, label.lng);
        if (normal.dot(camera.position.clone().normalize()) < .55) continue;
        const p = normal.multiplyScalar(1.003).project(camera);
        const x = (p.x + 1) * width / 2, y = (1 - p.y) * height / 2;
        if (Math.abs(p.x) > .8 || Math.abs(p.y) > .8 || points.some((m) => Math.hypot(m.x - x, m.y - y) < 40)) continue;
        if (nextLabels.some((l) => Math.abs(l.x - x) < 85 && Math.abs(l.y - y) < 22)) continue;
        nextLabels.push({ ...label, x, y });
      }
      setLabels(nextLabels);
      const signature = ids.join("|");
      if (signature !== lastView) { lastView = signature; latest.current.onView(ids); }
    };
    const redraw = () => { if (!frame && !disposed) frame = requestAnimationFrame(draw); };
    const rotate = (x: number, y: number) => {
      const s = new THREE.Spherical().setFromVector3(camera.position);
      s.theta += x; s.phi = THREE.MathUtils.clamp(s.phi + y, .12, Math.PI - .12);
      camera.position.setFromSpherical(s); controls.update(); redraw();
    };
    const zoom = (factor: number) => {
      camera.position.setLength(THREE.MathUtils.clamp(camera.position.length() * factor, 1.55, Math.max(5, homeDistance())));
      controls.update(); redraw();
    };
    api.current = {
      redraw, rotate, zoom,
      reset: () => { home(); controls.update(); redraw(); },
      focus: (story) => { camera.position.copy(position(story.lat, story.lng).multiplyScalar(Math.max(2.6, homeDistance() * .75))); controls.update(); redraw(); },
    };
    const keydown = (event: KeyboardEvent) => {
      const moves: Record<string, [number, number]> = { ArrowLeft: [-.16, 0], ArrowRight: [.16, 0], ArrowUp: [0, -.16], ArrowDown: [0, .16] };
      if (moves[event.key]) { event.preventDefault(); rotate(...moves[event.key]); }
      if (["+", "=", "-", "Home"].includes(event.key)) {
        event.preventDefault(); if (event.key === "Home") api.current?.reset(); else zoom(event.key === "-" ? 1.2 : 1 / 1.2);
      }
    };
    const lost = (event: Event) => { event.preventDefault(); setFailed(true); latest.current.onView(latest.current.stories.map((s) => s.id)); };
    renderer.domElement.addEventListener("keydown", keydown);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    controls.addEventListener("change", redraw);
    const resize = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      const previousDistance = homeDistance();
      camera.aspect = w / h;
      camera.position.multiplyScalar(homeDistance() / previousDistance);
      camera.updateProjectionMatrix(); controls.update(); renderer.setSize(w, h); redraw();
    });
    resize.observe(container);
    makeTexture(abort.signal).then((texture) => {
      if (disposed) { texture.dispose(); return; }
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      material.map = texture; material.needsUpdate = true; setReady(true); redraw();
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => {
      disposed = true; abort.abort(); cancelAnimationFrame(frame); resize.disconnect();
      renderer.domElement.removeEventListener("keydown", keydown);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      controls.dispose(); geometry.dispose(); material.map?.dispose(); material.dispose(); renderer.dispose();
      renderer.domElement.remove(); api.current = null;
    };
  }, []);

  useEffect(() => { if (failed) props.onView(props.stories.map((s) => s.id)); else api.current?.redraw(); }, [props.stories, props.selectedId, failed]);
  useEffect(() => {
    const story = props.stories.find((s) => s.id === props.focus?.id);
    if (story) api.current?.focus(story);
  }, [props.focus]);

  return <div className="atlas-globe">
    <div className="globe-stage" ref={host} />
    {!ready && !failed && <div className="globe-status" role="status">Charting a world of stories…</div>}
    {failed ? <div className="globe-status"><b>The 3D globe is unavailable.</b><p>You can still search and open every story.</p><button className="secondary" onClick={props.onFallback}>Open the flat map</button></div> : <>
      {ready && <div className="globe-labels" aria-hidden="true">{labels.map((label) => <span key={`${label.text}-${label.lng}`} className={label.kind} style={{ left: label.x, top: label.y }}>{label.text}</span>)}</div>}
      {ready && <div className="globe-pins">{markers.map((m) => {
        const selected = m.stories.some((s) => s.id === props.selectedId);
        const single = m.stories.length === 1;
        return <button key={m.stories[0].id} className={`globe-pin ${single ? "single" : "cluster"}${selected ? " selected" : ""}`}
          style={{ left: m.x, top: m.y, background: ring(m.stories) }}
          aria-label={single ? `${m.stories[0].title} · ${m.stories[0].place}` : `Explore ${m.stories.length} stories near ${m.stories[0].place}`}
          title={single ? m.stories[0].title : `${m.stories.length} stories · select to browse`}
          onClick={() => single ? props.onSelect(m.stories[0].id) : props.onCluster(m.stories.map((s) => s.id))}>
          {!single && <b>{m.stories.length}</b>}
        </button>;
      })}</div>}
      <div className="globe-controls" aria-label="Globe controls">
        <button aria-label="Zoom in" onClick={() => api.current?.zoom(1 / 1.2)}>+</button>
        <button aria-label="Zoom out" onClick={() => api.current?.zoom(1.2)}>−</button>
        <button aria-label="Rotate west" onClick={() => api.current?.rotate(-.3, 0)}>←</button>
        <button aria-label="Rotate east" onClick={() => api.current?.rotate(.3, 0)}>→</button>
        <button aria-label="Reset globe" onClick={() => api.current?.reset()}>⌂</button>
      </div>
      <div className="globe-caption"><span>DRAG TO DISCOVER</span><small>Natural Earth · A world of stories</small></div>
    </>}
  </div>;
}
