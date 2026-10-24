import { useState } from "react";
import { seedStore } from "../data";
import { useStudio } from "../store";
import { Icon, PageTitle, Status } from "../ui";

const PROVIDERS = [
  ["MUSE_IMAGE_API_KEY", "Meta Muse Image", "Primary image rendering"],
  ["VULTR_INFERENCE_API_KEY", "Vultr inference", "Creative prompts, production synthesis, music, image backup"],
  ["SERPAPI_API_KEY", "SerpAPI", "Scouting, logistics and legal research"],
  ["GITHUB_TOKEN", "GitHub", "Workflow dispatch, history, logs and artifacts"],
  ["GOOGLE_OAUTH", "Google Calendar", "Explicit tentative calendar sync"],
] as const;

type Check = { state: "idle" | "checking" | "ok" | "fail"; detail: string };

export default function Connections() {
  const { setStore, notify } = useStudio();
  const [base, setBase] = useState(() => { try { return localStorage.getItem("paramyth-api-base") || "http://127.0.0.1:8000"; } catch { return "http://127.0.0.1:8000"; } });
  const [check, setCheck] = useState<Check>({ state: "idle", detail: "" });

  const test = async () => {
    try { localStorage.setItem("paramyth-api-base", base); } catch { /* optional */ }
    setCheck({ state: "checking", detail: "" });
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}/api/v1/health`, { signal: AbortSignal.timeout(4000) });
      setCheck(r.ok ? { state: "ok", detail: `Health ${r.status}` } : { state: "fail", detail: `HTTP ${r.status}` });
    } catch (e) { setCheck({ state: "fail", detail: e instanceof Error ? e.message : "Unreachable" }); }
  };
  return <div className="page">
    <PageTitle eyebrow="WORKSPACE" title="Connections" text="Point the frontend at a running ParaMyth studio and supply provider connections for the server process. Credentials are never saved in this browser or in project records." />
    <div className="production-layout">
      <section className="panel"><span className="eyebrow">STUDIO API</span><h2>Backend</h2>
        <label className="field">API base URL<input value={base} onChange={(e) => setBase(e.target.value)} /></label>
        <div className="detail-actions"><button className="primary" onClick={test} disabled={check.state === "checking"}><Icon name="refresh" size={15} />{check.state === "checking" ? "Checking…" : "Check health"}</button>{check.state !== "idle" && check.state !== "checking" && <Status>{check.state === "ok" ? "Connected" : "Unreachable"}</Status>}</div>
        {check.detail && <p className="hint">{check.detail}</p>}
        <p className="hint">The workspace is local-first and validates local requests; it is not a hosted multi-user service.</p>
      </section>
      <section className="panel"><span className="eyebrow">PROVIDERS</span><h2>What each connection enables</h2>
        {PROVIDERS.map(([k, name, use]) => <div className="team-row" key={k}><b>{name}</b><span>{use} · <code>{k}</code></span></div>)}
        <a className="primary link-button" href={`${base.replace(/\/$/, "")}/connections`} target="_blank" rel="noreferrer"><Icon name="connections" size={15} />Open studio connections</a>
        <p className="hint">Credentials are entered on the studio server's own page. They stay in that process, are not echoed back, and are never saved in this browser or in project records.</p>
      </section>
    </div>
    <section className="panel"><span className="eyebrow">DEMO WORKSPACE</span><h2>Team and data</h2>
      {[["Maya Chen", "Brand director · Admin"], ["Leo Martin", "Writer · Editor"], ["Priya Shah", "Strategist · Reviewer"]].map((x) => <div className="team-row" key={x[0]}><b>{x[0]}</b><span>{x[1]}</span></div>)}
      <p className="demo-callout">Demo identities and roles are illustrative. Projects, runs and media records are stored in this browser under paramyth-studio-v3.</p>
      <button className="secondary" onClick={() => { if (confirm("Reset all demo projects, runs and media records in this browser?")) { setStore(() => seedStore()); notify("Demo data reset"); } }}>Reset demo data</button>
    </section>
  </div>;
}
