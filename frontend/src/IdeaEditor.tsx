import { useId } from "react";
export type InlineSuggestion = { aspect?: string; quote?: string; replacement?: string; suggestion?: string; reason?: string; answer?: string };
export default function IdeaEditor({ value, onChange, suggestions, onSuggestions, pending, onStart, startDisabled }: {value:string; onChange:(text:string)=>void; suggestions:InlineSuggestion[]; onSuggestions:(items:InlineSuggestion[])=>void; pending?:()=>void; onStart?:()=>void; startDisabled?:boolean}) {
  const id=useId();
  const remove=(index:number)=>onSuggestions(suggestions.filter((_,i)=>i!==index));
  const accept=(item:InlineSuggestion,index:number)=>{
    const text=item.answer?.trim() || item.replacement || "";
    if(!text)return;
    onChange(item.quote && value.includes(item.quote) ? value.replace(item.quote,text) : [value,text].filter(Boolean).join("\n\n"));
    remove(index);
  };
  return <div className="idea-editor">
    <div className="idea-editor-head"><label htmlFor={id}>Your idea</label>{onStart && <button className="primary" disabled={startDisabled} onClick={onStart}>Start writing</button>}</div>
    <textarea id={id} value={value} onChange={e=>onChange(e.target.value)} maxLength={20000} placeholder="Describe what you want to happen in this chapter. A few words are enough." />
    <p className="idea-gap-note">Leave details blank and we’ll fill them in to fit your idea and earlier chapters. You can revise every choice.</p>
    {!!suggestions.length && <section className="idea-detail-cards" aria-label="Suggested story details"><h3>Details you can shape</h3><p>Accept a suggestion, add your own detail, or leave it for us to decide.</p>{suggestions.map((item,index)=><article key={index}>
      <h4>{item.aspect || item.suggestion || "Suggested detail"}</h4>{item.aspect && <p>{item.suggestion}</p>}
      {item.replacement && <blockquote>{item.replacement}</blockquote>}
      <label className="field">Your detail · optional<textarea aria-label={`Your detail for ${item.aspect || item.suggestion || index+1}`} value={item.answer || ""} maxLength={3000} onChange={e=>onSuggestions(suggestions.map((v,i)=>i===index?{...v,answer:e.target.value}:v))} placeholder="Write your own choice, or leave this blank." /></label>
      <div className="comment-actions"><button disabled={!item.answer?.trim() && !item.replacement} onClick={()=>accept(item,index)}>{item.answer?.trim()?"Use my detail":"Accept suggestion"}</button><button onClick={()=>remove(index)}>Dismiss</button></div>
    </article>)}</section>}
    {pending && <div className="proposal-copy"><small>Your developed idea is ready. Your edits are still here.</small><button type="button" onClick={pending}>Review developed idea</button></div>}
  </div>;
}
