import { useEffect, useRef } from "react";
import L from "../leaflet-global";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { feature, mesh } from "topojson-client";
import worldUrl from "world-atlas/countries-50m.json?url";
import { ink } from "../atlas";
import type { AtlasPin } from "../types";

type Topology = Parameters<typeof mesh>[0];
// Natural Earth 1:50m, fetched as a static asset rather than parsed as part of the script.
let geometry: Promise<Topology> | null = null;
const loadGeometry = () => (geometry ??= fetch(worldUrl).then((r) => r.json() as Promise<Topology>));

/** Map lettering, placed the way a printed atlas would: continents in spaced capitals, waters in italics. */
const LETTERING: [string, number, number, "continent" | "sea"][] = [
  ["Europe", 53, 22, "continent"], ["Africa", 6, 20, "continent"], ["Asia", 50, 92, "continent"], ["North America", 47, -103, "continent"],
  ["South America", -14, -60, "continent"], ["Australia", -25, 133, "continent"],
  ["Atlantic Ocean", 28, -42, "sea"], ["Indian Ocean", -18, 76, "sea"], ["Pacific Ocean", 12, -150, "sea"], ["Pacific Ocean", 20, 160, "sea"],
  ["Arctic Ocean", 79, 10, "sea"], ["Mediterranean Sea", 34.4, 18.5, "sea"], ["North Sea", 56.4, 3.4, "sea"], ["Baltic Sea", 57.8, 19.4, "sea"],
  ["Black Sea", 43.2, 34.6, "sea"], ["Caspian Sea", 41.6, 50.8, "sea"], ["Arabian Sea", 15, 63, "sea"], ["Bay of Bengal", 14, 88.5, "sea"],
  ["Sea of Japan", 40.5, 134.5, "sea"], ["Gulf of Mexico", 25, -90.5, "sea"], ["Red Sea", 20.5, 38.6, "sea"], ["Norwegian Sea", 68, 2, "sea"],
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const pinIcon = (s: AtlasPin, selected: boolean) => L.divIcon({
  className: `atlas-pin${selected ? " selected" : ""}`, html: `<i style="--ink:${ink(s.region)}"></i>`,
  iconSize: selected ? [26, 26] : [16, 16],
});

type Props = {
  stories: AtlasPin[];
  selectedId: string | null;
  /** Changes whenever the map should bring a story into view (list clicks); clicks on the map itself do not. */
  focus: { id: string; at: number } | null;
  onSelect: (id: string) => void;
  onView: (ids: string[]) => void;
};

export default function AtlasMap({ stories, selectedId, focus, onSelect, onView }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const cluster = useRef<L.MarkerClusterGroup | null>(null);
  const markers = useRef(new Map<string, { marker: L.Marker; pin: AtlasPin }>());
  const latest = useRef({ stories, onSelect, onView, selectedId });
  latest.current = { stories, onSelect, onView, selectedId };

  const reportView = () => {
    const m = map.current;
    if (!m) return;
    const b = m.getBounds();
    latest.current.onView(latest.current.stories.filter((s) => b.contains([s.lat, s.lng])).map((s) => s.id));
  };

  useEffect(() => {
    const m = L.map(el.current!, {
      center: [38, 30], zoom: el.current!.clientWidth < 600 ? 2 : 3, minZoom: 2, maxZoom: 10, zoomSnap: 0.5, zoomControl: false, worldCopyJump: false,
      // This view can unmount immediately when switching back to the globe.
      // Leaflet's CSS zoom timeout can otherwise fire against its removed panes.
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
      maxBounds: [[-62, -200], [84, 200]], maxBoundsViscosity: 0.9, attributionControl: false,
    });
    map.current = m;
    m.createPane("land").style.zIndex = "200";
    m.createPane("relief").style.zIndex = "250";
    m.createPane("ink").style.zIndex = "300";
    m.createPane("lettering").style.zIndex = "350";
    m.getPane("lettering")!.style.pointerEvents = "none";

    const grid: L.LatLngExpression[][] = [];
    for (let lng = -180; lng <= 180; lng += 20) grid.push([[-85, lng], [85, lng]]);
    for (let lat = -60; lat <= 80; lat += 20) grid.push([[lat, -200], [lat, 200]]);
    L.polyline(grid, { pane: "land", className: "atlas-graticule", interactive: false }).addTo(m);
    L.polyline([[0, -200], [0, 200]], { pane: "land", className: "atlas-equator", interactive: false }).addTo(m);
    loadGeometry().then((topo) => {
      if (map.current !== m) return;
      const objects = topo.objects as unknown as Record<"land" | "countries", NonNullable<Parameters<typeof mesh>[1]>>;
      const land = feature(topo, objects.land);
      // A soft halo under the coastline, the way engraved atlases shade inshore water.
      L.geoJSON(land, { pane: "land", interactive: false, style: { className: "atlas-coast-halo" } }).addTo(m);
      L.geoJSON(land, { pane: "land", interactive: false, style: { className: "atlas-land" } }).addTo(m);
      L.geoJSON(mesh(topo, objects.countries, (a, b) => a !== b), { pane: "ink", interactive: false, style: { className: "atlas-border" } }).addTo(m);
    });
    // Hill shading multiplied over the parchment land; the map still reads as a map when tiles are unreachable.
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}", {
      pane: "relief", maxNativeZoom: 13, className: "atlas-relief", crossOrigin: true,
    }).addTo(m);
    for (const [text, lat, lng, kind] of LETTERING)
      L.marker([lat, lng], { pane: "lettering", interactive: false, keyboard: false, icon: L.divIcon({ className: `atlas-lettering ${kind}`, html: `<span>${text}</span>`, iconSize: [0, 0] }) }).addTo(m);

    L.control.zoom({ position: "topright" }).addTo(m);
    L.control.scale({ position: "bottomright", maxWidth: 110 }).addTo(m);
    L.control.attribution({ position: "bottomright", prefix: false }).addAttribution("Natural Earth · Relief © Esri").addTo(m);

    cluster.current = L.markerClusterGroup({
      maxClusterRadius: 44, showCoverageOnHover: false, spiderfyOnMaxZoom: true, spiderLegPolylineOptions: { weight: 1, color: "#203970", opacity: 0.5 },
      iconCreateFunction: (c) => {
        // Ring segments show which traditions share the cluster, like a thematic map's pie symbols.
        const kids = c.getAllChildMarkers(), n = kids.length, counts = new Map<string, number>();
        for (const k of kids) { const r = (k.options as { region?: string }).region || ""; counts.set(r, (counts.get(r) || 0) + 1); }
        let at = 0;
        const stops = [...counts].sort((a, b) => b[1] - a[1]).map(([r, v]) => { const from = at; at += (v / n) * 360; return `${ink(r)} ${from}deg ${at}deg`; }).join(",");
        const size = n < 10 ? 32 : n < 40 ? 40 : 48;
        return L.divIcon({ className: "atlas-cluster", html: `<div style="background:conic-gradient(${stops})"><b>${n}</b></div>`, iconSize: [size, size] });
      },
    }).addTo(m);

    m.on("moveend", reportView);
    m.on("zoomend", () => el.current?.setAttribute("data-zoom", String(Math.floor(m.getZoom()))));
    el.current!.setAttribute("data-zoom", String(m.getZoom()));
    return () => { m.remove(); map.current = null; cluster.current = null; markers.current.clear(); };
  }, []);

  useEffect(() => {
    const group = cluster.current;
    if (!group) return;
    group.clearLayers();
    markers.current.clear();
    const layer = stories.map((s) => {
      const marker = L.marker([s.lat, s.lng], { icon: pinIcon(s, s.id === latest.current.selectedId), title: s.title, alt: s.title, riseOnHover: true, region: s.region } as L.MarkerOptions);
      marker.bindTooltip(`<b>${esc(s.title)}</b><span>${esc(s.place)}</span>`, { direction: "top", offset: [0, -9], className: "atlas-tip" });
      marker.on("click", () => latest.current.onSelect(s.id));
      markers.current.set(s.id, { marker, pin: s });
      return marker;
    });
    group.addLayers(layer);
    reportView();
  }, [stories]);

  const shown = useRef<string | null>(null);
  useEffect(() => {
    for (const id of [shown.current, selectedId]) {
      const hit = id && markers.current.get(id);
      if (hit) { hit.marker.setIcon(pinIcon(hit.pin, id === selectedId)); hit.marker.setZIndexOffset(id === selectedId ? 1000 : 0); }
    }
    shown.current = selectedId;
  }, [selectedId, stories]);

  useEffect(() => {
    const hit = focus && markers.current.get(focus.id);
    if (hit && cluster.current) cluster.current.zoomToShowLayer(hit.marker, () => map.current?.panTo(hit.marker.getLatLng(), { animate: true }));
  }, [focus]);

  return <div ref={el} className="atlas-map" role="application" aria-label="Story atlas map" />;
}
