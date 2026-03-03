import { useState, useRef, useEffect } from "react";

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=IBM+Plex+Mono:wght@400;500;600&family=DM+Sans:wght@300;400;500&family=Tajawal:wght@300;400;500;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  textarea { outline: none !important; }
  textarea.hadith-ta:focus { border-color: rgba(99,179,237,0.45) !important; box-shadow: 0 0 0 3px rgba(99,179,237,0.07) !important; }
  textarea.world-ta:focus  { border-color: rgba(52,211,153,0.45)  !important; box-shadow: 0 0 0 3px rgba(52,211,153,0.07)  !important; }
  @keyframes fadeUp   { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
  @keyframes dotPulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.9);opacity:0.4} }
  @keyframes glow     { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.92)} }
  @keyframes spin     { to{transform:rotate(360deg)} }
  .fade-in    { animation: fadeUp 0.45s ease both; }
  .dot-pulse  { animation: dotPulse 0.85s ease-in-out infinite; }
  .icon-glow  { animation: glow 1.8s ease-in-out infinite; }
  .spin-icon  { animation: spin 1s linear infinite; display:inline-block; }
  .hov-btn:hover:not(:disabled) { opacity:.85 !important; transform:translateY(-1px) !important; }
  .hov-btn:active:not(:disabled){ transform:translateY(0) !important; }
  .hov-card:hover { border-color: rgba(99,179,237,0.3) !important; }
  .hov-hist:hover { background: rgba(255,255,255,0.04) !important; }
  ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:10px}
`;

async function callClaude(system, user, maxTokens = 1200) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const txt = data.content.map(b => b.text || "").join("");
  return JSON.parse(txt.replace(/```json[\s\S]*?```|```/g, "").trim());
}

async function searchDorar(keywords) {
  const results = [], seen = new Set();
  for (const kw of (keywords || []).slice(0, 3)) {
    try {
      const r = await fetch(`https://dorar.net/dorar_api.json?skey=${encodeURIComponent(kw)}`);
      if (!r.ok) continue;
      const data = await r.json();
      for (const h of (data.ahadith || []).slice(0, 4)) {
        const txt = (h.th || "").trim();
        if (!txt || seen.has(txt)) continue;
        seen.add(txt);
        results.push({ text: txt, narrator: h.rawi||null, source: h.source||null, grade: h.grade||null, number: String(h.hno||"")||null });
      }
    } catch {}
  }
  return results.slice(0, 8);
}

// ─── Hadith chain ────────────────────────────────────────────────────────────
async function runHadithChain(text, onStep) {
  onStep(0);
  const kd = await callClaude(
    `You are a hadith scholar. Return ONLY valid JSON (no fences):
{"keywords":["up to 4 Arabic/English hadith search keywords"],"claim_summary":"brief Arabic summary"}`,
    `Extract keywords from: ${text.slice(0,2000)}`
  );
  onStep(1);
  const hadiths = await searchDorar(kd.keywords);
  onStep(2);
  const ctx = hadiths.length
    ? hadiths.slice(0,4).map((h,i)=>`${i+1}. ${h.text.slice(0,280)}\nGrade:${h.grade||"—"}`).join("\n\n")
    : "No hadiths found.";
  const verdict = await callClaude(
    `You are an expert in hadith sciences (علم الحديث). Return ONLY valid JSON (no fences):
{
  "authenticity":"صحيح"|"حسن"|"ضعيف"|"موضوع"|"لا أصل له"|"غير محدد",
  "authenticity_en":"Authentic"|"Good"|"Weak"|"Fabricated"|"Has No Basis"|"Unverified",
  "confidence":0-100,
  "verdict_ar":"2-3 Arabic sentences",
  "verdict_en":"2-3 English sentences",
  "scholar_notes":"additional Arabic notes or null"
}`,
    `Claim: ${text.slice(0,1000)}\n\nHadiths from Dorar:\n${ctx}`
  );
  onStep(3);
  return { keywords: kd.keywords||[], claim_summary: kd.claim_summary||"", hadiths, verdict };
}

