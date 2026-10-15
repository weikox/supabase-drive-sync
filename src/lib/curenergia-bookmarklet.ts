/** Builds the javascript: bookmarklet that runs inside the user's own curenergia.es session. */
export function buildCurenergiaBookmarklet(appOrigin: string, token: string): string {
  const src = `(async()=>{
const APP=${JSON.stringify(appOrigin + "/api/public/curenergia-import")},TK=${JSON.stringify(token)};
if(!/curenergia\\.es$/.test(location.hostname)){alert("Pulsa este botón estando dentro de curenergia.es");return;}
const box=document.createElement("div");box.style.cssText="position:fixed;z-index:2147483647;top:16px;right:16px;background:#111;color:#fff;padding:14px 18px;border-radius:10px;font:14px sans-serif;max-width:320px;box-shadow:0 4px 20px rgba(0,0,0,.4)";document.body.appendChild(box);
const say=t=>box.textContent=t;
const send=async b=>{const r=await fetch(APP,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:TK,...b})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||("App HTTP "+r.status));return j;};
const cands=[];const add=v=>{if(typeof v==="string"&&v.length>20&&v.length<5000&&!cands.includes(v))cands.push(v.replace(/^"|"$/g,""));};
for(const st of [sessionStorage,localStorage])for(let i=0;i<st.length;i++){const k=st.key(i),v=st.getItem(k);if(/token|auth/i.test(k))add(v);try{const o=JSON.parse(v);if(o&&typeof o==="object")for(const kk in o)if(/token/i.test(kk))add(o[kk]);}catch(e){}if(/^ey[\\w-]+\\.[\\w-]+\\./.test(v||""))add(v);}
cands.push("");
const B="/webcli";let H=null;
const api=async(p,o={})=>{const r=await fetch(B+p,{credentials:"include",...o,headers:{accept:"application/json, text/plain, */*","content-type":"application/json;charset=UTF-8",...H,...(o.headers||{})}});const t=await r.text();if(!r.ok||t.trim()[0]==="<")throw new Error("Curenergía HTTP "+r.status);return JSON.parse(t);};
try{
say("Buscando tu sesión…");let prof=null;
for(const c of cands){H=c?{"auth-token":c}:{};try{prof=await api("/usuario/data?loginLanguage=es&origenLogin=19&viewAPP=RESIDENCIALNM",{method:"POST"});if(prof&&prof.listaContratosTotal)break;prof=null;}catch(e){}}
if(!prof)throw new Error("No encuentro tu sesión. Entra en Mis facturas y vuelve a pulsar.");
const all=[];
for(const c of prof.listaContratosTotal){const sup=c.codLineaPdt==="GAS"?"gas":"luz";say("Leyendo facturas de "+sup+"…");await api("/usuario/data?codRs="+c.codRecepSum+"&origenLogin=19");const l=await api("/nm/facturas/lista?language=es",{method:"POST"});for(const f of (l.facturas||[]))all.push({...f,supply:sup,codContrato:f.codContrato||c.codContrato,_rs:c.codRecepSum});}
await send({invoices:all});
let ok=0,ko=0,rs=null;
for(let i=0;i<all.length;i++){const f=all[i];say("Descargando PDF "+(i+1)+" de "+all.length+"…");try{if(rs!==f._rs){await api("/usuario/data?codRs="+f._rs+"&origenLogin=19");rs=f._rs;}const d=await api("/nm/facturas/descarga?language=es",{method:"POST",body:JSON.stringify({numFactura:f.factura})});if(!d.fichero)throw 0;await send({pdf:{invoice_id:f.factura,base64:d.fichero}});ok++;}catch(e){ko++;}}
say("✔ "+all.length+" facturas enviadas a la app · "+ok+" PDFs"+(ko?" · "+ko+" fallidos":""));
}catch(e){say("✖ "+e.message);}
setTimeout(()=>box.remove(),15000);
})();`;
  return "javascript:" + encodeURIComponent(src.replace(/\n/g, ""));
}
