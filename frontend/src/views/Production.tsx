import { useMemo, useState } from "react";
import { download, slug, toCsv } from "../data";
import { useStudio } from "../store";
import type { Scene } from "../types";
import { Icon, PageTitle } from "../ui";

type Line = { id: string; item: string; qty: number; low: string; high: string };
type Day = { date: string; night: boolean; scenes: Scene[]; used: number };
const cents = (s: string) => { const m = s.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/); return m ? Number(m[1]) * 100 + Number((m[2] || "0").padEnd(2, "0")) : NaN; };
const money = (c: number, cur: string) => new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(c / 100);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Production() {
  const { project, updateProject, notify } = useStudio();
  const [c, setC] = useState({ region: "", start: iso(new Date(Date.now() + 14 * 86400000)), currency: "USD", dayHours: 10, setup: 45, ratio: 50, contingency: 10, cap: "25000", weekends: false, blackouts: "" });
  const [lines, setLines] = useState<Line[]>([
    { id: "crew", item: "Crew day rate", qty: 0, low: "1800", high: "2600" },
    { id: "loc", item: "Location fee per day", qty: 0, low: "400", high: "1200" },
    { id: "kit", item: "Camera and lighting kit", qty: 0, low: "650", high: "900" },
    { id: "ins", item: "Insurance", qty: 1, low: "0", high: "0" },
  ]);
  const setScene = (id: string, patch: Partial<Scene>) => updateProject(project.id, (p) => ({ scenes: p.scenes.map((s) => s.id === id ? { ...s, ...patch } : s) }));

  const { days, unresolved } = useMemo(() => {
    const cap = c.dayHours * 60, blackout = new Set(c.blackouts.split(",").map((x) => x.trim()).filter(Boolean));
    const cursor = new Date(`${c.start}T12:00:00`), days: Day[] = [], unresolved: Scene[] = [];
    const nextDate = () => { while (blackout.has(iso(cursor)) || (!c.weekends && [0, 6].includes(cursor.getDay()))) cursor.setDate(cursor.getDate() + 1); const d = iso(cursor); cursor.setDate(cursor.getDate() + 1); return d; };
    for (const night of [false, true]) {
      if (night && days.length) cursor.setDate(cursor.getDate() + 1); // turnaround buffer when switching to nights
      let day: Day | null = null, lastLoc = "";
      for (const s of project.scenes.filter((x) => x.night === night)) {
        const need = s.minutes * c.ratio + (s.location !== lastLoc ? c.setup : 0);
        if (s.minutes * c.ratio + c.setup > cap) { unresolved.push(s); continue; }
        if (!day || day.used + need > cap) { day = { date: nextDate(), night, scenes: [], used: 0 }; days.push(day); lastLoc = ""; }
        day.used += s.minutes * c.ratio + (s.location !== lastLoc ? c.setup : 0); day.scenes.push(s); lastLoc = s.location;
      }
    }
    return { days, unresolved };
  }, [project.scenes, c]);

  const qty = (l: Line) => (l.id === "crew" || l.id === "kit" ? days.length : l.id === "loc" ? new Set(days.flatMap((d) => d.scenes.map((s) => `${d.date}|${s.location}`))).size : l.qty);
  const priced = lines.map((l) => ({ ...l, q: qty(l), lo: cents(l.low), hi: cents(l.high) }));
  const invalid = priced.filter((l) => Number.isNaN(l.lo) || Number.isNaN(l.hi) || l.lo > l.hi);
  const unknown = priced.filter((l) => l.lo === 0 && l.hi === 0);
  const sub = priced.filter((l) => !invalid.includes(l)).reduce((a, l) => ({ lo: a.lo + l.lo * l.q, hi: a.hi + l.hi * l.q }), { lo: 0, hi: 0 });
  const cont = { lo: Math.round((sub.lo * c.contingency) / 100), hi: Math.round((sub.hi * c.contingency) / 100) };
  const total = { lo: sub.lo + cont.lo, hi: sub.hi + cont.hi }, capC = cents(c.cap);

  const name = slug(project.title);
  const exportAll = (kind: string) => {
    if (kind === "schedule.csv") download(`${name}-schedule.csv`, toCsv([["date", "window", "scene", "location", "cast", "screen_minutes"], ...days.flatMap((d) => d.scenes.map((s) => [d.date, d.night ? "night" : "day", s.title, s.location, s.pov, s.minutes]))]), "text/csv");
    if (kind === "budget.csv") download(`${name}-budget.csv`, toCsv([["item", "qty", "low", "high"], ...priced.map((l) => [l.item, l.q, l.low, l.high]), ["contingency %", c.contingency, "", ""]]), "text/csv");
    if (kind === "tasks.csv") download(`${name}-tasks.csv`, toCsv([["task", "status"], ["Confirm locations and permits", "open"], ["Confirm cast availability", "open"], ["Safety review", "open"], ...unknown.map((l) => [`Get a quote: ${l.item}`, "open"])]), "text/csv");
    if (kind === "calendar.ics") {
      const ev = days.map((d, i) => `BEGIN:VEVENT\nUID:${name}-${i}@paramyth.local\nDTSTART;VALUE=DATE:${d.date.replace(/-/g, "")}\nSUMMARY:${project.title} · ${d.night ? "Night" : "Day"} shoot (tentative)\nDESCRIPTION:${d.scenes.map((s) => s.title).join(", ")}\nSTATUS:TENTATIVE\nCLASS:PRIVATE\nEND:VEVENT`).join("\n");
      download(`${name}-calendar.ics`, `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//ParaMyth//Studio//EN\n${ev}\nEND:VCALENDAR`, "text/calendar");
    }
    if (kind === "call-sheets.txt") download(`${name}-call-sheets.txt`, days.map((d, i) => `CALL SHEET — DAY ${i + 1} — ${d.date} (${d.night ? "night" : "day"}) — DRAFT\n${d.scenes.map((s) => `  ${s.title} · ${s.location || "LOCATION TBC"} · cast: ${s.pov || "TBC"}`).join("\n")}\n  Contacts: UNCONFIRMED · Safety: UNCONFIRMED · Parking/power: UNCONFIRMED`).join("\n\n"));
    if (kind === "plan.json") download(`${name}-plan.json`, JSON.stringify({ project: project.title, constraints: c, days: days.map((d) => ({ ...d, scenes: d.scenes.map((s) => s.id) })), unresolved: unresolved.map((s) => s.id), budget: priced, totals: total }, null, 2), "application/json");
    notify(`${kind} downloaded`);
  };

  return <div className="page">
    <PageTitle eyebrow="PRODUCTION PLANNING" title="Production" text="Draft breakdown, single-unit schedule and budget from the manuscript. Recalculation is local; research and synthesis need provider connections. Nothing here books venues or establishes legal approval." />
    <div className="production-layout">
      <section className="panel"><span className="eyebrow">CONSTRAINTS</span><h2>Shoot</h2>
        <div className="form-grid">
          <label className="field">Filming region<input value={c.region} placeholder="Required for research" onChange={(e) => setC({ ...c, region: e.target.value })} /></label>
          <label className="field">Start date<input type="date" value={c.start} onChange={(e) => setC({ ...c, start: e.target.value })} /></label>
          <label className="field">Day length (h)<input type="number" min={4} max={14} value={c.dayHours} onChange={(e) => setC({ ...c, dayHours: Number(e.target.value) })} /></label>
          <label className="field">Setup / move (min)<input type="number" value={c.setup} onChange={(e) => setC({ ...c, setup: Number(e.target.value) })} /></label>
          <label className="field">Shoot min per screen min<input type="number" value={c.ratio} onChange={(e) => setC({ ...c, ratio: Number(e.target.value) })} /></label>
          <label className="field">Currency<select value={c.currency} onChange={(e) => setC({ ...c, currency: e.target.value })}>{["USD", "EUR", "GBP", "INR", "CAD"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="field">Contingency %<input type="number" value={c.contingency} onChange={(e) => setC({ ...c, contingency: Number(e.target.value) })} /></label>
          <label className="field">Budget cap<input value={c.cap} onChange={(e) => setC({ ...c, cap: e.target.value })} /></label>
        </div>
        <label className="field">Blackout dates (YYYY-MM-DD, comma separated)<input value={c.blackouts} onChange={(e) => setC({ ...c, blackouts: e.target.value })} /></label>
        <label className="toggle"><input type="checkbox" checked={c.weekends} onChange={(e) => setC({ ...c, weekends: e.target.checked })} />Shoot on weekends</label>
        {!c.region.trim() && <p className="hint">Web research is skipped until a real filming region is set.</p>}
      </section>
      <section className="panel"><span className="eyebrow">NARRATIVE BREAKDOWN</span><h2>Scenes</h2>
        <table className="data"><thead><tr><th>Scene</th><th>Location</th><th>Cast</th><th>Screen min</th><th>Night</th></tr></thead><tbody>
          {project.scenes.map((s) => <tr key={s.id}><td>{s.title}</td><td><input aria-label="Location" value={s.location} onChange={(e) => setScene(s.id, { location: e.target.value })} /></td><td>{s.pov || "—"}</td><td><input aria-label="Screen minutes" type="number" min={1} value={s.minutes} onChange={(e) => setScene(s.id, { minutes: Math.max(1, Number(e.target.value)) })} /></td><td><input aria-label="Night scene" type="checkbox" checked={s.night} onChange={(e) => setScene(s.id, { night: e.target.checked })} /></td></tr>)}
        </tbody></table>
      </section>
    </div>
    <div className="production-layout">
      <section className="panel"><span className="eyebrow">DRAFT SCHEDULE</span><h2>{days.length} shoot day{days.length === 1 ? "" : "s"}</h2>
        <div className="schedule">{days.map((d, i) => <div key={d.date} className={d.night ? "night" : ""}><b>Day {i + 1}</b><small>{new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {d.night ? "Night" : "Day"} · {Math.round(d.used / 6) / 10}h of {c.dayHours}h</small><ul>{d.scenes.map((s) => <li key={s.id}>{s.title}<span>{s.location || "Location TBC"}</span></li>)}</ul></div>)}</div>
        {unresolved.length > 0 && <p className="stale">Unresolved: {unresolved.map((s) => s.title).join(", ")} — longer than one shoot day.</p>}
        <p className="hint">Single-unit, dependency-ordered, with a turnaround buffer before night work. Not an optimizer or labour-compliance engine.</p>
      </section>
      <section className="panel"><span className="eyebrow">EDITABLE BUDGET</span><h2>{money(total.lo, c.currency)} – {money(total.hi, c.currency)}</h2>
        <table className="data"><thead><tr><th>Item</th><th>Qty</th><th>Low</th><th>High</th></tr></thead><tbody>
          {priced.map((l) => <tr key={l.id} className={invalid.includes(l) ? "bad" : ""}><td>{l.item}</td><td>{["crew", "kit", "loc"].includes(l.id) ? l.q : <input type="number" value={l.qty} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value) } : x))} />}</td>
            <td><input value={l.low} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, low: e.target.value } : x))} /></td><td><input value={l.high} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, high: e.target.value } : x))} /></td></tr>)}
        </tbody></table>
        <button className="text-action" onClick={() => setLines([...lines, { id: String(Date.now()), item: "New line", qty: 1, low: "0", high: "0" }])}><Icon name="plus" size={15} />Add line</button>
        <dl className="provenance"><dt>Subtotal</dt><dd>{money(sub.lo, c.currency)} – {money(sub.hi, c.currency)}</dd><dt>Contingency {c.contingency}%</dt><dd>{money(cont.lo, c.currency)} – {money(cont.hi, c.currency)}</dd><dt>Cap</dt><dd className={!Number.isNaN(capC) && total.hi > capC ? "over" : ""}>{Number.isNaN(capC) ? "invalid" : money(capC, c.currency)}{!Number.isNaN(capC) && total.hi > capC ? " · high estimate exceeds cap" : ""}</dd></dl>
        {invalid.length > 0 && <p className="stale">Invalid rates: {invalid.map((l) => l.item).join(", ")}. Use plain amounts with up to two decimals and low ≤ high.</p>}
        {unknown.length > 0 && <p className="hint">Excluded unknown zero-rate items: {unknown.map((l) => l.item).join(", ")}.</p>}
      </section>
    </div>
    <section className="panel exports"><span className="eyebrow">EXPORTS</span><h2>Production export set</h2>
      <div className="export-row">{["schedule.csv", "budget.csv", "tasks.csv", "calendar.ics", "call-sheets.txt", "plan.json"].map((k) => <button key={k} className="secondary" onClick={() => exportAll(k)}><Icon name="download" size={15} />{k}</button>)}</div>
      <p className="hint">Spreadsheet cells that look like formulas are neutralised. ICS events are tentative and private; import into Google, Outlook or Apple Calendar.</p>
    </section>
  </div>;
}