// ─── World chain ─────────────────────────────────────────────────────────────
async function runWorldChain(text, onStep) {
  onStep(0);
  const claims = await callClaude(
    `You are a fact-checking analyst. Return ONLY valid JSON (no fences):
{"main_claim":"core claim","claims":["up to 5 sub-claims"],"category":"politics|science|health|economy|social|technology|environment|other","detected_language":"en|ar"}`,
    `Extract claims: ${text.slice(0,3000)}`
  );
  onStep(1);
  const manip = await callClaude(
    `Media literacy expert. Return ONLY valid JSON (no fences):
{"manipulation_signals":[],"emotional_triggers":[],"sources_mentioned":[],"missing_context":"","bias_direction":"left|right|neutral|sensationalist|fear-mongering|promotional","language_quality":"professional|mixed|poor"}`,
    `Analyze: ${text.slice(0,3000)}\nClaims: ${(claims.claims||[]).join(", ")}`
  );
  onStep(2);
  const score = await callClaude(
    `Senior fact-checker. Return ONLY valid JSON (no fences):
{"credibility_score":0-100,"classification":"Reliable|Suspicious|Misleading","classification_ar":"موثوق|مشبوه|مضلل","verdict_en":"2-3 English sentences","verdict_ar":"2-3 Arabic sentences","what_is_true":"","what_is_false":"","recommended_sources":["2-3 source names"]}`,
    `Text:${text.slice(0,800)}\nClaims:${JSON.stringify(claims)}\nManip:${JSON.stringify(manip)}`
  );
  onStep(3);
  return { ...claims, ...manip, ...score };
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────
const C = {
  blue:   { base:"#63b3ed", bg:"rgba(99,179,237,0.09)",  brd:"rgba(99,179,237,0.25)" },
  green2: { base:"#34d399", bg:"rgba(52,211,153,0.09)",  brd:"rgba(52,211,153,0.25)" },
  gold:   { base:"#e8c46a", bg:"rgba(232,196,106,0.09)", brd:"rgba(232,196,106,0.25)" },
  green:  { base:"#22c55e", bg:"rgba(34,197,94,0.09)",   brd:"rgba(34,197,94,0.25)" },
  yellow: { base:"#f59e0b", bg:"rgba(245,158,11,0.09)",  brd:"rgba(245,158,11,0.25)" },
  red:    { base:"#ef4444", bg:"rgba(239,68,68,0.09)",   brd:"rgba(239,68,68,0.25)" },
  purple: { base:"#a78bfa", bg:"rgba(139,92,246,0.09)",  brd:"rgba(139,92,246,0.25)" },
};

const AUTH_C = { "صحيح":C.green,"حسن":C.green,"ضعيف":C.yellow,"موضوع":C.red,"لا أصل له":C.red,"غير محدد":C.purple };
const CLS_C  = { reliable:C.green, suspicious:C.yellow, misleading:C.red };
const CAT_ICON = { politics:"🏛",science:"🔬",health:"🏥",economy:"📈",social:"👥",technology:"💻",environment:"🌍",other:"📰" };

function Pill({ text, variant="default", rtl=false }) {
  const s = { default:{bg:"#1a1e28",brd:"rgba(255,255,255,0.07)",col:"rgba(232,234,240,0.8)"}, danger:{bg:C.red.bg,brd:"rgba(239,68,68,0.2)",col:C.red.base}, source:{bg:C.blue.bg,brd:"rgba(99,179,237,0.2)",col:C.blue.base}, purple:{bg:C.purple.bg,brd:"rgba(139,92,246,0.2)",col:C.purple.base}, green:{bg:C.green.bg,brd:"rgba(34,197,94,0.2)",col:C.green.base} }[variant] || {bg:"#1a1e28",brd:"rgba(255,255,255,0.07)",col:"rgba(232,234,240,0.8)"};
  return <span style={{background:s.bg,border:`1px solid ${s.brd}`,color:s.col,fontSize:12,padding:"4px 11px",borderRadius:100,fontFamily:rtl?"'Tajawal',sans-serif":"'DM Sans',sans-serif",lineHeight:1.4,display:"inline-block"}}>{text}</span>;
}

function Gauge({ score, color }) {
  const [d, setD] = useState(0);
  const R=38, Ci=2*Math.PI*R;
  useEffect(() => { let c=0; const id=setInterval(()=>{c=Math.min(c+Math.ceil(score/40),score);setD(c);if(c>=score)clearInterval(id);},22); return ()=>clearInterval(id); }, [score]);
  return (
    <div style={{position:"relative",width:90,height:90,flexShrink:0}}>
      <svg viewBox="0 0 90 90" style={{width:"100%",height:"100%",transform:"rotate(-90deg)"}}>
        <circle cx="45" cy="45" r={R} fill="none" stroke="#1a1e28" strokeWidth="7"/>
        <circle cx="45" cy="45" r={R} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={Ci} strokeDashoffset={Ci-(d/100)*Ci} style={{transition:"stroke-dashoffset 0.04s linear"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:20,fontWeight:600,color,lineHeight:1}}>{d}</span>
        <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"#6b7280"}}>%</span>
      </div>
    </div>
  );
}

function Steps({ steps, active, done, accent }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:7,maxWidth:360,margin:"0 auto"}}>
      {steps.map((lbl,i)=>{
        const isDone=done.includes(i), isAct=active===i&&!isDone;
        const col=isDone?"#22c55e":isAct?accent:"#4b5563";
        return (
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderRadius:9,transition:"all 0.4s",background:isDone?"rgba(34,197,94,0.05)":isAct?`${accent}0d`:"#1a1e28",border:`1px solid ${isDone?"rgba(34,197,94,0.2)":isAct?`${accent}35`:"rgba(255,255,255,0.06)"}`,color:col}}>
            <div className={isAct?"dot-pulse":""} style={{width:6,height:6,borderRadius:"50%",background:col,flexShrink:0}}/>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,letterSpacing:"0.04em"}}>{isDone?"✓ ":""}{lbl}</span>
          </div>
        );
      })}
    </div>
  );
}

