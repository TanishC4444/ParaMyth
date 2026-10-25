import {lazy,Suspense} from "react";
const Atlas=lazy(()=>import("./Atlas"));
export default function Retrieval(){return <Suspense fallback={<p className="live-loading">Opening literary atlas…</p>}><Atlas/></Suspense>}
