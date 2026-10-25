import L from "leaflet";

// leaflet.markercluster is a UMD plugin that extends the global L; expose it before that import runs.
(window as unknown as { L: typeof L }).L = L;
export default L;
