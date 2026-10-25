import { useState } from "react";
export type InlineSuggestion = { quote?: string; replacement?: string; suggestion?: string; reason?: string };
export default function IdeaEditor({ value, onChange, suggestions, onSuggestions, pending }: {value: string; onChange: (text: string) => void; suggestions: InlineSuggestion[]; onSuggestions: (items: InlineSuggestion[]) => void; pending?: () => void}) {
  const [editing, setEditing] = useState(false);
  const remove = (index: number) => onSuggestions(suggestions.filter((_, i) => i !== index));
  const accept = (suggestion: InlineSuggestion, index: number) => {
    const quote = suggestion.quote || "", replacement = suggestion.replacement || "";
    if (!replacement || (quote && !value.includes(quote))) return;
    onChange(quote ? value.replace(quote, replacement) : value + "\n\n" + replacement);
    remove(index);
  };
  const pieces: React.ReactNode[] = [];
  const placed = new Set<number>();
  let offset = 0;
  const positions = suggestions.map((item, index) => ({item, index, at: item.quote ? value.indexOf(item.quote) : value.length})).filter((v) => v.at >= 0).sort((a,b) => a.at-b.at);
  for (const {item, index, at} of positions) {
    if (at < offset) continue;
    placed.add(index);
    pieces.push(value.slice(offset, at));
    pieces.push(<span className="inline-proposal" key={index}>
      {item.quote && <mark>{item.quote}</mark>}
      <span className="proposal-copy"><small>{item.suggestion || "Suggested change"}</small>{item.replacement && <ins>{item.replacement}</ins>}<small>{item.reason}</small>
        <span className="proposal-actions">{item.replacement && <button type="button" onClick={() => accept(item,index)}>Accept</button>}<button type="button" onClick={() => remove(index)}>Dismiss</button></span>
      </span>
    </span>);
    offset = at + (item.quote?.length || 0);
  }
  pieces.push(value.slice(offset));
  suggestions.forEach((item, index) => {
    if (!placed.has(index)) pieces.push(<span className="proposal-copy" key={`unplaced-${index}`}><small>{item.suggestion || "Suggested change"}</small>{item.quote && <q>{item.quote}</q>}<ins>{item.replacement}</ins><small>{item.reason} This passage has changed. Edit the text to use this suggestion.</small><button type="button" onClick={() => remove(index)}>Dismiss</button></span>);
  });
  return <div className="idea-editor">
    <div className="idea-editor-head"><label htmlFor="idea-text">Your idea</label>{suggestions.length > 0 && <button type="button" className="text-action" onClick={() => setEditing(!editing)}>{editing ? "Review suggestions" : "Edit text"}</button>}</div>
    {!suggestions.length || editing ? <textarea id="idea-text" value={value} onChange={(e) => onChange(e.target.value)} maxLength={20000} placeholder="A lighthouse keeper starts receiving letters from the future…" /> : <div id="idea-text" className="idea-review" role="textbox" aria-label="Your idea with inline suggestions" aria-multiline="true" aria-readonly="true" tabIndex={0}>{pieces}</div>}
    {pending && <div className="proposal-copy"><small>Your developed idea is ready. You edited the text while it was running; your edits are still here.</small><button type="button" onClick={pending}>Replace with developed idea and review</button></div>}
  </div>;
}