function Lbl({ text }) {
  return <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,letterSpacing:"0.2em",textTransform:"uppercase",color:"#4b5563",marginBottom:11}}>{text}</div>;
}

// ─── Hadith Section ───────────────────────────────────────────────────────────
function HadithSection() {
  const [text, setText] = useState("");
  const [stage, setStage] = useState("idle");
  const [aStep, setAStep] = useState(0);
  const [done, setDone] = useState([]);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [hist, setHist] = useState([]);
  const tmr = useRef(null);

  function startSteps() {
    let i=0; setAStep(0); setDone([]);
    tmr.current=setInterval(()=>{if(i<3){setDone(d=>[...d,i]);i++;setAStep(i);}},2400);
  }
  function stopSteps(){ clearInterval(tmr.current); setDone([0,1,2,3]); }

  async function run() {
    if(text.trim().length<10){setErr("الرجاء إدخال نص الحديث أو الادعاء.");return;}
    setErr(""); setResult(null); setStage("loading"); startSteps();
    try {
      const res = await runHadithChain(text, s=>{setDone(Array.from({length:s},(_,i)=>i));setAStep(s);});
      stopSteps(); setResult(res); setStage("done");
      setHist(h=>[{txt:text.slice(0,55)+"…",auth:res.verdict?.authenticity,time:new Date().toLocaleTimeString("ar-SA")}, ...h.slice(0,4)]);
    } catch(e){ stopSteps(); setErr(e.message); setStage("error"); }
  }

  const authC = result ? (AUTH_C[result.verdict?.authenticity]||C.purple) : null;
  const STEPS = ["استخراج الكلمات المفتاحية…","البحث في الموسوعة الحديثية…","تحليل الأسانيد…","إصدار الحكم…"];

  return (
    <div className="fade-in">
      {/* Section header */}
      <div style={{background:"linear-gradient(135deg,rgba(99,179,237,0.07),rgba(99,179,237,0.01))",border:"1px solid rgba(99,179,237,0.13)",borderRadius:16,padding:"1.5rem 1.75rem",marginBottom:"1.5rem",display:"flex",alignItems:"center",gap:"1.25rem"}}>
        <div style={{width:50,height:50,borderRadius:13,background:"rgba(99,179,237,0.12)",border:"1px solid rgba(99,179,237,0.22)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>📿</div>
        <div>
          <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:"1.45rem",fontWeight:400,color:"#e8eaf0",marginBottom:4}}>التحقق من الأحاديث <em style={{color:"#63b3ed",fontStyle:"italic"}}>Hadith Verification</em></h2>
          <p style={{fontFamily:"'Tajawal',sans-serif",fontSize:13,color:"#6b7280",lineHeight:1.6}}>أدخل نص الحديث أو الادعاء الديني للتحقق من صحته عبر الموسوعة الحديثية · dorar.net</p>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:hist.length?"1fr 210px":"1fr",gap:"1.25rem",alignItems:"start"}}>
        <div>
          {/* Input card */}
          <div style={{background:"#12151c",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"1.5rem",marginBottom:"1.25rem",boxShadow:"0 4px 30px rgba(0,0,0,0.4)"}}>
            <Lbl text="نص الحديث أو الادعاء الديني" />
            <textarea className="hadith-ta" value={text} onChange={e=>setText(e.target.value)}
              onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter")run();}}
              placeholder={"أدخل الحديث النبوي أو الادعاء الديني هنا…\nمثال: «من قرأ آية الكرسي بعد كل صلاة مكتوبة لم يمنعه من دخول الجنة إلا الموت»"}
              rows={5}
              style={{width:"100%",background:"#0b0d11",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,color:"#e8eaf0",fontFamily:"'Tajawal',sans-serif",fontSize:15,lineHeight:1.95,padding:"13px 16px",resize:"vertical",direction:"rtl",transition:"all 0.2s"}}
            />
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,flexWrap:"wrap",gap:8}}>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"#4b5563"}}>{text.length} حرف · Ctrl+Enter</span>
              <button className="hov-btn" onClick={run} disabled={stage==="loading"} style={{padding:"9px 22px",background:stage==="loading"?"rgba(99,179,237,0.3)":"#63b3ed",color:"#0b0d11",border:"none",borderRadius:9,fontFamily:"'Tajawal',sans-serif",fontSize:13,fontWeight:600,cursor:stage==="loading"?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:7,transition:"all 0.15s"}}>
                {stage==="loading"?<span className="spin-icon" style={{width:13,height:13,border:"2px solid rgba(0,0,0,0.25)",borderTop:"2px solid #0b0d11",borderRadius:"50%"}}/>:"🔍"}
                {stage==="loading"?"جارٍ التحقق…":"تحقق من الحديث"}
              </button>
            </div>
            {err && <div style={{marginTop:10,padding:"9px 14px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:8,color:"#ef4444",fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>⚠ {err}</div>}
          </div>

          {/* Loading */}
          {stage==="loading" && (
            <div className="fade-in" style={{background:"#12151c",border:"1px solid rgba(99,179,237,0.1)",borderRadius:14,padding:"2.5rem 1.5rem",textAlign:"center",marginBottom:"1.25rem"}}>
              <div className="icon-glow" style={{fontSize:40,marginBottom:"1.5rem"}}>📿</div>
              <Steps steps={STEPS} active={aStep} done={done} accent="#63b3ed"/>
            </div>
          )}

          {/* Result */}
          {stage==="done" && result && (
            <div className="fade-in" style={{background:"#12151c",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 30px rgba(0,0,0,0.4)"}}>
              {/* Verdict header */}
              <div style={{padding:"1.75rem 2rem",background:`linear-gradient(135deg,${authC?.bg||C.purple.bg},transparent)`,borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"1rem"}}>
                  <div>
                    <Lbl text="نتيجة التحقق · VERDICT"/>
                    <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"7px 18px",borderRadius:100,background:authC?.bg||C.purple.bg,border:`1px solid ${authC?.brd||C.purple.brd}`,color:authC?.base||C.purple.base,fontFamily:"'Tajawal',sans-serif",fontSize:16,fontWeight:700,marginBottom:10}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:"currentColor"}}/>
                      {result.verdict?.authenticity||"—"}
                      <span style={{fontSize:12,opacity:0.7,fontFamily:"'DM Sans',sans-serif"}}>({result.verdict?.authenticity_en})</span>
                    </div>
                    <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"#6b7280"}}>
                      Confidence: {result.verdict?.confidence||0}%
                      <div style={{height:3,background:"#1a1e28",borderRadius:2,width:180,marginTop:5}}>
                        <div style={{height:"100%",borderRadius:2,background:authC?.base||C.purple.base,width:`${result.verdict?.confidence||0}%`,transition:"width 1.1s"}}/>
                      </div>
                    </div>
                  </div>
                  <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:100,background:"rgba(99,179,237,0.08)",border:"1px solid rgba(99,179,237,0.2)",color:"#63b3ed",fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:600,letterSpacing:"0.08em"}}>◈ Dorar.net</div>
                </div>
              </div>

              {/* Verdict text */}
              <div style={{padding:"1.5rem 2rem",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
                <Lbl text="الحكم التفصيلي"/>
                {result.verdict?.verdict_ar && <p style={{fontFamily:"'Tajawal',sans-serif",fontSize:15,lineHeight:2,direction:"rtl",textAlign:"right",color:"#e8eaf0",marginBottom:12}}>{result.verdict.verdict_ar}</p>}
                {result.verdict?.verdict_en && <p style={{fontSize:13.5,lineHeight:1.8,color:"rgba(232,234,240,0.6)",paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.05)"}}>{result.verdict.verdict_en}</p>}
                {result.verdict?.scholar_notes && <div style={{marginTop:12,padding:"10px 14px",background:"rgba(232,196,106,0.05)",border:"1px solid rgba(232,196,106,0.12)",borderRadius:8}}>
                  <p style={{fontFamily:"'Tajawal',sans-serif",fontSize:13.5,direction:"rtl",textAlign:"right",color:"#e8c46a",lineHeight:1.8}}>📝 {result.verdict.scholar_notes}</p>
                </div>}
              </div>

              {/* Keywords */}
              {result.keywords?.length>0 && (
                <div style={{padding:"0.9rem 2rem",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"#4b5563",letterSpacing:"0.1em"}}>SEARCHED:</span>
                  {result.keywords.map((k,i)=><Pill key={i} text={`🔍 ${k}`} variant="purple" rtl/>)}
                </div>
              )}

              {/* Hadith cards */}
              {result.hadiths?.length>0 && (
                <div style={{padding:"1.5rem 2rem"}}>
                  <Lbl text={`أحاديث ذات صلة من الموسوعة (${result.hadiths.length})`}/>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {result.hadiths.map((h,i)=>{
                      const g=(h.grade||"").toLowerCase();
                      const gc=g.includes("صحيح")||g.includes("sahih")?C.green.base:g.includes("ضعيف")||g.includes("weak")?C.yellow.base:g.includes("موضوع")||g.includes("fabricat")?C.red.base:"#6b7280";
                      const gb=g.includes("صحيح")||g.includes("sahih")?C.green.bg:g.includes("ضعيف")||g.includes("weak")?C.yellow.bg:g.includes("موضوع")||g.includes("fabricat")?C.red.bg:"#1a1e28";
                      return (
                        <div key={i} className="hov-card" style={{background:"#1a1e28",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"16px 18px",transition:"border-color 0.2s"}}>
                          <p style={{fontFamily:"'Tajawal',sans-serif",fontSize:15,lineHeight:2,direction:"rtl",textAlign:"right",color:"#e8eaf0",marginBottom:12}}>{h.text}</p>
                          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                            {h.narrator&&<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,padding:"2px 8px",borderRadius:100,background:"#12151c",border:"1px solid rgba(255,255,255,0.07)",color:"#6b7280"}}>الراوي: {h.narrator}</span>}
                            {h.source&&<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,padding:"2px 8px",borderRadius:100,background:"#12151c",border:"1px solid rgba(255,255,255,0.07)",color:"#6b7280"}}>المصدر: {h.source}</span>}
                            {h.grade&&<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,padding:"2px 8px",borderRadius:100,background:gb,border:`1px solid ${gc}40`,color:gc}}>{h.grade}</span>}
                            {h.number&&<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,padding:"2px 8px",borderRadius:100,background:"#12151c",border:"1px solid rgba(255,255,255,0.07)",color:"#4b5563"}}>#{h.number}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* History sidebar */}
        {hist.length>0 && (
          <div style={{background:"#12151c",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"1.25rem",position:"sticky",top:20}}>
            <Lbl text="السجل الأخير"/>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {hist.map((item,i)=>(
                <div key={i} className="hov-hist" style={{padding:"9px 10px",borderRadius:8,cursor:"pointer",transition:"background 0.15s"}} onClick={()=>setText(item.txt.replace("…",""))}>
                  <p style={{fontFamily:"'Tajawal',sans-serif",fontSize:12,direction:"rtl",color:"#9ca3af",marginBottom:4,lineHeight:1.5}}>{item.txt}</p>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    {item.auth&&<span style={{fontFamily:"'Tajawal',sans-serif",fontSize:11,color:AUTH_C[item.auth]?.base||"#6b7280"}}>{item.auth}</span>}
                    <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"#4b5563"}}>{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── World Section ────────────────────────────────────────────────────────────
function WorldSection() {
  const [text, setText] = useState("");
  const [lang, setLang] = useState("en");
  const [stage, setStage] = useState("idle");
  const [aStep, setAStep] = useState(0);
  const [done, setDone] = useState([]);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [hist, setHist] = useState([]);
  const tmr = useRef(null);
  const isAr = lang==="ar";

  function startSteps(){let i=0;setAStep(0);setDone([]);tmr.current=setInterval(()=>{if(i<3){setDone(d=>[...d,i]);i++;setAStep(i);}},2400);}
  function stopSteps(){clearInterval(tmr.current);setDone([0,1,2,3]);}

  async function run(){
    if(text.trim().length<20){setErr(isAr?"الرجاء إدخال نص أطول.":"Please paste a longer text.");return;}
    setErr(""); setResult(null); setStage("loading"); startSteps();
    try{
      const res=await runWorldChain(text,s=>{setDone(Array.from({length:s},(_,i)=>i));setAStep(s);});
      stopSteps(); setResult(res); setStage("done");
      setHist(h=>[{txt:text.slice(0,55)+"…",score:res.credibility_score,cls:res.classification,time:new Date().toLocaleTimeString()},...h.slice(0,4)]);
    }catch(e){stopSteps();setErr(e.message);setStage("error");}
  }

  const clsC = result ? (CLS_C[result.classification?.toLowerCase()]||C.yellow) : null;
  const STEPS = isAr
    ? ["استخراج الادعاءات…","تحليل التضليل…","توليد الحكم…","اكتمل ✓"]
    : ["Extracting claims…","Analyzing manipulation…","Generating verdict…","Done ✓"];

  return (
    <div className="fade-in">
      {/* Section header */}
      <div style={{background:"linear-gradient(135deg,rgba(52,211,153,0.07),rgba(52,211,153,0.01))",border:"1px solid rgba(52,211,153,0.13)",borderRadius:16,padding:"1.5rem 1.75rem",marginBottom:"1.5rem",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"1rem"}}>
        <div style={{display:"flex",alignItems:"center",gap:"1.25rem"}}>
          <div style={{width:50,height:50,borderRadius:13,background:"rgba(52,211,153,0.12)",border:"1px solid rgba(52,211,153,0.22)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>🌍</div>
          <div>
            <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:"1.45rem",fontWeight:400,color:"#e8eaf0",marginBottom:4}}>World <em style={{color:"#34d399",fontStyle:"italic"}}>Fact-Check</em> <span style={{fontFamily:"'Tajawal',sans-serif",fontSize:"0.85em",color:"#6b7280"}}>تحقق الأخبار العالمية</span></h2>
            <p style={{fontSize:13,color:"#6b7280",lineHeight:1.5}}>Analyze any news article, claim, or statement for credibility · يدعم العربية والإنجليزية</p>
          </div>
        </div>
        <div style={{display:"flex",background:"#1a1e28",border:"1px solid rgba(255,255,255,0.07)",borderRadius:100,padding:3,gap:2}}>
          {["en","ar"].map(l=>(
            <button key={l} onClick={()=>setLang(l)} style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,fontWeight:600,letterSpacing:"0.1em",padding:"5px 13px",border:"none",borderRadius:100,cursor:"pointer",transition:"all 0.2s",background:lang===l?"#34d399":"transparent",color:lang===l?"#0b0d11":"#6b7280"}}>{l==="en"?"EN":"عربي"}</button>
          ))}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:hist.length?"1fr 210px":"1fr",gap:"1.25rem",alignItems:"start"}}>
        <div>
          {/* Input card */}
          <div style={{background:"#12151c",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"1.5rem",marginBottom:"1.25rem",boxShadow:"0 4px 30px rgba(0,0,0,0.4)"}}>
            <Lbl text={isAr?"نص الخبر أو الادعاء":"NEWS TEXT OR CLAIM"}/>
            <textarea className="world-ta" value={text} onChange={e=>setText(e.target.value)}
              onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter")run();}}
              placeholder={isAr?"الصق نص الخبر أو المقال للتحقق من مصداقيته…":"Paste a news article, headline, or claim to fact-check…\nSupports Arabic & English"}
              rows={5}
              style={{width:"100%",background:"#0b0d11",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,color:"#e8eaf0",fontFamily:isAr?"'Tajawal',sans-serif":"'DM Sans',sans-serif",fontSize:14.5,lineHeight:1.8,padding:"13px 16px",resize:"vertical",direction:isAr?"rtl":"ltr",transition:"all 0.2s"}}
            />
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,flexWrap:"wrap",gap:8}}>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:"#4b5563"}}>{text.length} chars · Ctrl+Enter</span>
              <button className="hov-btn" onClick={run} disabled={stage==="loading"} style={{padding:"9px 22px",background:stage==="loading"?"rgba(52,211,153,0.3)":"#34d399",color:"#0b0d11",border:"none",borderRadius:9,fontFamily:"'IBM Plex Mono',monospace",fontSize:11,fontWeight:600,letterSpacing:"0.1em",textTransform:"uppercase",cursor:stage==="loading"?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:7,transition:"all 0.15s"}}>
                {stage==="loading"?<span className="spin-icon" style={{width:13,height:13,border:"2px solid rgba(0,0,0,0.25)",borderTop:"2px solid #0b0d11",borderRadius:"50%"}}/>:"🔍"}
                {stage==="loading"?(isAr?"جارٍ التحليل…":"Analyzing…"):(isAr?"تحليل":"ANALYZE")}
              </button>
            </div>
            {err && <div style={{marginTop:10,padding:"9px 14px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:8,color:"#ef4444",fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}>⚠ {err}</div>}
          </div>

          {/* Loading */}
          {stage==="loading" && (
            <div className="fade-in" style={{background:"#12151c",border:"1px solid rgba(52,211,153,0.1)",borderRadius:14,padding:"2.5rem 1.5rem",textAlign:"center",marginBottom:"1.25rem"}}>
              <div className="icon-glow" style={{fontSize:40,marginBottom:"1.5rem"}}>🌍</div>
              <Steps steps={STEPS} active={aStep} done={done} accent="#34d399"/>
            </div>
          )}

          {/* Result */}
          {stage==="done" && result && (
            <div className="fade-in" style={{background:"#12151c",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 30px rgba(0,0,0,0.4)"}}>
              {/* Score row */}
              <div style={{padding:"1.75rem 2rem",background:`linear-gradient(135deg,${clsC?.bg||C.yellow.bg},transparent)`,borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"1.5rem"}}>
                <div>
                  <Lbl text="ANALYSIS RESULT · نتيجة التحليل"/>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                    <div style={{display:"inline-flex",alignItems:"center",gap:7,padding:"6px 16px",borderRadius:100,background:clsC?.bg,border:`1px solid ${clsC?.brd}`,color:clsC?.base,fontFamily:"'IBM Plex Mono',monospace",fontSize:12,fontWeight:600,letterSpacing:"0.08em"}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:"currentColor"}}/>{result.classification}
                    </div>
                    {result.classification_ar&&<span style={{fontFamily:"'Tajawal',sans-serif",fontSize:14,color:clsC?.base,fontWeight:700}}>{result.classification_ar}</span>}
                    {result.category&&<span style={{fontSize:18}}>{CAT_ICON[result.category]||"📰"}</span>}
                  </div>
                  <div style={{width:260,maxWidth:"100%"}}>
                    <div style={{height:4,background:"#1a1e28",borderRadius:2,overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:2,background:clsC?.base,width:`${result.credibility_score}%`,transition:"width 1.1s cubic-bezier(0.16,1,0.3,1)"}}/>
                    </div>
                  </div>
                </div>
                <Gauge score={result.credibility_score} color={clsC?.base||C.yellow.base}/>
              </div>

              {/* Verdict */}
              <div style={{padding:"1.5rem 2rem",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
                <Lbl text="VERDICT · الحكم"/>
                {result.verdict_en&&<p style={{fontSize:14.5,lineHeight:1.85,color:"#e8eaf0",marginBottom:result.verdict_ar?12:0}}>{result.verdict_en}</p>}
                {result.verdict_ar&&<p style={{fontFamily:"'Tajawal',sans-serif",fontSize:15,lineHeight:2,direction:"rtl",textAlign:"right",color:"rgba(232,234,240,0.65)",paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.05)"}}>{result.verdict_ar}</p>}
              </div>

              {/* True/False breakdown */}
              {(result.what_is_true||result.what_is_false)&&(
                <div style={{padding:"1.5rem 2rem",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem"}}>
                  {result.what_is_true&&<div style={{padding:"12px 14px",borderRadius:10,background:"rgba(34,197,94,0.05)",border:"1px solid rgba(34,197,94,0.15)"}}>
                    <div style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.15em",color:"#22c55e",marginBottom:7}}>✓ LIKELY TRUE</div>
                    <p style={{fontSize:13,color:"rgba(232,234,240,0.8)",lineHeight:1.7}}>{result.what_is_true}</p>
                  </div>}
                  {result.what_is_false&&<div style={{padding:"12px 14px",borderRadius:10,background:"rgba(239,68,68,0.05)",border:"1px solid rgba(239,68,68,0.15)"}}>
                    <div style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.15em",color:"#ef4444",marginBottom:7}}>✗ QUESTIONABLE</div>
                    <p style={{fontSize:13,color:"rgba(232,234,240,0.8)",lineHeight:1.7}}>{result.what_is_false}</p>
                  </div>}
                </div>
              )}

              {/* Pills grid */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
                <div style={{padding:"1.25rem 1.75rem",borderRight:"1px solid rgba(255,255,255,0.07)"}}>
                  <Lbl text="CLAIMS DETECTED"/>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {result.claims?.length?result.claims.map((c,i)=><Pill key={i} text={c}/>):<span style={{fontSize:12,color:"#4b5563",fontStyle:"italic"}}>None extracted</span>}
                  </div>
                </div>
                <div style={{padding:"1.25rem 1.75rem"}}>
                  <Lbl text="MANIPULATION SIGNALS"/>
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {result.manipulation_signals?.length?result.manipulation_signals.map((s,i)=><Pill key={i} text={s} variant="danger"/>):<span style={{fontSize:12,color:"#4b5563",fontStyle:"italic"}}>None detected ✓</span>}
                  </div>
                </div>
                {result.emotional_triggers?.length>0&&(
                  <div style={{padding:"1.25rem 1.75rem",gridColumn:"1/-1",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
                    <Lbl text="EMOTIONAL TRIGGERS"/>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {result.emotional_triggers.map((t,i)=><Pill key={i} text={t} variant="purple"/>)}
                    </div>
                  </div>
                )}
                {(result.sources_mentioned?.length>0||result.recommended_sources?.length>0)&&(
                  <div style={{padding:"1.25rem 1.75rem",gridColumn:"1/-1",borderTop:"1px solid rgba(255,255,255,0.07)",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem"}}>
                    {result.sources_mentioned?.length>0&&<div>
                      <Lbl text="SOURCES CITED"/><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{result.sources_mentioned.map((s,i)=><Pill key={i} text={s} variant="source"/>)}</div>
                    </div>}
                    {result.recommended_sources?.length>0&&<div>
                      <Lbl text="VERIFY WITH"/><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{result.recommended_sources.map((s,i)=><Pill key={i} text={s} variant="green"/>)}</div>
                    </div>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* History sidebar */}
        {hist.length>0&&(
          <div style={{background:"#12151c",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"1.25rem",position:"sticky",top:20}}>
            <Lbl text="RECENT CHECKS"/>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {hist.map((item,i)=>(
                <div key={i} className="hov-hist" style={{padding:"9px 10px",borderRadius:8,cursor:"pointer",transition:"background 0.15s"}} onClick={()=>setText(item.txt.replace("…",""))}>
                  <p style={{fontSize:11.5,color:"#9ca3af",marginBottom:4,lineHeight:1.5}}>{item.txt}</p>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    {item.score!==undefined&&<span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:CLS_C[item.cls?.toLowerCase()]?.base||"#6b7280"}}>{item.score}%</span>}
                    <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"#4b5563"}}>{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function TruthLens() {
  const [tab, setTab] = useState("hadith");
  const tabs = [
    { id:"hadith", ar:"أحاديث", en:"Hadith",     icon:"📿", col:"#63b3ed" },
    { id:"world",  ar:"أخبار عالمية", en:"World News", icon:"🌍", col:"#34d399" },
  ];

  return (
    <div style={{background:"#0b0d11",minHeight:"100vh",color:"#e8eaf0",fontFamily:"'DM Sans',sans-serif",backgroundImage:"linear-gradient(rgba(232,196,106,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(232,196,106,0.012) 1px,transparent 1px)",backgroundSize:"52px 52px"}}>
      <style>{GLOBAL_CSS}</style>

      {/* Nav */}
      <nav style={{background:"rgba(11,13,17,0.95)",backdropFilter:"blur(16px)",borderBottom:"1px solid rgba(255,255,255,0.06)",position:"sticky",top:0,zIndex:100,padding:"0 1.5rem"}}>
        <div style={{maxWidth:920,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:58}}>
          <div style={{display:"flex",alignItems:"center",gap:9}}>
            <div style={{width:28,height:28,borderRadius:7,background:"rgba(232,196,106,0.12)",border:"1px solid rgba(232,196,106,0.2)",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#e8c46a" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </div>
            <span style={{fontFamily:"'DM Serif Display',serif",fontSize:17,fontWeight:400,letterSpacing:"-0.02em"}}>Truth<em style={{color:"#e8c46a",fontStyle:"italic"}}>Lens</em></span>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:8.5,letterSpacing:"0.1em",textTransform:"uppercase",color:"#4b5563"}}> </span>
          </div>
          <div style={{display:"flex",background:"#1a1e28",border:"1px solid rgba(255,255,255,0.07)",borderRadius:100,padding:3,gap:2}}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",border:"none",borderRadius:100,cursor:"pointer",transition:"all 0.2s",background:tab===t.id?t.col:"transparent",color:tab===t.id?"#0b0d11":"#6b7280",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:500}}>
                <span>{t.icon}</span>
                <span style={{fontFamily:"'Tajawal',sans-serif"}}>{t.ar}</span>
                <span style={{fontSize:10,opacity:0.65}}>{t.en}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div style={{background:"linear-gradient(180deg,rgba(232,196,106,0.03) 0%,transparent 100%)",borderBottom:"1px solid rgba(255,255,255,0.04)",padding:"2.25rem 1.5rem 1.75rem",textAlign:"center"}}>
        <h1 style={{fontFamily:"'DM Serif Display',serif",fontSize:"clamp(1.8rem,4vw,2.8rem)",fontWeight:400,letterSpacing:"-0.025em",lineHeight:1.15,marginBottom:8}}>
          Truth<em style={{color:"#e8c46a",fontStyle:"italic"}}>Lens</em>
          <span style={{fontFamily:"'Tajawal',sans-serif",fontSize:"0.5em",color:"#6b7280",marginLeft:12,fontWeight:300}}> </span>
        </h1>
        <p style={{fontSize:13.5,color:"#6b7280",maxWidth:540,margin:"0 auto 1.5rem",lineHeight:1.65}}>
          AI-powered verification for Islamic hadiths & world news · تحقق بالذكاء الاصطناعي من الأحاديث والأخبار العالمية
        </p>
        {/* Animated tab indicators */}
        <div style={{display:"flex",justifyContent:"center",gap:"2rem"}}>
          {tabs.map(t=>(
            <div key={t.id} onClick={()=>setTab(t.id)} style={{cursor:"pointer",display:"flex",alignItems:"center",gap:7,transition:"opacity 0.2s",opacity:tab===t.id?1:0.4}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:t.col,boxShadow:tab===t.id?`0 0 10px ${t.col}60`:"none",transition:"box-shadow 0.3s"}}/>
              <span style={{fontFamily:"'Tajawal',sans-serif",fontSize:13.5,color:tab===t.id?t.col:"#6b7280",fontWeight:tab===t.id?500:400}}>{t.ar}</span>
              <span style={{fontSize:11,color:"#4b5563"}}>{t.en}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <main style={{maxWidth:920,margin:"0 auto",padding:"2rem 1.5rem 5rem"}}>
        {tab==="hadith" && <HadithSection key="hadith"/>}
        {tab==="world"  && <WorldSection  key="world"/>}
      </main>

      <footer style={{textAlign:"center",padding:"1.5rem",borderTop:"1px solid rgba(255,255,255,0.05)",color:"#374151",fontSize:11,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.05em"}}>
        <span style={{color:"#e8c46a"}}>TruthLens</span> · Claude AI · Hadith DB: Dorar.net ·  
      </footer>
    </div>
  );
}
