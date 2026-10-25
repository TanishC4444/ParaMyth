import { useEffect, useRef, type RefObject } from 'react'

export function useDialogFocus(ref:RefObject<HTMLElement|null>, open:boolean, close:()=>void, busy=false) {
  const latest=useRef({close,busy});latest.current={close,busy}
  useEffect(()=>{
    if(!open)return
    const previous=document.activeElement as HTMLElement|null, overflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    const items=()=>[...(ref.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])].filter(element=>element.getClientRects().length)
    ;(ref.current?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || items()[0])?.focus()
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape' && !latest.current.busy){event.preventDefault();event.stopPropagation();latest.current.close()}
      if(event.key==='Tab'){
        const nodes=items(),first=nodes[0],last=nodes.at(-1)
        if(!ref.current?.contains(document.activeElement) || event.shiftKey && document.activeElement===first){event.preventDefault();(event.shiftKey?last:first)?.focus()}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus()}
      }
    }
    document.addEventListener('keydown',key,true)
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus()}
  },[open,ref])
}
