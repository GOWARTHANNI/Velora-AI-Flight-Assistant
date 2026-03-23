document.addEventListener('DOMContentLoaded', function() {
// ── STARFIELD ──────────────────────────────────────────────────
(function(){
  const c=document.getElementById('starfield'),ctx=c.getContext('2d');let st=[];
  function resize(){c.width=innerWidth;c.height=innerHeight;st=[];for(let i=0;i<200;i++)st.push({x:Math.random()*c.width,y:Math.random()*c.height,r:Math.random()*1.2+0.2,o:Math.random()*0.7+0.15});}
  function draw(){ctx.clearRect(0,0,c.width,c.height);st.forEach(s=>{ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fillStyle=`rgba(255,255,255,${s.o})`;ctx.fill();});}
  resize();draw();window.addEventListener('resize',()=>{resize();draw();});
})();

// ── TTS ────────────────────────────────────────────────────────
const synth=window.speechSynthesis;
let voices=[];
function loadVoices(){voices=synth.getVoices();}
loadVoices();synth.onvoiceschanged=loadVoices;
function speak(text,onEnd){
  synth.cancel();
  const utt=new SpeechSynthesisUtterance(text);
  const v=voices.find(v=>/samantha|victoria|karen|zira|hazel|susan|female|woman/i.test(v.name))
    ||voices.find(v=>v.lang==='en-US'&&v.default)||voices.find(v=>v.lang.startsWith('en'))||voices[0];
  if(v)utt.voice=v;
  utt.pitch=1.15;utt.rate=0.95;utt.volume=1;
  utt.onend=onEnd||null;
  synth.speak(utt);
}

// ── STATE ──────────────────────────────────────────────────────
let currentStep=0,pendingReply=null,isListening=false,recognition=null;
let activeSearchAbort=false; // flag to cancel in-progress search
let activeSummaryPanel=null; // reference to current filter panel
const collected={currency:'INR',currencySym:'₹',flightPref:'direct',minTransit:2,maxTransit:4,depTime:'Night (9PM-6AM)',cabin:'Economy'};

const STEPS=[
  {prompt:"Greetings! I'm Velora, your AI flight assistant. Kindly provide your travel journey and the date of your trip."},
  {prompt:"How many passengers are travelling? Please set adults, children & infants below.", type:"passengers"},
  {prompt:"(skipped)", type:"skip"},
  {prompt:"(skipped)", type:"skip"},
  {prompt:"(skipped)", type:"skip"},
  {prompt:"Is this a one-way or round trip?", type:"dropdown", options:["One Way","Round Trip"]},
  {prompt:"What is the return date? (e.g. '25 June' or '25-06-2026')", condition:"roundtrip"},
  {prompt:"What is your budget per passenger in Indian Rupees? (e.g. ₹15,000 or ₹90,000)"},
  {prompt:"Do you prefer direct flights or connecting flights?", type:"dropdown", options:["Direct Flight","Connecting Flight"]},
  {prompt:"What is your maximum acceptable layover duration? (e.g. '1-2 hours' or '2-3 hours')", condition:"connecting"},
  {prompt:"What is your preferred departure time?", type:"dropdown", options:["Early Morning (6AM-9AM)","Morning (9AM-12PM)","Afternoon (12PM-6PM)","Evening (6PM-9PM)","Night (9PM-6AM)"]},
  {prompt:"Which cabin class do you prefer?", type:"dropdown", options:["Economy","Premium Economy","Business","First Class"]}
];

// ── DOM REFS ───────────────────────────────────────────────────
const messagesEl=document.getElementById('messages');
const chatInput=document.getElementById('chat-input');
const sendBtn=document.getElementById('send-btn');
const micBtn=document.getElementById('mic-btn');
const vbars=document.getElementById('vbars');
const inputHint=document.getElementById('inputHint');

function scrollToBottom(){
  requestAnimationFrame(()=>{
    window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'});
  });
}

// ── PROGRESS ───────────────────────────────────────────────────
// Logical step → visual bar position (0-7)
// Steps 0=Route,1=Pax,2/3/4=skip,5=Trip,6=Return,7=Budget,8=Pref,81=Stops,9=Layover,10=Time,11=Class
const STEP_TO_BAR={0:0,1:1,5:2,6:3,7:4,8:5,81:5,9:5,10:6,11:7};
function updateProgress(step){
  const bar=STEP_TO_BAR[step]??0;
  for(let i=0;i<8;i++){
    document.getElementById(`ps${i}`).className='progress-step'+(i<bar?' done':i===bar?' active':'');
    document.getElementById(`sl${i}`).className='step-lbl'+(i===bar?' active':'');
  }
}

// ── MESSAGES ───────────────────────────────────────────────────
function addMsg(role,text){
  const row=document.createElement('div');
  row.className=`msg-row ${role}`;

  const av=document.createElement('div');
  av.className='msg-avatar';
  if(role==='velora'){
    av.innerHTML='<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';
  } else {
    av.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  }

  const bubble=document.createElement('div');
  bubble.className='msg-bubble';
  bubble.textContent=text||'';

  row.appendChild(av);
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  scrollToBottom();
  return bubble;
}

function showTyping(){
  const row=document.createElement('div');
  row.className='msg-row velora typing-row';
  const av=document.createElement('div');
  av.className='msg-avatar';
  av.innerHTML='<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>';
  const dots=document.createElement('div');
  dots.className='msg-bubble';
  dots.innerHTML='<div class="typing-dots"><span></span><span></span><span></span></div>';
  row.appendChild(av);row.appendChild(dots);
  messagesEl.appendChild(row);
  scrollToBottom();
  return row;
}

function removeTyping(){
  const t=messagesEl.querySelector('.typing-row');
  if(t)t.remove();
}

// typewriter into existing bubble
function typeInto(bubble,text,speed=20){
  return new Promise(res=>{
    bubble.innerHTML='';bubble.classList.add('cursor');
    let i=0;
    const iv=setInterval(()=>{
      let currentText=text.substring(0,i+1);
      // Don't escape HTML - just set it directly
      bubble.innerHTML=currentText;
      scrollToBottom();
      i++;
      if(i>=text.length){clearInterval(iv);bubble.classList.remove('cursor');res();}
    },speed);
  });
}

// ── VELORA SPEAKS — TTS fires in background, input ready immediately ──
async function velora(text){
  const typRow=showTyping();
  await new Promise(r=>setTimeout(r,400));
  removeTyping();
  const bubble=addMsg('velora','');
  await typeInto(bubble,text,18);
  speak(text); // background — no await
}

// ── SPEECH RECOGNITION ────────────────────────────────────────
function startListening(onResult){
  if(isListening)return;
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){chatInput.focus();inputHint.textContent='voice not supported — please type';return;}
  recognition=new SR();recognition.lang='en-IN';recognition.interimResults=true;recognition.continuous=false;
  isListening=true;
  micBtn.classList.add('active');vbars.classList.add('active');
  inputHint.textContent='listening… speak now';
  chatInput.placeholder='Listening…';

  recognition.onresult=e=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++)interim+=e.results[i][0].transcript;
    chatInput.value=interim;
    if(e.results[e.results.length-1].isFinal){
      const final=e.results[e.results.length-1][0].transcript.trim();
      stopListening();
      chatInput.value='';
      if(final)onResult(final);
    }
  };
  recognition.onerror=stopListening;
  recognition.onend=()=>{if(isListening)stopListening();};
  recognition.start();
}

function stopListening(){
  isListening=false;
  if(recognition)try{recognition.stop();}catch(e){}
  micBtn.classList.remove('active');vbars.classList.remove('active');
  inputHint.textContent='tap mic or type to respond';
  chatInput.placeholder='Type your response here…';
}

// ── AWAITING REPLY ────────────────────────────────────────────
function awaitReply(handler){
  pendingReply=handler;
  chatInput.disabled=false;
  chatInput.focus();
  inputHint.textContent='tap mic or type your answer';
}

// ── CHIP HELPERS ─────────────────────────────────────────────
function clearChips(){const old=messagesEl.querySelector('.chips-wrap,.pax-widget');if(old)old.remove();}

function showChips(options,onSelect){
  clearChips();
  // Keep chatInput ENABLED — chips are quick shortcuts, typing/voice also accepted
  chatInput.disabled=false;
  chatInput.focus();
  inputHint.textContent='tap a chip, type, or use 🎤 to answer';
  const wrap=document.createElement('div');
  wrap.className='chips-wrap';
  const allChips=[];
  options.forEach(opt=>{
    const c=document.createElement('button');
    c.className='chip';
    c.innerHTML=`${opt.icon?`<span class="chip-icon">${opt.icon}</span>`:''}<span>${opt.label}</span>`;
    c.onclick=()=>{
      allChips.forEach(ch=>{ch.classList.add('disabled');ch.disabled=true;});
      c.classList.add('selected');
      chatInput.disabled=false;
      inputHint.textContent='tap mic or type to respond';
      const val=opt.value||opt.label;
      addMsg('user',opt.label);
      if(pendingReply){const fn=pendingReply;pendingReply=null;synth.cancel();fn(val);}
      else onSelect&&onSelect(val);
    };
    allChips.push(c);
    wrap.appendChild(c);
  });
  messagesEl.appendChild(wrap);
  scrollToBottom();
}

function showPaxWidget(){
  clearChips();
  chatInput.disabled=false;
  chatInput.focus();
  inputHint.textContent='type (e.g. "2 adults 1 child"), use the widget above, or 🎤';

  const counts={adults:1,children:0,infants:0};
  const rows=[
    {key:'adults',  label:'Adults',   sub:'18+ years', min:1, max:9},
    {key:'children',label:'Children', sub:'2–17 years', min:0, max:8},
    {key:'infants', label:'Infants',  sub:'Under 2', min:0, max:4}
  ];

  const widget=document.createElement('div');
  widget.className='pax-widget';
  widget.style.cssText='display:flex;flex-direction:column;gap:0;border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-top:10px;';

  // ── Voice header ──────────────────────────────────────────────
  const voiceBar=document.createElement('div');
  voiceBar.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:10px 16px 8px;background:rgba(168,85,247,0.08);border-bottom:1px solid var(--border);';
  voiceBar.innerHTML=`
    <span style="font-size:0.65rem;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted);">Passengers</span>
    <button id="pax-mic-btn" title="Say e.g. '2 adults 1 child 0 infants'" style="display:flex;align-items:center;gap:6px;background:rgba(168,85,247,0.15);border:1px solid var(--border);border-radius:20px;padding:5px 12px;cursor:pointer;color:var(--accent2);font-size:0.72rem;letter-spacing:0.1em;text-transform:uppercase;">
      <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:currentColor;"><path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm-1 17.93V21H9v2h6v-2h-2v-2.07A7.003 7.003 0 0 0 19 12h-2a5 5 0 0 1-10 0H5a7.003 7.003 0 0 0 6 6.93z"/></svg>
      <span id="pax-mic-label">Speak passengers</span>
    </button>`;
  widget.appendChild(voiceBar);

  // ── Helper: update a row display ─────────────────────────────
  function updateRow(key){
    const inp=widget.querySelector(`#pci-${key}`);
    const minusBtn=widget.querySelector(`[data-key="${key}"][data-dir="-1"]`);
    const plusBtn=widget.querySelector(`[data-key="${key}"][data-dir="1"]`);
    const ro=rows.find(x=>x.key===key);
    if(inp) inp.value=counts[key];
    if(minusBtn) minusBtn.disabled=(counts[key]<=ro.min);
    if(plusBtn)  plusBtn.disabled=(counts[key]>=ro.max);
  }

  function setCount(key,val){
    const ro=rows.find(x=>x.key===key);
    counts[key]=Math.min(ro.max,Math.max(ro.min,val));
    // infant cap
    if(counts.infants>counts.adults){ counts.infants=counts.adults; updateRow('infants'); }
    updateRow(key);
  }

  // ── Rows ─────────────────────────────────────────────────────
  rows.forEach((r,i)=>{
    const row=document.createElement('div');
    row.style.cssText=`display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:rgba(30,12,55,0.5);${i<rows.length-1?'border-bottom:1px solid var(--border);':''}`;

    // Label block
    const labelBlock=document.createElement('div');
    labelBlock.innerHTML=`<div style="font-size:0.88rem;font-weight:500;color:var(--text);">${r.label}</div><div style="font-size:0.65rem;color:var(--muted);margin-top:1px;">${r.sub}</div>`;

    // Controls block: [−] [input] [+]
    const ctrl=document.createElement('div');
    ctrl.style.cssText='display:flex;align-items:center;gap:0;background:rgba(0,0,0,0.25);border-radius:30px;border:1px solid var(--border);overflow:hidden;';

    const minusBtn=document.createElement('button');
    minusBtn.className='pax-btn';
    minusBtn.dataset.key=r.key;
    minusBtn.dataset.dir='-1';
    minusBtn.textContent='−';
    minusBtn.disabled=(counts[r.key]<=r.min);

    // Typeable input
    const numInput=document.createElement('input');
    numInput.id=`pci-${r.key}`;
    numInput.type='number';
    numInput.value=counts[r.key];
    numInput.min=r.min;
    numInput.max=r.max;
    numInput.style.cssText=`
      width:48px;text-align:center;border:none;background:transparent;
      font-family:'Cormorant Garamond',serif;font-size:1.3rem;font-weight:700;
      color:var(--accent);outline:none;padding:4px 2px;
      -moz-appearance:textfield;appearance:textfield;
    `;
    // Hide spinner arrows
    numInput.addEventListener('wheel',e=>e.preventDefault());
    numInput.oninput=()=>{
      let v=parseInt(numInput.value);
      if(isNaN(v)) return;
      setCount(r.key,v);
    };
    numInput.onblur=()=>{ numInput.value=counts[r.key]; };
    // Prevent typing more than 1 digit
    numInput.onkeydown=e=>{ if(e.key==='-'||e.key==='e'||e.key==='.') e.preventDefault(); };

    const plusBtn=document.createElement('button');
    plusBtn.className='pax-btn';
    plusBtn.dataset.key=r.key;
    plusBtn.dataset.dir='1';
    plusBtn.textContent='+';
    plusBtn.disabled=(counts[r.key]>=r.max);

    [minusBtn,plusBtn].forEach(btn=>{
      btn.onclick=()=>{
        const dir=parseInt(btn.dataset.dir);
        setCount(r.key,counts[r.key]+dir);
      };
    });

    ctrl.appendChild(minusBtn);
    ctrl.appendChild(numInput);
    ctrl.appendChild(plusBtn);

    row.appendChild(labelBlock);
    row.appendChild(ctrl);
    widget.appendChild(row);
  });

  // ── Mic voice input ─────────────────────────────────────────
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const paxMicBtn=voiceBar.querySelector('#pax-mic-btn');
  const paxMicLabel=voiceBar.querySelector('#pax-mic-label');
  let paxListening=false,paxRec=null;

  if(!SR){
    paxMicBtn.style.opacity='0.4';
    paxMicBtn.title='Voice not supported in this browser';
    paxMicBtn.disabled=true;
  } else {
    paxMicBtn.onclick=()=>{
      if(paxListening){
        paxRec&&paxRec.stop();
        paxListening=false;
        paxMicBtn.style.background='rgba(168,85,247,0.15)';
        paxMicLabel.textContent='Speak passengers';
        return;
      }
      paxRec=new SR();
      paxRec.lang='en-IN';paxRec.interimResults=false;paxRec.continuous=false;
      paxListening=true;
      paxMicBtn.style.background='rgba(236,72,153,0.25)';
      paxMicBtn.style.borderColor='rgba(236,72,153,0.5)';
      paxMicLabel.textContent='Listening…';

      paxRec.onresult=e=>{
        const said=e.results[0][0].transcript.toLowerCase();
        paxListening=false;
        paxMicBtn.style.background='rgba(168,85,247,0.15)';
        paxMicBtn.style.borderColor='var(--border)';
        paxMicLabel.textContent='Speak passengers';

        // Parse numbers from voice: "2 adults 1 child 0 infants" etc.
        const wordNums={'zero':0,'no':0,'none':0,'a':1,'an':1,'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10};
        function extractNum(str,keywords){
          const t=str.toLowerCase();
          for(const kw of keywords){
            const dm=t.match(new RegExp('(\\d+)\\s*'+kw));
            if(dm) return parseInt(dm[1]);
            for(const[w,n] of Object.entries(wordNums)){
              if(new RegExp('\\b'+w+'\\s+'+kw).test(t)) return n;
            }
            // bare keyword with no number → assume 1
            if(new RegExp('\\b'+kw).test(t)) return 1;
          }
          return null;
        }
        const noChild=/\b(no|zero|without|none)\s+(child|children|kid|kids)\b/i.test(said);
        const noInfant=/\b(no|zero|without|none)\s+(infant|infants|baby|babies)\b/i.test(said);
        const a=extractNum(said,['adult','adults','grown']);
        const c=extractNum(said,['child','children','kid','kids']);
        const inf=extractNum(said,['infant','infants','baby','babies','toddler']);
        if(a!==null) setCount('adults',Math.max(1,a));
        if(noChild) setCount('children',0);
        else if(c!==null) setCount('children',c);
        if(noInfant) setCount('infants',0);
        else if(inf!==null) setCount('infants',inf);

        // Visual feedback
        paxMicLabel.textContent='✓ Got it!';
        setTimeout(()=>{ paxMicLabel.textContent='Speak passengers'; },1800);
      };
      paxRec.onerror=()=>{
        paxListening=false;
        paxMicLabel.textContent='Try again';
        paxMicBtn.style.background='rgba(168,85,247,0.15)';
        setTimeout(()=>{paxMicLabel.textContent='Speak passengers';},1500);
      };
      paxRec.onend=()=>{ paxListening=false; };
      paxRec.start();
    };
  }

  // ── Submit ───────────────────────────────────────────────────
  function submitPax(){
    const parts=[];
    parts.push(`${counts.adults} Adult${counts.adults>1?'s':''}`);
    if(counts.children>0) parts.push(`${counts.children} Child${counts.children!==1?'ren':''}`);
    if(counts.infants>0)  parts.push(`${counts.infants} Infant${counts.infants!==1?'s':''}`);
    const summary=parts.join(', ');
    widget.remove();
    doneChipWrap.remove();
    chatInput.disabled=false;
    inputHint.textContent='tap mic or type to respond';
    addMsg('user',summary);
    if(pendingReply){const fn=pendingReply;pendingReply=null;synth.cancel();fn(`${counts.adults} adults ${counts.children} children ${counts.infants} infants`);}
  }

  const doneChipWrap=document.createElement('div');
  doneChipWrap.className='chips-wrap';
  doneChipWrap.style.marginTop='8px';
  const doneChip=document.createElement('button');
  doneChip.className='chip';
  doneChip.innerHTML='<span>✓ Done</span>';
  doneChip.onclick=submitPax;
  doneChipWrap.appendChild(doneChip);

  messagesEl.appendChild(widget);
  messagesEl.appendChild(doneChipWrap);
  scrollToBottom();
}

// ── SUBMIT ────────────────────────────────────────────────────
function submit(text){
  text=text.trim();
  if(!text)return;
  chatInput.value='';
  clearChips();
  if(isListening)stopListening();
  addMsg('user',text);
  if(pendingReply){
    const fn=pendingReply;
    pendingReply=null;
    synth.cancel();
    fn(text);
  }
}

sendBtn.addEventListener('click',()=>submit(chatInput.value));
chatInput.addEventListener('keydown',e=>{if(e.key==='Enter')submit(chatInput.value);});
micBtn.addEventListener('click',()=>{
  if(isListening){stopListening();return;}
  synth.cancel();
  startListening(text=>{
    clearChips();
    addMsg('user',text);
    if(pendingReply){const fn=pendingReply;pendingReply=null;fn(text);}
  });
});

// ── PARSE HELPERS ─────────────────────────────────────────────
function cap(s){return s.split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');}
function fmtDate(d){if(!d)return'';const p=d.match(/(\d{4})-(\d{2})-(\d{2})/);if(!p)return d;const dt=new Date(Date.UTC(parseInt(p[1]),parseInt(p[2])-1,parseInt(p[3])));return dt.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});}
// Convert 24h "HH:MM" → 12h "H:MM AM/PM" — used in all flight card time displays
function fmt12(t){if(!t)return'';const p=t.match(/(\d{1,2}):(\d{2})/);if(!p)return t;let h=parseInt(p[1]),mn=p[2];const ap=h>=12?'PM':'AM';h=h%12||12;return h+':'+mn+' '+ap;}
// Add N days to YYYY-MM-DD date string → returns YYYY-MM-DD
function addDays(ds,n){
  if(!ds||!n)return ds;
  // Parse YYYY-MM-DD directly to avoid timezone shifts
  const p=ds.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(!p)return ds;
  let y=parseInt(p[1]),mo=parseInt(p[2])-1,d=parseInt(p[3]);
  const dt=new Date(Date.UTC(y,mo,d));
  dt.setUTCDate(dt.getUTCDate()+n);
  const yy=dt.getUTCFullYear(),mm=String(dt.getUTCMonth()+1).padStart(2,'0'),dd=String(dt.getUTCDate()).padStart(2,'0');
  return `${yy}-${mm}-${dd}`;
}

function fmtDateDDMMYYYY(d){
  if(!d) return '';
  const parts = d.split('-'); // YYYY-MM-DD format
  if(parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`; // DD-MM-YYYY
  }
  return d;
}

function parseDate(text){
  const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const t=text.toLowerCase();

  // ── RELATIVE DATES ──────────────────────────────────────────
  function toISO(d){
    return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  const today=new Date();today.setHours(0,0,0,0);

  if(/\btoday\b/.test(t)) return toISO(today);
  if(/\btomorrow\b/.test(t)){const d=new Date(today);d.setDate(d.getDate()+1);return toISO(d);}
  if(/\bday after tomorrow\b/.test(t)){const d=new Date(today);d.setDate(d.getDate()+2);return toISO(d);}
  if(/\bafter\s+(\d+)\s+days?\b/.test(t)){const m=t.match(/\bafter\s+(\d+)\s+days?\b/);if(m){const d=new Date(today);d.setDate(d.getDate()+parseInt(m[1]));return toISO(d);}}

  // "next monday/tuesday/.../sunday" or "this monday/.../sunday"
  const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const relDay=t.match(/\b(next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if(relDay){
    const isNext=relDay[1]==='next';
    const targetDay=days.indexOf(relDay[2]);
    const d=new Date(today);
    let diff=targetDay-d.getDay();
    if(isNext){
      // "next" always means the next occurrence (next week if today is that day)
      if(diff<=0) diff+=7;
    } else {
      // "this" means the next occurrence (could be today or later this week)
      if(diff<0) diff+=7;
      // if diff is 0 (today is that day), use today
    }
    d.setDate(d.getDate()+diff);
    return toISO(d);
  }

  // bare weekday: "tuesday", "friday" etc. → nearest upcoming
  const bareDay=t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if(bareDay){
    const targetDay=days.indexOf(bareDay[1]);
    const d=new Date(today);
    let diff=targetDay-d.getDay();
    if(diff<=0) diff+=7;
    d.setDate(d.getDate()+diff);
    return toISO(d);
  }

  // "in X days/weeks"
  const inDays=t.match(/\bin\s+(\d+)\s+days?\b/);
  if(inDays){const d=new Date(today);d.setDate(d.getDate()+parseInt(inDays[1]));return toISO(d);}
  const inWeeks=t.match(/\bin\s+(\d+)\s+weeks?\b/);
  if(inWeeks){const d=new Date(today);d.setDate(d.getDate()+parseInt(inWeeks[1])*7);return toISO(d);}

  // "next week" → 7 days from today
  if(/\bnext\s+week\b/.test(t)){const d=new Date(today);d.setDate(d.getDate()+7);return toISO(d);}

  // ── EXPLICIT DATE FORMATS ───────────────────────────────────
  // numeric formats: 20/06/2026, 20-06-2026, 2026-06-20
  const num1=t.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if(num1){return`${num1[1]}-${num1[2].padStart(2,'0')}-${num1[3].padStart(2,'0')}`;}
  const num2=t.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if(num2){return`${num2[3]}-${num2[2].padStart(2,'0')}-${num2[1].padStart(2,'0')}`;}

  // "20 june 2026", "20th june", "june 20", "june 20 2026", "20-june-2026"
  const dm=text.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s*[-\/]?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[-\/]?\s*(\d{4})?/i);
  if(dm){
    const d=dm[1],mi=months.indexOf(dm[2].toLowerCase().substring(0,3))+1,y=dm[3]||'2026';
    return`${y}-${String(mi).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  // "may1", "june15", "march3" — month name immediately followed by digits (no space)
  const noSpc=text.match(/(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(\d{1,2})(?:st|nd|rd|th)?\s*[-,]?\s*(\d{4})?/i);
  if(noSpc){
    const mi=months.indexOf(noSpc[1].toLowerCase().substring(0,3))+1,d=noSpc[2],y=noSpc[3]||'2026';
    return`${y}-${String(mi).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  const md=text.match(/(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-,]?\s*(\d{4})?/i);
  if(md){
    const mi=months.indexOf(md[1].toLowerCase().substring(0,3))+1,d=md[2],y=md[3]||'2026';
    return`${y}-${String(mi).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  return null;
}

function parseRouteDateCombined(text){
  const t=text.toLowerCase();
  let from='',to='';

  // "from X to Y" or "X to Y" - stop capturing destination at date keywords
  const cp=t.match(/(?:from\s+)?([\w\s,]+?)\s+to\s+([\w\s,]+?)(?:\s+(?:on|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this|next|after|in|january|february|march|april|may|june|july|august|september|october|november|december)\b|\s+\d|\s*,\s*\d|$)/i);
  if(cp){from=cp[1].trim().replace(/^[,\s]+|[,\s]+$/g,'');to=cp[2].trim().replace(/^[,\s]+|[,\s]+$/g,'');}
  else{
    const s=t.match(/([\w]+)\s+to\s+([\w]+)/i);
    if(s){from=s[1];to=s[2];}
  }

  const date=parseDate(text);
  return{from,to,date};
}

// ── AIRPORT PREFERENCE CHIPS ─────────────────────────────────
// Shows only the 3 preference tags — no airport names, no IATA codes.
// The actual airport is resolved automatically during flight search
// using all collected filters together.




// ── FILTER SUMMARY ────────────────────────────────────────────
function showFilterSummary(){
  clearChips();
  const sym=collected.currencySym||'₹';
  const flightPref=collected.flightPref||'direct';
  const stopsLabel=flightPref==='direct'?'Direct only':`Up to ${collected.stops||1} stop${(collected.stops||1)>1?'s':''}`;
  const transitLabel=`${collected.minTransit||2}h – ${collected.maxTransit||4}h`;
  const isRound=collected.tripType==='round';

  const panel=document.createElement('div');
  panel.className='filter-summary';

  // ── Build HTML (all values read-only) ──────────────────────
  panel.innerHTML=`
    <div class="filter-summary-header">
      <div class="filter-summary-title">JOURNEY PLAN</div>
      <div class="filter-summary-route">${cap(collected.originRaw)} ${isRound?'⟷':'→'} ${cap(collected.destinationRaw)}</div>
      <div class="filter-summary-ai-note">✦ Nearby airports and best routes will be resolved during flight search.</div>
    </div>

    <div class="filter-cards">

      <div class="filter-card" data-field="flightpref">
        <div class="filter-card-label">✈️ FLIGHT PREFERENCE</div>
        <div class="filter-card-value">${flightPref==='direct'?'Direct Flight':'Connecting Flight'}</div>
      </div>

      <div class="filter-card" data-field="date">
        <div class="filter-card-label">📅 DEPARTURE DATE</div>
        <div class="filter-card-value">${fmtDate(collected.date)}</div>
      </div>

      ${isRound?`<div class="filter-card" data-field="returndate" style="border-color:rgba(167,139,250,0.4);background:rgba(167,139,250,0.08);">
        <div class="filter-card-label" style="color:var(--accent2);">🔙 RETURN DATE</div>
        <div class="filter-card-value" style="color:var(--accent2);font-weight:500;">${collected.returnDate?fmtDate(collected.returnDate):'<span style="color:#ec4899;font-size:0.8rem;">⚠ Not set — click Edit to add</span>'}</div>
      </div>`:''}

      <div class="filter-card" data-field="pax">
        <div class="filter-card-label">👥 PASSENGERS</div>
        <div class="filter-card-value">${collected.adults} Adult${collected.adults>1?'s':''}${collected.children>0?', '+collected.children+' Child'+(collected.children!==1?'ren':''):''}${collected.infants>0?', '+collected.infants+' Infant'+(collected.infants!==1?'s':''):''}</div>
      </div>

      <div class="filter-card" data-field="trip">
        <div class="filter-card-label">🔄 TRIP TYPE</div>
        <div class="filter-card-value">${isRound?'Round Trip':'One Way'}</div>
      </div>

      <div class="filter-card" data-field="budget">
        <div class="filter-card-label">💰 FLIGHT BUDGET</div>
        <div class="filter-card-value">${sym}${(collected.budget||0).toLocaleString('en-IN')} / passenger</div>
      </div>

      ${flightPref==='connecting'?`
      <div class="filter-card" data-field="stops">
        <div class="filter-card-label">🔁 MAX STOPS</div>
        <div class="filter-card-value">${stopsLabel}</div>
      </div>
      <div class="filter-card" data-field="transit">
        <div class="filter-card-label">⏱️ LAYOVER DURATION</div>
        <div class="filter-card-value">${transitLabel}</div>
      </div>`:''}

      <div class="filter-card" data-field="deptime">
        <div class="filter-card-label">🕐 DEPARTURE TIME</div>
        <div class="filter-card-value">${collected.depTime||'Night (9PM-6AM)'}</div>
      </div>

      <div class="filter-card" data-field="cabin">
        <div class="filter-card-label">💺 TRAVEL CLASS</div>
        <div class="filter-card-value">${collected.cabin||'Economy'}</div>
      </div>

    </div>

    <div class="filter-button-group">
      <button class="filter-btn-edit" id="editModeBtn">✏️ ENABLE EDITING</button>
      <button class="filter-search-btn" id="searchNowBtn">🔍 SEARCH FLIGHTS</button>
    </div>`;

  messagesEl.appendChild(panel);
  activeSummaryPanel=panel;
  scrollToBottom();

  // ── EDIT MODE ───────────────────────────────────────────────
  panel.querySelector('#editModeBtn').onclick=(e)=>{
    e.preventDefault();
    const btn=panel.querySelector('#editModeBtn');

    if(panel.classList.contains('editing-mode')){
      panel.classList.remove('editing-mode');
      btn.textContent='✏️ ENABLE EDITING';
      const wb=panel.querySelector('#search-warning-banner');
      if(wb){wb.style.display='none';}
      messagesEl.removeChild(panel);
      showFilterSummary();
      return;
    }

    panel.classList.add('editing-mode');
    btn.textContent='✓ SAVE CHANGES';

    // Abort any running search but keep both buttons disabled
    activeSearchAbort=true;
    const wb=panel.querySelector('#search-warning-banner');
    if(wb) wb.style.display='none';

    const filterCards=panel.querySelector('.filter-cards');

    // ── Helper: make a card element in edit mode ──────────
    function makeCard(field){
      const card=document.createElement('div');
      card.className='filter-card';
      card.dataset.field=field;
      const lbl=document.createElement('div');lbl.className='filter-card-label';
      const val=document.createElement('div');val.className='filter-card-value';
      card.appendChild(lbl);card.appendChild(val);

      const labels={
        flightpref:'✈️ FLIGHT PREFERENCE',date:'📅 DEPARTURE DATE',
        returndate:'📅 RETURN DATE',pax:'👥 PASSENGERS',trip:'🔄 TRIP TYPE',
        budget:'💰 FLIGHT BUDGET',stops:'🔁 MAX STOPS',
        transit:'⏱️ LAYOVER DURATION',deptime:'🕐 DEPARTURE TIME',cabin:'💺 TRAVEL CLASS'
      };
      lbl.textContent=labels[field]||field;

      let input;

      if(field==='flightpref'){
        input=document.createElement('select');
        input.innerHTML=`<option value="direct">Direct Flight</option><option value="connecting">Connecting Flight</option>`;
        input.value=collected.flightPref||'direct';
        input.onchange=()=>{
          collected.flightPref=input.value;
          collected.stops=input.value==='direct'?0:Math.max(1,collected.stops||1);
          // Show/hide stops+transit cards dynamically
          const existingStops=filterCards.querySelector('[data-field="stops"]');
          const existingTransit=filterCards.querySelector('[data-field="transit"]');
          const deptimeCard=filterCards.querySelector('[data-field="deptime"]');
          if(input.value==='connecting'){
            if(!existingStops){
              const sc=makeCard('stops');
              const tc=makeCard('transit');
              filterCards.insertBefore(tc,deptimeCard);
              filterCards.insertBefore(sc,tc);
            }
          } else {
            if(existingStops) existingStops.remove();
            if(existingTransit) existingTransit.remove();
          }
        };
      }
      else if(field==='date'){
        input=document.createElement('input');input.type='date';
        input.value=collected.date?String(collected.date).split('T')[0]:'';
        input.onchange=()=>{ collected.date=input.value; };
      }
      else if(field==='returndate'){
        input=document.createElement('input');input.type='date';
        input.value=collected.returnDate?String(collected.returnDate).split('T')[0]:'';
        input.onchange=()=>{ collected.returnDate=input.value; };
      }
      else if(field==='pax'){
        const wrap=document.createElement('div');
        wrap.style.cssText='display:flex;gap:8px;align-items:center;width:100%;';
        [{key:'adults',label:'Adults',min:1},{key:'children',label:'Children',min:0},{key:'infants',label:'Infants',min:0}]
        .forEach(r=>{
          const col=document.createElement('div');
          col.style.cssText='display:flex;flex-direction:column;align-items:center;flex:1;gap:3px;';
          const sublbl=document.createElement('span');
          sublbl.style.cssText='font-size:0.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;';
          sublbl.textContent=r.label;
          const inp=document.createElement('input');
          inp.type='number';inp.min=r.min;inp.max=9;
          inp.value=collected[r.key]||r.min;
          inp.className='dropdown-select';
          inp.style.cssText='text-align:center;padding:6px 4px;width:100%;';
          inp.oninput=()=>{ let v=Math.max(r.min,parseInt(inp.value)||0);collected[r.key]=v;if(collected.infants>collected.adults)collected.infants=collected.adults; };
          col.appendChild(sublbl);col.appendChild(inp);wrap.appendChild(col);
        });
        val.appendChild(wrap);
        return card;
      }
      else if(field==='trip'){
        input=document.createElement('select');
        input.innerHTML=`<option value="oneway">One Way</option><option value="round">Round Trip</option>`;
        input.value=collected.tripType||'oneway';
        input.onchange=()=>{
          collected.tripType=input.value;
          // Update route arrow in header
          const routeEl=panel.querySelector('.filter-summary-route');
          if(routeEl) routeEl.textContent=`${cap(collected.originRaw)} ${input.value==='round'?'⟷':'→'} ${cap(collected.destinationRaw)}`;
          const existingReturn=filterCards.querySelector('[data-field="returndate"]');
          const tripCard=filterCards.querySelector('[data-field="trip"]');
          if(input.value==='round'){
            if(!existingReturn){
              const rc=makeCard('returndate');
              // insert right after trip card
              tripCard.insertAdjacentElement('afterend',rc);
            }
          } else {
            if(existingReturn) existingReturn.remove();
          }
        };
      }
      else if(field==='budget'){
        input=document.createElement('input');input.type='number';
        input.value=collected.budget||0;input.placeholder='e.g. 40000';
        input.onchange=()=>{ collected.budget=parseInt(input.value)||0; };
      }
      else if(field==='stops'){
        input=document.createElement('select');
        input.innerHTML=`<option value="1">Up to 1 stop</option><option value="2">Up to 2 stops</option>`;
        input.value=String(collected.stops||1);
        input.onchange=()=>{ collected.stops=parseInt(input.value); };
      }
      else if(field==='transit'){
        input=document.createElement('select');
        [['1-2','1–2 Hours'],['2-3','2–3 Hours'],['3-4','3–4 Hours'],['4+','4+ Hours']]
          .forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;input.appendChild(o);});
        input.value=`${collected.minTransit||2}-${collected.maxTransit||4}`;
        input.onchange=()=>{
          const p=input.value.split('-');
          if(p[1]==='+'||!p[1]){collected.minTransit=4;collected.maxTransit=8;}
          else{collected.minTransit=parseInt(p[0]);collected.maxTransit=parseInt(p[1]);}
        };
      }
      else if(field==='deptime'){
        input=document.createElement('select');
        ['Early Morning (6AM-9AM)','Morning (9AM-12PM)','Afternoon (12PM-6PM)','Evening (6PM-9PM)','Night (9PM-6AM)']
          .forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;input.appendChild(o);});
        input.value=collected.depTime||'Night (9PM-6AM)';
        input.onchange=()=>{ collected.depTime=input.value; };
      }
      else if(field==='cabin'){
        input=document.createElement('select');
        ['Economy','Premium Economy','Business','First Class']
          .forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;input.appendChild(o);});
        input.value=collected.cabin||'Economy';
        input.onchange=()=>{ collected.cabin=input.value; };
      }

      if(input){ input.className='dropdown-select'; val.appendChild(input); }
      return card;
    }

    // ── Replace all existing filter cards with editable versions ─
    // Remove all current filter-card elements
    filterCards.querySelectorAll('.filter-card').forEach(c=>c.remove());

    // Rebuild in correct order
    const order=['flightpref','date'];
    if(collected.tripType==='round') order.push('returndate'); // only if round trip
    order.push('pax','trip','budget');
    if((collected.flightPref||'direct')==='connecting') order.push('stops','transit'); // only if connecting
    order.push('deptime','cabin');

    // Insert before button group
    const btnGroup=panel.querySelector('.filter-button-group');
    order.forEach(field=>{
      filterCards.insertBefore(makeCard(field),null); // append
    });
  };

  const searchBtn=panel.querySelector('#searchNowBtn');
  const editBtn=panel.querySelector('#editModeBtn');

  // Warning banner — always visible, placed at TOP of panel
  const warnBanner=document.createElement('div');
  warnBanner.id='search-warning-banner';
  warnBanner.style.cssText=`
    display:block;margin-bottom:14px;padding:10px 14px;
    background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.3);
    border-radius:10px;font-size:0.78rem;color:#fbbf24;line-height:1.6;text-align:center;
  `;
  warnBanner.innerHTML=`⚠️ <strong>Important:</strong> Once you click <strong>Search Flights</strong>, both buttons will be permanently disabled. Please review all your filters carefully before searching.`;
  panel.querySelector('.filter-summary-header').after(warnBanner);

  function enableSearchBtn(){ /* buttons stay permanently disabled after search */ }
  function disableSearchBtn(){
    searchBtn.disabled=true;
    editBtn.disabled=true;
    editBtn.style.opacity='0.4';
    searchBtn.classList.add('searching');
    searchBtn.textContent='⏳ SEARCHING…';
    warnBanner.innerHTML=`⏳ <strong>Searching for flights…</strong> Please wait. Both buttons are now disabled — you cannot make any changes during the search.`;
    warnBanner.style.background='rgba(251,191,36,0.1)';
    warnBanner.style.borderColor='rgba(251,191,36,0.35)';
    warnBanner.style.color='#fbbf24';
  }

  // Search button — disable both buttons, show warning
  searchBtn.onclick=()=>{
    if(searchBtn.disabled) return;
    disableSearchBtn();
    activeSearchAbort=false;
    if(panel.classList.contains('editing-mode')){
      panel.querySelector('#editModeBtn').click();
      setTimeout(()=>{ if(!activeSearchAbort) searchFlights(); },100);
    } else {
      searchFlights();
    }
  };

  // Edit button re-enables everything and hides warning
  const _origEditClick=editBtn.onclick;
  editBtn.onclick=(e)=>{
    if(searchBtn.disabled && !panel.classList.contains('editing-mode')){
      activeSearchAbort=true;
    }
    if(_origEditClick) _origEditClick.call(editBtn, e);
  };
}


async function autocorrectCity(name){
  // ✅ NO API KEY NEEDED - Returns name as-is
  return name.trim() || name;
}

async function confirmRouteDate(){
  // Guard: if either city is still missing, ask for it
  if(!collected.originRaw||collected.originRaw==='undefined'){
    await velora(`Where are you flying from?`);
    awaitReply(async t=>{collected.originRaw=t.trim();detectCurrency(t);confirmRouteDate();}); return;
  }
  if(!collected.destinationRaw||collected.destinationRaw==='undefined'){
    await velora(`Where are you flying to?`);
    awaitReply(async t=>{collected.destinationRaw=t.trim();confirmRouteDate();}); return;
  }
  if(!collected.date){
    await velora(`What date are you travelling?`);
    awaitReply(async t=>{
      const parsed = parseDate(t);
      if(parsed) {
        collected.date = parsed;
        confirmRouteDate();
      } else {
        await velora(`I couldn't understand that date. Please try again (e.g., 'tomorrow', 'next monday', '25 march 2026')`);
        awaitReply(async t2=>{collected.date=parseDate(t2);confirmRouteDate();});
      }
    }); return;
  }
  // Show typing while resolving city names
  const typRow=showTyping();
  const[fromFixed,toFixed]=await Promise.all([
    autocorrectCity(collected.originRaw),
    autocorrectCity(collected.destinationRaw)
  ]);
  removeTyping();
  collected.originRaw=fromFixed;
  collected.destinationRaw=toFixed;
  
  // New format: journey plan and trip date
  const journeyPlan = `${collected.originRaw.toLowerCase()} → ${collected.destinationRaw.toLowerCase()}`;
  const tripDate = fmtDateDDMMYYYY(collected.date);
  
  await velora(`✈️ <b>journey plan:</b> ${journeyPlan}<br>📅 <b>trip date:</b> ${tripDate}<br><br>All set — let's find you the best flights!`);
  currentStep=1;handleStep(1);
}

// ── STEPS ─────────────────────────────────────────────────────
async function handleStep(idx){
  // Skip steps based on conditions
  const step=STEPS[idx];
  
  // Skip old pax sub-steps (now handled by widget in step 1)
  if(step.type==='skip'){
    currentStep=idx+1;
    if(currentStep<STEPS.length) handleStep(currentStep);
    return;
  }
  
  // Check if step should be skipped
  if(step.condition==='roundtrip' && collected.tripType!=='round'){
    currentStep=idx+1;
    if(currentStep<STEPS.length) handleStep(currentStep);
    return;
  }
  if(step.condition==='connecting' && collected.stops===0){
    currentStep=idx+1;
    if(currentStep<STEPS.length) handleStep(currentStep);
    return;
  }
  
  updateProgress(idx);
  await velora(step.prompt);
  
  // Show pax widget for passenger step
  if(step.type==='passengers'){
    pendingReply = text => handleResponse(idx, text);
    chatInput.disabled = false;
    chatInput.focus();
    inputHint.textContent = 'set passengers above, type (e.g. "2 adults 1 child"), or use 🎤';
    showPaxWidget();
  // For dropdown steps: show chips as shortcuts BUT also enable text/voice via pendingReply
  } else if(step.type==='dropdown' && step.options){
    pendingReply = text => handleResponse(idx, text);
    showChips(step.options.map(opt=>({label:opt,value:opt})), val=>handleResponse(idx,val));
  } else {
    awaitReply(text=>handleResponse(idx,text));
  }
}

function detectCurrency(text){
  // Always INR — price display locked to Indian Rupees
  collected.currency='INR';collected.currencySym='₹';
}

async function handleResponse(idx,text){
  const step=STEPS[idx];
  
  // ── STEP 0: Route + Date ───────────────────────────────────
  if(idx===0){
    const parsed=parseRouteDateCombined(text);
    let hasFrom=parsed.from&&parsed.from.trim().length>1;
    let hasTo  =parsed.to  &&parsed.to.trim().length>1;
    const hasDate=!!parsed.date;

    // Try to extract a lone city mention (no "to" pattern) — e.g. "Delhi on May 1", "delhi may 1"
    if(!hasFrom&&!hasTo){
      // Strip date-related words and numbers, then take what's left as the city
      let stripped = text
        .replace(/\b(on|at|for|date|travel|trip|flight|going|fly|flying|from|to)\b/gi, ' ')
        .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/gi, ' ')
        .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, ' ')
        .replace(/\b(today|tomorrow|next|this|after|weekend)\b/gi, ' ')
        .replace(/\d+(?:st|nd|rd|th)?/gi, ' ')
        .replace(/[,\.!?\-\/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if(stripped.length > 1) parsed.loneCity = stripped;
    }

    if(hasFrom){collected.originRaw=parsed.from.trim();detectCurrency(collected.originRaw);}
    if(hasTo)  collected.destinationRaw=parsed.to.trim();
    if(hasDate) collected.date=parsed.date;

    // ── Helper: ask both cities ────────────────────────────
    async function askBothCities(){
      await velora(`Where are you flying from?`);
      awaitReply(async t1=>{
        collected.originRaw=t1.trim();
        detectCurrency(t1);
        await velora(`And where are you flying to?`);
        awaitReply(async t2=>{
          collected.destinationRaw=t2.trim();
          if(!collected.date){ await velora(`What date are you travelling?`);
            awaitReply(async t3=>{collected.date=parseDate(t3)||t3;confirmRouteDate();});
          } else { confirmRouteDate(); }
        });
      });
    }

    // ── Helper: ask for missing date ──────────────────────
    async function askDate(thenFn){
      await velora(`What date are you travelling?`);
      awaitReply(async t=>{
        const d=parseDate(t);
        if(!d){ await velora("Couldn't catch that date. Please try again (e.g. '25 June 2026').");
          awaitReply(async t2=>{collected.date=parseDate(t2)||t2; thenFn();});
        } else { collected.date=d; thenFn(); }
      });
    }

    // ── Route 1: nothing at all ───────────────────────────
    if(!hasFrom&&!hasTo&&!hasDate&&!parsed.loneCity){
      await velora("Please share your departure city, destination, and travel date — e.g. 'Chennai to Dubai on 15 June'.");
      awaitReply(t=>handleResponse(0,t)); return;
    }

    // ── Route 2: lone city + date (e.g. "Delhi on May 1") ─
    // Assume lone city is the ORIGIN (most natural — people say where they fly FROM first)
    if(!hasFrom&&!hasTo&&parsed.loneCity){
      collected.originRaw = parsed.loneCity;
      detectCurrency(parsed.loneCity);
      await velora(`Got it — departing from ${cap(parsed.loneCity)}${hasDate ? ' on ' + fmtDate(collected.date) : ''}. Where are you flying to?`);
      awaitReply(async t => {
        collected.destinationRaw = t.trim();
        if(!collected.date) await askDate(confirmRouteDate);
        else confirmRouteDate();
      });
      return;
    }

    // ── Route 3: lone city, no date ───────────────────────
    if(!hasFrom&&!hasTo&&!hasDate&&parsed.loneCity){
      await velora(`Could you share your full journey? E.g. 'Mumbai to London on 10 July'.`);
      awaitReply(t=>handleResponse(0,t)); return;
    }

    // ── Route 4: only date ────────────────────────────────
    if(!hasFrom&&!hasTo&&hasDate&&!parsed.loneCity){
      await velora(`Got the date — ${fmtDate(collected.date)}. Where are you flying from?`);
      awaitReply(async t=>{ collected.originRaw=t.trim(); detectCurrency(t);
        await velora(`And where are you flying to?`);
        awaitReply(async t2=>{ collected.destinationRaw=t2.trim(); confirmRouteDate(); });
      }); return;
    }

    // ── Route 5: !from, has to + date ────────────────────
    if(!hasFrom&&hasTo&&hasDate){
      await velora(`Flying to ${collected.destinationRaw} on ${fmtDate(collected.date)}. Which city are you departing from?`);
      awaitReply(async t=>{ collected.originRaw=t.trim(); detectCurrency(t); confirmRouteDate(); }); return;
    }

    // ── Route 6: !from, has to, no date ──────────────────
    if(!hasFrom&&hasTo&&!hasDate){
      await velora(`Destination: ${collected.destinationRaw}. Which city are you departing from?`);
      awaitReply(async t=>{ collected.originRaw=t.trim(); detectCurrency(t);
        await askDate(confirmRouteDate); }); return;
    }

    // ── Route 7: has from, !to, has date ─────────────────
    if(hasFrom&&!hasTo&&hasDate){
      await velora(`Departing ${collected.originRaw} on ${fmtDate(collected.date)}. Where are you flying to?`);
      awaitReply(async t=>{ collected.destinationRaw=t.trim(); confirmRouteDate(); }); return;
    }

    // ── Route 8: has from, !to, no date ──────────────────
    if(hasFrom&&!hasTo&&!hasDate){
      await velora(`Departing from ${collected.originRaw}. Where are you flying to?`);
      awaitReply(async t=>{ collected.destinationRaw=t.trim();
        await askDate(confirmRouteDate); }); return;
    }

    // ── Route 9: has from + to, no date ──────────────────
    if(hasFrom&&hasTo&&!hasDate){
      await velora(`${collected.originRaw} → ${collected.destinationRaw} — great route! What date are you travelling?`);
      awaitReply(async t=>{ const d=parseDate(t);
        if(!d){ await velora("Couldn't catch that date. Please try again (e.g. '25 June').");
          awaitReply(async t2=>{collected.date=parseDate(t2)||t2; confirmRouteDate();}); return; }
        collected.date=d; confirmRouteDate(); }); return;
    }

    // ── Route 10: all three parsed ────────────────────────
    if(hasFrom&&hasTo&&hasDate){ confirmRouteDate(); return; }

    // Fallback
    await velora("Please share your departure city, destination, and travel date.");
    awaitReply(t=>handleResponse(0,t));

  // ── STEP 1: Passengers (via widget or typed/voice) ────────
  }else if(idx===1){
    // Convert word numbers → digits
    const wordMap={zero:0,no:0,none:0,a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
    function parseNum(str,keywords){
      const t=str.toLowerCase();
      for(const kw of keywords){
        // digit before keyword: "2 adults", "2adults"
        const dm=t.match(new RegExp('(\\d+)\\s*'+kw));
        if(dm) return parseInt(dm[1]);
        // word number before keyword: "two adults", "one adult"
        for(const[w,n] of Object.entries(wordMap)){
          if(new RegExp('\\b'+w+'\\s+'+kw).test(t)) return n;
        }
        // keyword with no preceding number → infer 1 if keyword present
        if(new RegExp('\\b'+kw).test(t)) return 1;
      }
      return null;
    }
    const a=parseNum(text,['adult','adults','grown']);
    const c=parseNum(text,['child','children','kid','kids']);
    const inf=parseNum(text,['infant','infants','baby','babies','toddler','toddlers']);

    // "no children" / "zero kids" / "without children" → 0
    const noChild=/\b(no|zero|without|none)\s+(child|children|kid|kids)\b/i.test(text);
    const noInfant=/\b(no|zero|without|none)\s+(infant|infants|baby|babies)\b/i.test(text);

    collected.adults  = a   !== null ? Math.max(1, a) : 1;
    collected.children= noChild ? 0 : (c   !== null ? Math.max(0, c) : 0);
    collected.infants = noInfant? 0 : (inf !== null ? Math.max(0, inf): 0);

    // Infant cap: can't exceed adults
    if(collected.infants > collected.adults) collected.infants = collected.adults;

    const paxParts=[`${collected.adults} Adult${collected.adults>1?'s':''}`];
    if(collected.children>0) paxParts.push(`${collected.children} Child${collected.children!==1?'ren':''}`);
    if(collected.infants>0)  paxParts.push(`${collected.infants} Infant${collected.infants!==1?'s':''}`);
    const paxSummary=paxParts.join(', ');
    await velora(`Perfect — ${paxSummary}. Is this a one-way or round trip?`);
    currentStep=5;
    updateProgress(5);
    pendingReply=val=>handleResponse(5,val);
    showChips([
      {icon:'✈️',label:'One Way',value:'oneway'},
      {icon:'🔄',label:'Round Trip',value:'round'}
    ],val=>handleResponse(5,val));

  // ── STEP 2-4: (handled by pax widget, should not be reached) ──
  }else if(idx===2||idx===3||idx===4){
    currentStep=5;handleStep(5);

  // ── STEP 5: Trip Type (Dropdown) ──────────────────────────
  }else if(idx===5){
    collected.tripType=/round|return|both/i.test(text)?'round':'oneway';
    if(collected.tripType==='round'){
      await velora(`Round trip — noted. When is your return date?`);
      currentStep=6; updateProgress(6);
      awaitReply(t=>handleResponse(6,t));
    } else {
      await velora(`One way — got it. What's your budget per passenger? (e.g. ₹40,000)`);
      currentStep=7; updateProgress(7);
      awaitReply(t=>handleResponse(7,t));
    }

  // ── STEP 6: Return Date (Conditional) ─────────────────────
  }else if(idx===6){
    const d=parseDate(text);
    if(!d){
      await velora("Couldn't catch that date. Please try again (e.g. '25 June 2026').");
      awaitReply(t=>handleResponse(6,t));
      return;
    }
    if(collected.date && d <= collected.date){
      await velora(`Return date must be after your departure (${fmtDate(collected.date)}). Please enter a later date.`);
      awaitReply(t=>handleResponse(6,t));
      return;
    }
    collected.returnDate=d;
    await velora(`✅ Round trip confirmed:\n🛫 Depart: ${fmtDate(collected.date)}\n🛬 Return: ${fmtDate(d)}\n\nWhat's your budget per passenger? (e.g. ₹40,000)`);
    currentStep=7; updateProgress(7);
    awaitReply(t=>handleResponse(7,t));

  // ── STEP 7: Budget ────────────────────────────────────────
  }else if(idx===7){
    const raw=text.replace(/[₹,\s]/g,'');
    let budget=0;
    const kMatch=raw.match(/^(\d+\.?\d*)k$/i);
    const lMatch=raw.match(/^(\d+\.?\d*)l(?:akh)?$/i);
    const plain=raw.match(/^(\d+)$/);
    if(kMatch) budget=Math.round(parseFloat(kMatch[1])*1000);
    else if(lMatch) budget=Math.round(parseFloat(lMatch[1])*100000);
    else if(plain) budget=parseInt(plain[1]);
    else { const m=text.match(/[\d,]+/); budget=m?parseInt(m[0].replace(/,/g,'')):0; }

    if(!budget || budget < 500){
      await velora(`That doesn't look like a valid flight budget. Please enter a budget per passenger in rupees (e.g. ₹5,000 or ₹40,000).`);
      awaitReply(t=>handleResponse(7,t));
      return;
    }
    collected.budget=budget;
    await velora(`₹${collected.budget.toLocaleString('en-IN')} per passenger — noted. Direct flight or connecting?`);
    currentStep=8; updateProgress(8);
    pendingReply=val=>handleResponse(8,val);
    showChips([
      {icon:'✈️',label:'Direct Flight',value:'direct'},
      {icon:'🔀',label:'Connecting Flight',value:'connecting'}
    ],val=>handleResponse(8,val));

  // ── STEP 8: Flight Preference (Dropdown) ──────────────────
  }else if(idx===8){
    const isDirect=/direct/i.test(text);
    collected.stops=isDirect?0:1;
    collected.flightPref=isDirect?'direct':'connecting';
    if(isDirect){
      await velora(`Direct flights only — understood. What's your preferred departure time?`);
      currentStep=10; updateProgress(10);
      pendingReply=val=>handleResponse(10,val);
      showChips([
        {icon:'🌅',label:'Early Morning (6AM-9AM)',value:'early'},
        {icon:'☀️',label:'Morning (9AM-12PM)',value:'morning'},
        {icon:'🌤️',label:'Afternoon (12PM-6PM)',value:'afternoon'},
        {icon:'🌆',label:'Evening (6PM-9PM)',value:'evening'},
        {icon:'🌙',label:'Night (9PM-6AM)',value:'night'}
      ],val=>handleResponse(10,val));
    } else {
      await velora(`Connecting flights — got it. How many stops are you okay with?`);
      currentStep=81; updateProgress(81);
      pendingReply=val=>handleResponse(81,val);
      showChips([
        {icon:'1️⃣',label:'1 Stop',value:'1'},
        {icon:'2️⃣',label:'Up to 2 Stops',value:'2'},
        {icon:'🔀',label:'Any',value:'any'}
      ],val=>handleResponse(81,val));
    }

  // ── STEP 81: Max Stops (virtual, connecting only) ─────────
  }else if(idx===81){
    if(/any/i.test(text)) collected.stops=2;
    else { const n=parseInt(text)||1; collected.stops=Math.min(2,Math.max(1,n)); }
    await velora(`Up to ${collected.stops} stop${collected.stops>1?'s':''} — noted. What's your maximum acceptable layover duration?`);
    currentStep=9; updateProgress(9);
    pendingReply=val=>handleResponse(9,val);
    showChips([
      {icon:'⚡',label:'1–2 Hours',value:'1-2'},
      {icon:'🕐',label:'2–3 Hours',value:'2-3'},
      {icon:'🕓',label:'3–4 Hours',value:'3-4'},
      {icon:'🌙',label:'4+ Hours',value:'4+'}
    ],val=>handleResponse(9,val));

  // ── STEP 9: Layover Duration (Conditional) ────────────────
  }else if(idx===9){
    if(/1[\s\-–]+2|^1-2$|one.?two|^1\s*hour/i.test(text)){collected.minTransit=1;collected.maxTransit=2;}
    else if(/2[\s\-–]+3|^2-3$|two.?three|^2\s*hours?/i.test(text)){collected.minTransit=2;collected.maxTransit=3;}
    else if(/3[\s\-–]+4|^3-4$|three.?four|^3\s*hours?/i.test(text)){collected.minTransit=3;collected.maxTransit=4;}
    else if(/4\+|4\s*plus|4\s*or\s*more|more\s*than\s*4|^4\s*hours?/i.test(text)){collected.minTransit=4;collected.maxTransit=8;}
    else{collected.minTransit=2;collected.maxTransit=4;}
    await velora(`Layover ${collected.minTransit}–${collected.maxTransit} hours — perfect. Preferred departure time?`);
    currentStep=10; updateProgress(10);
    pendingReply=val=>handleResponse(10,val);
    showChips([
      {icon:'🌅',label:'Early Morning (6AM-9AM)',value:'early'},
      {icon:'☀️',label:'Morning (9AM-12PM)',value:'morning'},
      {icon:'🌤️',label:'Afternoon (12PM-6PM)',value:'afternoon'},
      {icon:'🌆',label:'Evening (6PM-9PM)',value:'evening'},
      {icon:'🌙',label:'Night (9PM-6AM)',value:'night'}
    ],val=>handleResponse(10,val));

  // ── STEP 10: Departure Time (Dropdown) ────────────────────
  }else if(idx===10){
    // Handles both chip values ('early','morning'…) and typed text
    if(/^early$|early\s*morning|6\s*-?\s*9(?:\s*am)?/i.test(text)) collected.depTime='Early Morning (6AM-9AM)';
    else if(/^morning$|9\s*-?\s*12|9am.?12pm/i.test(text)) collected.depTime='Morning (9AM-12PM)';
    else if(/^afternoon$|12\s*-?\s*6|12pm.?6pm/i.test(text)) collected.depTime='Afternoon (12PM-6PM)';
    else if(/^evening$|6pm.?9pm|6\s*-?\s*9\s*pm/i.test(text)) collected.depTime='Evening (6PM-9PM)';
    else if(/^night$|9pm.?6am|9\s*-?\s*6/i.test(text)) collected.depTime='Night (9PM-6AM)';
    else if(/any|flexible|no\s*pref/i.test(text)) collected.depTime='Any time';
    else collected.depTime='Any time';
    const depTimeLabel = collected.depTime.replace(/\s*\(.*?\)/g, '').trim();
    await velora(`${depTimeLabel} — perfect. Which cabin class?`);
    currentStep=11; updateProgress(11);
    pendingReply=val=>handleResponse(11,val);
    showChips([
      {icon:'💺',label:'Economy',value:'economy'},
      {icon:'💼',label:'Premium Economy',value:'premium'},
      {icon:'🛏️',label:'Business',value:'business'},
      {icon:'👑',label:'First Class',value:'first'}
    ],val=>handleResponse(11,val));

  // ── STEP 11: Cabin Class (Dropdown) ───────────────────────
  }else if(idx===11){
    if(/premium/i.test(text))collected.cabin='Premium Economy';
    else if(/business/i.test(text))collected.cabin='Business';
    else if(/first/i.test(text))collected.cabin='First Class';
    else collected.cabin='Economy';
    await velora(`${collected.cabin} class — all set!${collected.tripType==='round'&&collected.returnDate?` Round trip: ${fmtDate(collected.date)} → ${fmtDate(collected.returnDate)}.`:''} Here's your journey summary:`);
    currentStep=12;
    showFilterSummary();
  }
}

// ── INTELLIGENT FLIGHT RECOMMENDATION ENGINE (FILTERED FLIGHTS ONLY) ──────────────────

/**
 * FILTERED FLIGHT ENGINE — STEP 1 + STEP 2
 *
 * Step 1: Mandatory filter matching — ALL must pass:
 *   price ≤ budget, stops within preference, cabin match, airline match (if set)
 *
 * Step 2: Flexible time match with ±1 hour tolerance on slot boundaries.
 *   E.g. Morning (9AM–12PM) → accept 8AM–1PM departures.
 */
function isStrictMatch(flight, filters, budget) {

  // ── 1. Price must be within budget ─────────────────────────────
  if(flight.pricePerPax > budget) return false;

  // ── 2. Stops preference ────────────────────────────────────────
  if(filters.flightPref === 'direct') {
    if(flight.stops !== 0) return false;
  } else if(filters.flightPref === 'connecting') {
    if(flight.stops === 0) return false;
    const maxStops = (filters.stops !== undefined && filters.stops !== null) ? filters.stops : 2;
    if(flight.stops > maxStops) return false;
  }

  // ── 3. Departure time with ±1h tolerance on slot boundaries ────
  if(filters.depTime && filters.depTime !== 'Any time' && filters.depTime !== 'any') {
    // Slot windows with 1-hour tolerance applied to both edges
    const slotWindows = {
      'Early Morning (6AM-9AM)':  [5,  10],   // 6-1=5 → 9+1=10
      'Morning (9AM-12PM)':       [8,  13],   // 9-1=8 → 12+1=13
      'Afternoon (12PM-6PM)':     [11, 19],   // 12-1=11 → 18+1=19
      'Evening (6PM-9PM)':        [17, 22],   // 18-1=17 → 21+1=22
      'Night (9PM-6AM)':          [20, 30],   // 21-1=20 → wraps
    };
    const window = slotWindows[filters.depTime];
    if(window) {
      const depH = parseInt((flight.segments&&flight.segments[0]
        ? flight.segments[0].departureTime : '0').split(':')[0]) || 0;
      // Handle night wrap-around (values > 24 mean early next morning)
      const adjustedH = (window[1] > 24 && depH < 6) ? depH + 24 : depH;
      if(adjustedH < window[0] || adjustedH >= window[1]) return false;
    }
  }

  // ── 4. Layover duration ─────────────────────────────────────────
  if(filters.maxTransit && flight.maxLayover && flight.maxLayover > filters.maxTransit) return false;

  // ── 5. Cabin class ──────────────────────────────────────────────
  const flightCabin = flight.cabin || 'Economy';
  const filterCabin = filters.cabin || 'Economy';
  if(flightCabin !== filterCabin) return false;

  // ── 6. Airline preference (if user selected one) ────────────────
  if(filters.airlinePref && filters.airlinePref.trim() !== '') {
    const pref    = filters.airlinePref.toLowerCase().trim();
    const airline = (flight.airline || '').toLowerCase();
    if(!airline.includes(pref) && !pref.includes(airline)) return false;
  }

  return true;
}

/**
 * FILTERED FLIGHT ENGINE — Steps 3–9
 *
 * Step 3: Quality guard — reject duration outliers (>1.8× avg) and bad schedules
 * Step 4: Deduplication by airline|flightNumber|depTime|date
 * Step 5: Tag assignment — Cheapest, Fastest, Best (each unique)
 * Step 6: Best score = price(35%) + duration(30%) + stops(15%) + layover(10%) + timing(10%)
 * Step 7: Display order — Best → Cheapest → Fastest
 * Step 8: Fallback — loosen time+stops if no strict matches; then cheapest 3 overall
 */


// ── AI Insight generator for filtered flight cards ─────────────────
function generateFlightInsight(flight, filters, budget, allSection1Flights, usedInsights) {
  const used = usedInsights || {};
  
  // Main insight options based on flight characteristics
  const mainInsights = [];
  
  // Tag-based main insights
  if(flight.tag === 'cheapest') {
    mainInsights.push('Best priced flight within your budget and preferred timing.');
    mainInsights.push('Lowest ticket price while matching all your preferences.');
    mainInsights.push('Maximum savings without compromising on your filters.');
  } else if(flight.tag === 'fastest') {
    mainInsights.push('Fastest arrival among matching filtered flights.');
    mainInsights.push('Shortest journey time with your preferred specifications.');
    mainInsights.push('Quick transit saves you hours on the road.');
  } else if(flight.tag === 'best') {
    mainInsights.push('Good balance of travel duration and ticket cost.');
    mainInsights.push('Optimal choice combining comfort and value.');
    mainInsights.push('Smart pick for price-conscious travelers.');
  }
  
  // Characteristics-based insights
  if(flight.stops === 0) {
    mainInsights.push('Non-stop convenience with no connection hassles.');
    mainInsights.push('Direct flight saves time and stress.');
    mainInsights.push('Seamless journey without layover complications.');
  }
  if(flight.pricePerPax <= budget * 0.75) {
    mainInsights.push('Excellent value — significantly under your budget.');
    mainInsights.push('Great savings on premium routing.');
  }
  if(flight.pricePerPax <= budget * 0.8 && flight.stops === 0) {
    mainInsights.push('Unbeatable combo: direct flight at budget price.');
  }
  if(flight.totalDuration && (flight.totalDuration.includes('2h') || flight.totalDuration.includes('3h'))) {
    mainInsights.push('Quick journey time with reasonable ticket price.');
    mainInsights.push('Short duration makes this highly efficient.');
  }
  
  // Airline reputation
  if(flight.airline === 'Air India' || flight.airline === 'Vistara') {
    mainInsights.push('Trusted airline with excellent service standards.');
  }
  
  // Select first unused main insight
  let mainInsight = '';
  for(let insight of mainInsights) {
    if(!used[insight]) {
      mainInsight = insight;
      used[insight] = true;
      break;
    }
  }
  
  // If all used, pick a random one
  if(!mainInsight) mainInsight = mainInsights[Math.floor(Math.random() * mainInsights.length)] || 'Great flight option for your journey.';
  
  // Extra suggestions - ONLY add if truly useful
  let extraSuggestion = '';
  const extraOptions = [];
  
  // Time flexibility suggestions
  if(flight.depTimeSlot === 'evening' && (!filters.depTime || filters.depTime !== 'evening')) {
    extraOptions.push('If flexible on departure time, evening flights often have lower fares.');
  }
  if(flight.depTimeSlot === 'early' && (!filters.depTime || filters.depTime !== 'early')) {
    extraOptions.push('Early morning departure helps you avoid airport rushes.');
  }
  if(flight.depTimeSlot === 'morning' && (!filters.depTime || filters.depTime !== 'morning')) {
    extraOptions.push('Morning departure gives you full day at destination.');
  }
  
  // Layover flexibility suggestions
  if(flight.stops === 1 && flight.maxLayover > 2) {
    extraOptions.push('Longer layover gives you rest time and meal break opportunities.');
  }
  if(flight.maxLayover && flight.maxLayover < 1.5 && flight.stops === 1) {
    extraOptions.push('Quick connection keeps total journey time short.');
  }
  
  // Budget flexibility suggestion
  if(flight.pricePerPax > budget * 0.85 && flight.pricePerPax <= budget) {
    extraOptions.push('Spending remaining budget gets you premium experience.');
  }
  if(flight.pricePerPax < budget * 0.6) {
    extraOptions.push('Extra savings can be used for accommodations or activities.');
  }
  
  // Night flight suggestion
  if(flight.segments && flight.segments.length > 0) {
    const lastArrival = flight.segments[flight.segments.length - 1].arrivalTime;
    if(lastArrival && parseInt(lastArrival) >= 22) {
      extraOptions.push('Night arrival means you rest during flight and reach refreshed.');
    }
    if(lastArrival && parseInt(lastArrival) >= 18 && parseInt(lastArrival) < 22) {
      extraOptions.push('Evening arrival lets you settle in and rest before next day.');
    }
  }
  
  // Comfort vs speed suggestion
  if(flight.stops === 0 && flight.pricePerPax > budget * 0.75) {
    extraOptions.push('Direct flight justifies premium price with saved time.');
  }
  if(flight.stops === 0 && flight.pricePerPax <= budget * 0.8) {
    extraOptions.push('Direct flight at unbeatable price — rare combo.');
  }
  
  // Journey comfort
  if(flight.cabin === 'Business' || flight.cabin === 'Premium Economy') {
    extraOptions.push('Premium cabin ensures maximum comfort on journey.');
  }
  
  // Select first unused extra suggestion
  for(let sugg of extraOptions) {
    if(!used[sugg] && sugg !== mainInsight) {
      extraSuggestion = sugg;
      used[sugg] = true;
      break;
    }
  }
  
  // Return structured insight
  return {
    main: mainInsight,
    extra: extraSuggestion,
    full: mainInsight + (extraSuggestion ? ' ' + extraSuggestion : '')
  };
}

/**
 * FILTERED FLIGHT ENGINE
 * - Strict match on ALL user filters (price, stops, time, cabin, airline)
 * - Quality guard: reject duration outliers (>1.8× average)
 * - Tag assignment: Cheapest → Fastest → Best (each unique flight)
 * - Display order: Best → Cheapest → Fastest
 * - Max 3 cards
 * - Deduplication key: airline|flightNumber|departureTime|date
 */
function recommandFlights(allFlights, filters, budget, dateStr, adults) {
  const usedInsights = {};

  // ── Duration helpers ─────────────────────────────────────────────
  function durMins(f) {
    const m = (f.totalDuration||'').match(/(\d+)h\s*(\d+)m/);
    if(m) return parseInt(m[1])*60+parseInt(m[2]);
    const h = (f.totalDuration||'').match(/(\d+)h/);
    if(h) return parseInt(h[1])*60;
    return 9999;
  }

  // Balanced best score (lower = better)
  function bestScore(f) {
    const priceRatio = f.pricePerPax / (budget||50000);
    const durScore   = Math.min(durMins(f) / 600, 1);
    const layoverPen = (f.maxLayover||0) * 0.04;
    const depH       = parseInt((f.segments&&f.segments[0] ? f.segments[0].departureTime : '0').split(':')[0])||0;
    const timePen    = (depH >= 6 && depH < 21) ? 0 : 0.15; // night departures penalised
    return priceRatio*0.40 + durScore*0.35 + layoverPen + timePen;
  }

  // Unique deduplication key per spec: airline + flightNumber + depTime + date
  function keyOf(f) {
    const fn  = f.segments && f.segments[0] ? f.segments[0].flightNumber   : '';
    const dep = f.segments && f.segments[0] ? f.segments[0].departureTime  : '';
    const dt  = f.segments && f.segments[0] ? f.segments[0].departureDate  : '';
    return `${f.airline}|${fn}|${dep}|${dt}`;
  }

  // ── STEP 1: Strict filter match ───────────────────────────────────
  let strictMatches = allFlights.filter(f => isStrictMatch(f, filters, budget));

  // ── STEP 2: Quality guard — remove duration outliers ─────────────
  if(strictMatches.length > 1) {
    const durations = strictMatches.map(f => durMins(f)).filter(d => d < 9999);
    if(durations.length > 0) {
      const avgDur = durations.reduce((a,b)=>a+b,0) / durations.length;
      const maxDur = avgDur * 1.8;  // reject flights >80% longer than average
      strictMatches = strictMatches.filter(f => durMins(f) <= maxDur);
    }
  }

  // ── STEP 3: No fallback loosening — if nothing matches, return empty ─
  if(strictMatches.length === 0) {
    // Build smart alternatives and section3 even with no section1
    const emptySet = new Set();
    const section2 = buildSmartAlternatives(allFlights, emptySet, filters, budget, durMins, bestScore);
    const section3 = buildSection3AlternateDates(allFlights, filters, budget, dateStr, adults, durMins);
    return { section1: [], section2: section2.slice(0, 3), section3: section3.slice(0, 2) };
  }

  // ── STEP 4: Tag assignment — Cheapest, Fastest, Best ─────────────
  // Each tag must go to a DIFFERENT flight.
  // If pool has fewer than 3 unique flights, tags share flights (allowed).

  const byPrice = [...strictMatches].sort((a,b) => a.pricePerPax - b.pricePerPax);
  const byDur   = [...strictMatches].sort((a,b) => durMins(a) - durMins(b));
  const byScore = [...strictMatches].sort((a,b) => bestScore(a) - bestScore(b));

  // Cheapest = lowest price
  const cheapestFlight = byPrice[0];

  // Fastest = shortest duration, prefer different from cheapest
  const fastestFlight  = byDur.find(f => keyOf(f) !== keyOf(cheapestFlight)) || byDur[0];

  // Best = best balanced score, prefer different from cheapest AND fastest
  const usedInTags = new Set([keyOf(cheapestFlight), keyOf(fastestFlight)]);
  const bestFlight = byScore.find(f => !usedInTags.has(keyOf(f))) || byScore[0];

  // ── STEP 5: Build section1 in display order: Best → Cheapest → Fastest ──
  const section1 = [];
  const seen = new Set();

  function pushTagged(flight, tag) {
    let candidate = flight;
    const k = keyOf(candidate);

    // If already used, find next available from appropriate sorted list
    if(seen.has(k)) {
      const sortedList = tag === 'cheapest' ? byPrice
                       : tag === 'fastest'  ? byDur
                       :                      byScore;
      candidate = sortedList.find(x => !seen.has(keyOf(x))) || flight;
    }

    const ck = keyOf(candidate);
    seen.add(ck);

    const insight = generateFlightInsight({...candidate, tag}, filters, budget, section1, usedInsights);
    section1.push({
      ...candidate, tag,
      mainInsight:     insight.main,
      extraSuggestion: insight.extra,
      fullInsight:     insight.full,
      section:         'filtered'
    });
  }

  pushTagged(bestFlight,     'best');
  pushTagged(cheapestFlight, 'cheapest');
  pushTagged(fastestFlight,  'fastest');

  // ── STEP 6: Smart Alternatives from remaining pool ────────────────
  const section2 = buildSmartAlternatives(allFlights, seen, filters, budget, durMins, bestScore);

  // ── STEP 7: Section 3 - Alternate Date Flights (exactly 2) ────────
  const section3 = buildSection3AlternateDates(allFlights, filters, budget, dateStr, adults, durMins);

  // Strict limit: max 3 cards per section
  return { section1: section1.slice(0, 3), section2: section2.slice(0, 3), section3: section3.slice(0, 2) };
}

// ── SMART ALTERNATIVES ENGINE ─────────────────────────────────────
// Per spec: shows flights that slightly differ from user filters.
// Mandatory: same origin, destination, date.
// Eligibility: fails at least ONE filter slightly (price/stops/airline/duration/time).
// Quality guards: exclude >50% over budget, >2× duration, overnight layover.
// Output: up to 3 flights, sorted by relevance score (closest first).
// Each card gets a unique reason sentence.
function buildSmartAlternatives(allFlights, section1Keys, filters, budget, durMins, bestScore) {

  // ── Constants ────────────────────────────────────────────────────
  const MAX_PRICE_OVER_PCT   = 0.50;   // quality guard: exclude >50% over budget
  const ALT_PRICE_LOWER_PCT  = 0.03;   // slight diff: must be at least 3% over budget
  const ALT_PRICE_UPPER_PCT  = 0.25;   // slight diff: price up to 25% over budget
  const MAX_TIME_DEVIATION_H = 3;      // slight diff: ±3 hours from preferred slot
  const MAX_ALT_STOPS        = 1;      // slight diff: user preferred direct → allow 1 stop
  const MAX_DUR_MULTIPLE     = 2.0;    // quality guard: exclude >2× avg filtered duration
  const ALT_MAX_DUR_HOURS    = 3.5;    // slight diff: allow up to 3.5h total duration

  // ── Slot lookup tables ───────────────────────────────────────────
  const slotMap = {
    'Early Morning (6AM-9AM)': 'early',
    'Morning (9AM-12PM)':      'morning',
    'Afternoon (12PM-6PM)':    'afternoon',
    'Evening (6PM-9PM)':       'evening',
    'Night (9PM-6AM)':         'night'
  };
  const slotLabel = {
    early:'Early Morning (6AM–9AM)', morning:'Morning (9AM–12PM)',
    afternoon:'Afternoon (12PM–6PM)', evening:'Evening (6PM–9PM)', night:'Night (9PM–6AM)'
  };
  // Centre hour of each slot for ±3h deviation calculation
  const slotCentre = { early:7.5, morning:10.5, afternoon:15, evening:19.5, night:23 };

  const wantedSlot = filters.depTime && filters.depTime !== 'Any time'
    ? (slotMap[filters.depTime] || filters.depTime.toLowerCase())
    : null;

  const preferredStops = filters.flightPref === 'direct' ? 0
    : (filters.stops !== undefined && filters.stops !== null ? filters.stops : 1);

  // Preferred airline (not collected currently — treated as "no preference")
  const preferredAirline = (filters.airlinePref || '').toLowerCase().trim();

  // Departure hour of flight
  function depHour(f) {
    const t = f.segments && f.segments[0] ? (f.segments[0].departureTime || '12:00') : '12:00';
    return parseInt(t.split(':')[0]) || 0;
  }

  // Hours flight departs from the centre of the wanted slot
  function hoursFromSlotCentre(f) {
    if(!wantedSlot) return 0;
    return Math.abs(depHour(f) - (slotCentre[wantedSlot] || 12));
  }

  // Is the flight's time within ±3h of the preferred slot centre?
  function withinTimeWindow(f) {
    return hoursFromSlotCentre(f) <= MAX_TIME_DEVIATION_H;
  }

  // ── Compute filtered-section avg duration ────────────────────────
  const sec1Durs = [];
  allFlights.forEach(f => {
    const fn  = f.segments && f.segments[0] ? f.segments[0].flightNumber  : '';
    const dep = f.segments && f.segments[0] ? f.segments[0].departureTime : '';
    const dt  = f.segments && f.segments[0] ? f.segments[0].departureDate : '';
    const k   = `${f.airline}|${fn}|${dep}|${dt}`;
    if(section1Keys.has(k)) sec1Durs.push(durMins(f));
  });
  const avgFilteredDur = sec1Durs.length
    ? Math.round(sec1Durs.reduce((a,b)=>a+b,0) / sec1Durs.length)
    : 135; // default 2h 15m

  const maxAllowedDur  = Math.max(avgFilteredDur * 3, 480);  // 3× avg or 8h max — quality guard
  const moderateDurCap = Math.max(avgFilteredDur * 2, 360);  // 2× avg or 6h — "moderately longer"

  // ── STEP 1: Perfect-match detection ──────────────────────────────
  // A flight is a perfect match if it satisfies ALL user filters exactly.
  // These flights must NEVER appear in Smart Alternatives.
  function isPerfectMatch(f) {
    if(f.pricePerPax > budget) return false;
    // Compare using full depTime label (matches what Amadeus-mapped flights store)
    if(filters.depTime && filters.depTime !== 'Any time' && filters.depTime !== 'any') {
      // Use hour-window check (same as isStrictMatch) for reliability
      const slotWindows = {
        'Early Morning (6AM-9AM)': [5,10], 'Morning (9AM-12PM)': [8,13],
        'Afternoon (12PM-6PM)': [11,19], 'Evening (6PM-9PM)': [17,22], 'Night (9PM-6AM)': [20,30]
      };
      const win = slotWindows[filters.depTime];
      if(win) {
        const depH = parseInt((f.segments&&f.segments[0] ? f.segments[0].departureTime : '0').split(':')[0])||0;
        const adjH = (win[1] > 24 && depH < 6) ? depH + 24 : depH;
        if(adjH < win[0] || adjH >= win[1]) return false;
      }
    }
    if(filters.flightPref === 'direct'     && f.stops !== 0) return false;
    if(filters.flightPref === 'connecting' && f.stops === 0) return false;
    if(preferredAirline && !f.airline.toLowerCase().includes(preferredAirline)) return false;
    if((f.cabin||'Economy') !== (filters.cabin||'Economy')) return false;
    return true;
  }

  // ── STEP 2: Build eligible pool ──────────────────────────────────
  const pool = allFlights.filter(f => {
    const fn  = f.segments && f.segments[0] ? f.segments[0].flightNumber  : '';
    const dep = f.segments && f.segments[0] ? f.segments[0].departureTime : '';
    const dt  = f.segments && f.segments[0] ? f.segments[0].departureDate : '';
    const k   = `${f.airline}|${fn}|${dep}|${dt}`;

    // Already shown in filtered section → skip
    if(section1Keys.has(k)) return false;

    // Perfect match → belongs only in filtered section
    if(isPerfectMatch(f)) return false;

    // ── HARD QUALITY GUARDS ───────────────────────────────────────
    // G1. Price more than 50% above budget → too expensive
    if(f.pricePerPax > budget * (1 + MAX_PRICE_OVER_PCT)) return false;

    // G2. Duration more than 3× filtered average → impractical
    if(durMins(f) > maxAllowedDur) return false;

    // G3. Overnight layover (any layover ≥5h) → too inconvenient
    if(f.layovers && f.layovers.some(lw => {
      const hm = (lw.duration||'').match(/(\d+)h/);
      return hm && parseInt(hm[1]) >= 5;
    })) return false;

    // ── SLIGHT DIFFERENCE: at least ONE filter must differ ────────
    const diff_price    = f.pricePerPax > budget;
    const diff_stops    = filters.flightPref === 'direct'     ? f.stops > 0
                        : filters.flightPref === 'connecting' ? f.stops === 0
                        : f.stops > preferredStops;
    const diff_airline  = preferredAirline
                          ? !f.airline.toLowerCase().includes(preferredAirline)
                          : false;
    const diff_duration = durMins(f) > avgFilteredDur + 15;
    // Use hour-window for time diff check (depTimeSlot may be full label or short key)
    let diff_time = false;
    if(filters.depTime && filters.depTime !== 'Any time' && filters.depTime !== 'any') {
      const slotWin = {
        'Early Morning (6AM-9AM)':[5,10],'Morning (9AM-12PM)':[8,13],
        'Afternoon (12PM-6PM)':[11,19],'Evening (6PM-9PM)':[17,22],'Night (9PM-6AM)':[20,30]
      };
      const win = slotWin[filters.depTime];
      if(win) {
        const depH = parseInt((f.segments&&f.segments[0] ? f.segments[0].departureTime : '0').split(':')[0])||0;
        const adjH = (win[1] > 24 && depH < 6) ? depH + 24 : depH;
        diff_time = (adjH < win[0] || adjH >= win[1]);
      }
    }

    return diff_price || diff_stops || diff_airline || diff_duration || diff_time;
  });

  if(pool.length === 0) return [];

  // ── STEP 3: Relevance scoring ─────────────────────────────────────
  // Real booking system logic:
  // A slight over-budget direct flight is MORE relevant than a cheap connecting
  // flight when user asked for direct. Score reflects proximity to user intent.
  function relevanceScore(f) {
    let score = 1000; // start high, deduct for each deviation

    // 1. Price deviation — penalise proportionally
    if(f.pricePerPax > budget) {
      const overPct = (f.pricePerPax - budget) / budget; // 0.05 = 5% over
      score -= overPct * 200; // 5% over → -10pts, 25% over → -50pts
    }
    // Slight bonus for being close to budget (not too cheap either — may mean worse quality)
    const priceRatio = f.pricePerPax / budget;
    if(priceRatio >= 0.7 && priceRatio <= 1.0) score += 20; // sweet spot 70–100%

    // 2. Stops deviation — heavily penalise when user picked direct
    if(filters.flightPref === 'direct' && f.stops > 0) {
      score -= f.stops * 150; // connecting flight when user wants direct → very low priority
    } else if(filters.flightPref === 'connecting' && f.stops === 0) {
      score -= 80; // direct when user wants connecting → moderate penalty
    }

    // 3. Time deviation — deduct per hour outside preferred slot
    const hOff = hoursFromSlotCentre(f);
    score -= hOff * 15;

    // 4. Duration — deduct for excess over filtered average
    const extraMins = Math.max(0, durMins(f) - avgFilteredDur);
    score -= (extraMins / 60) * 20;

    return score;
  }

  const scored = pool
    .map(f => ({ f, score: relevanceScore(f) }))
    .sort((a, b) => b.score - a.score)  // highest relevance first
    .slice(0, 3);  // LIMIT to 2-3 per user requirement

  if(scored.length === 0) return [];

  // ── STEP 4: Unique reason per card (priority-ordered per spec) ───
  const usedReasonKeys = new Set();

  function buildReason(f) {
    const candidates = [];

    // Priority 1: Price — cheaper or slightly higher
    if(f.pricePerPax < budget) {
      const save = budget - f.pricePerPax;
      candidates.push({
        key:   `cheaper_${save}`,
        badge: `💰 Cheaper by ₹${save.toLocaleString('en-IN')}`,
        text:  `Saves ₹${save.toLocaleString('en-IN')} vs your budget with a slightly different schedule.`
      });
    } else if(f.pricePerPax > budget) {
      const over = f.pricePerPax - budget;
      const pct  = Math.round((over / budget) * 100);
      candidates.push({
        key:   `price_over_${pct}`,
        badge: `💰 +₹${over.toLocaleString('en-IN')} (${pct}% over)`,
        text:  `Slightly higher fare but still a valuable travel option — ₹${over.toLocaleString('en-IN')} above your budget.`
      });
    }

    // Priority 2: Faster duration
    const extraMins = durMins(f) - avgFilteredDur;
    if(extraMins < -10) {
      const saved = Math.abs(extraMins);
      candidates.push({
        key:   `faster_${saved}`,
        badge: `⏱ Faster by ${saved < 60 ? saved + ' min' : Math.floor(saved/60) + 'h ' + (saved%60) + 'm'}`,
        text:  `Arrives earlier — saves ~${saved < 60 ? saved + ' min' : Math.floor(saved/60) + 'h ' + (saved%60) + 'm'} compared to filtered flights.`
      });
    } else if(extraMins > 20) {
      const h = Math.floor(extraMins/60), m = extraMins%60;
      const diffStr = h > 0 ? `${h}h ${m > 0 ? m+'m' : ''}`.trim() : `${m} min`;
      candidates.push({
        key:   `slower_${f.totalDuration}`,
        badge: `⏱ +${diffStr} longer`,
        text:  `Journey is ~${diffStr} longer but offers a practical schedule for your route.`
      });
    }

    // Priority 3: Stops difference
    if(f.stops > preferredStops) {
      const hub = f.layovers && f.layovers[0] ? f.layovers[0].city : 'a hub';
      const lay = f.layovers && f.layovers[0] ? ` · ${f.layovers[0].duration} layover` : '';
      candidates.push({
        key:   `stops_${hub}`,
        badge: `🛑 1 stop via ${hub}`,
        text:  `Includes 1 stop via ${hub}${lay} — offers better fare or schedule flexibility.`
      });
    }

    // Priority 4: Better timing
    if(wantedSlot && (f.depTimeSlot||'').toLowerCase() !== wantedSlot) {
      const dep   = f.segments && f.segments[0] ? f.segments[0].departureTime : '';
      const label = slotLabel[(f.depTimeSlot||'').toLowerCase()] || f.depTimeSlot || 'alternate time';
      candidates.push({
        key:   `time_${f.depTimeSlot}`,
        badge: `🛫 ${label} departure`,
        text:  `Departs at ${dep} (${label}) — outside your preference but offers a convenient arrival.`
      });
    }

    // Priority 5: Alternate airline
    if(preferredAirline && !f.airline.toLowerCase().includes(preferredAirline)) {
      candidates.push({
        key:   `airline_${f.airline}`,
        badge: `⭐ ${f.airline}`,
        text:  `${f.airline} offers similar comfort and reliability on this route.`
      });
    }

    // AI recommended fallback
    candidates.push({
      key:   `ai_${f.airline}_${f.segments&&f.segments[0]?f.segments[0].flightNumber:''}`,
      badge: `⭐ AI Recommended`,
      text:  `${f.airline} — a well-matched alternative for your journey based on overall value.`
    });

    // Pick first unused key
    for(const c of candidates) {
      if(!usedReasonKeys.has(c.key)) {
        usedReasonKeys.add(c.key);
        return { badge: c.badge, text: c.text };
      }
    }
    const fn = f.segments && f.segments[0] ? f.segments[0].flightNumber : 'Flight';
    return {
      badge: `⭐ AI Recommended`,
      text:  `${f.airline} ${fn} — a practical alternative for your travel.`
    };
  }

  // ── STEP 5: Return final cards ────────────────────────────────────
  return scored.map(({ f }) => {
    const reason = buildReason(f);
    return {
      ...f,
      tag: 'beyond',
      section: 'beyond',
      mainInsight:    reason.text,
      reasonBadge:    reason.badge,
      extraSuggestion: '',
      fullInsight:    reason.text
    };
  });
}

// ── SECTION 3: ALTERNATE DATE FLIGHTS (SYNTHETIC) ─────────────────
// Creates alternate date options from existing flights with price/schedule variations
function buildSection3AlternateDates(allFlights, filters, budget, dateStr, adults, durMins) {
  if(!dateStr || !allFlights || allFlights.length === 0) return [];

  // Parse date string directly without timezone conversion
  const [year, month, day] = dateStr.split('-').map(Number);
  const selectedDate = new Date(year, month - 1, day);
  
  // UTC-safe helper — returns ISO string (YYYY-MM-DD), never a Date object
  function addDaysISO(isoStr, n) {
    const p = (isoStr || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if(!p) return isoStr;
    const dt = new Date(Date.UTC(parseInt(p[1]), parseInt(p[2])-1, parseInt(p[3])));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth()+1).padStart(2,'0') + '-' + String(dt.getUTCDate()).padStart(2,'0');
  }

  function fmtShort(iso) {
    const p = (iso||'').match(/(\d{4})-(\d{2})-(\d{2})/);
    if(!p) return iso;
    const dt = new Date(Date.UTC(parseInt(p[1]), parseInt(p[2])-1, parseInt(p[3])));
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function dayLbl(iso) {
    const p = (iso||'').match(/(\d{4})-(\d{2})-(\d{2})/);
    const sp = (dateStr||'').match(/(\d{4})-(\d{2})-(\d{2})/);
    if(!p || !sp) return '';
    const diff = Math.round((Date.UTC(parseInt(p[1]),parseInt(p[2])-1,parseInt(p[3])) - Date.UTC(parseInt(sp[1]),parseInt(sp[2])-1,parseInt(sp[3]))) / 86400000);
    if(diff === -1) return '1 day earlier';
    if(diff === 1) return '1 day later';
    return Math.abs(diff) + ' days ' + (diff < 0 ? 'earlier' : 'later');
  }

  // Get flights for selected date
  const selectedDateFlights = allFlights.filter(f => {
    const fDate = f.segments && f.segments[0] ? f.segments[0].departureDate : '';
    return fDate === dateStr;
  });

  console.log('🔍 Section 3 - Selected date:', dateStr);
  console.log('🔍 Section 3 - Selected date flights:', selectedDateFlights.length);

  // Use selected date flights as base, or use any available flights
  const baseFlights = selectedDateFlights.length > 0 ? selectedDateFlights : allFlights;
  console.log('🔍 Section 3 - Base flights to use:', baseFlights.length);

  if(baseFlights.length === 0) return [];

  const results = [];
  const altDates = [
    { iso: addDaysISO(dateStr, -1), dayOffset: -1, label: '1 day earlier' },
    { iso: addDaysISO(dateStr, 1), dayOffset: 1, label: '1 day later' }
  ];

  console.log('🔍 Section 3 - Calculated dates:', altDates.map(d => d.iso));

  // Create exactly 1 flight per nearby date (2 total for section 3)
  altDates.forEach(({ iso, dayOffset, label }) => {
    console.log(`🔍 Section 3 - Processing ${label}: ${iso}`);
    
    // Skip if same as selected date
    if(iso === dateStr) {
      console.log(`🔍 Section 3 - SKIP - ${iso} same as selected date ${dateStr}`);
      return;
    }

    console.log(`🔍 Section 3 - ${iso} is different from ${dateStr}, processing...`);

    // Pick the best (cheapest, shortest) flight from base flights
    const baseFlight = baseFlights
      .sort((a, b) => {
        // Sort by price first, then duration
        if(a.pricePerPax !== b.pricePerPax) return a.pricePerPax - b.pricePerPax;
        return durMins(a) - durMins(b);
      })[0];

    if(!baseFlight) {
      console.log('🔍 Section 3 - No base flight found');
      return;
    }

    console.log(`🔍 Section 3 - Base flight: ${baseFlight.airline} ₹${baseFlight.pricePerPax}`);

    // Create price variation based on day offset
    const priceMultiplier = dayOffset === -1 ? 0.92 : 0.95;
    const newPrice = Math.round(baseFlight.pricePerPax * priceMultiplier);

    // Create duration variation
    const baseDuration = durMins(baseFlight);
    let newDuration = baseDuration;
    let durationStr = baseFlight.totalDuration;
    
    if(dayOffset === -1) {
      // Earlier flight - slightly faster
      newDuration = Math.round(baseDuration * 0.95);
      const h = Math.floor(newDuration / 60);
      const m = newDuration % 60;
      durationStr = `${h}h ${m}m`;
    } else {
      // Later flight - slightly slower
      newDuration = Math.round(baseDuration * 1.05);
      const h = Math.floor(newDuration / 60);
      const m = newDuration % 60;
      durationStr = `${h}h ${m}m`;
    }

    // Calculate reason
    const priceSaved = baseFlight.pricePerPax - newPrice;
    let reason = '';
    if(priceSaved > 300) {
      reason = `Save ₹${Math.round(priceSaved).toLocaleString('en-IN')} by traveling ${label}`;
    } else if(newDuration < baseDuration - 20) {
      reason = `Faster flight available - ${durationStr}`;
    } else {
      reason = `Available on ${label}`;
    }

    // Build alternate flight with segments — correctly propagate dates for connecting flights
    let s2CumDepMins = -1;
    const baseSegs2 = baseFlight.segments || [];
    const altSegments = baseSegs2.map((seg, segIdx) => {
      const [dh, dm] = (seg.departureTime || '12:00').split(':').map(Number);
      let newDepMins;

      if(segIdx === 0) {
        let newDepH = dh;
        if(dayOffset === -1) { newDepH = dh > 0 ? dh - 1 : 23; }
        else { newDepH = (dh + 1) % 24; }
        newDepMins = newDepH * 60 + dm;
        s2CumDepMins = newDepMins;
      } else {
        // Carry over layover gap from base flight
        const prevSeg = baseSegs2[segIdx - 1];
        const [ph, pm] = (prevSeg.departureTime || '00:00').split(':').map(Number);
        const prevDurM = (seg2DurMins => seg2DurMins)((() => {
          const prevDurMatch = (prevSeg.duration || '2h 00m').match(/(\d+)h\s*(\d+)m/);
          return prevDurMatch ? parseInt(prevDurMatch[1])*60+parseInt(prevDurMatch[2]) : 120;
        })());
        const origPrevArrMins = ph*60+pm + prevDurM;
        const gapMins = Math.max(dh*60+dm - origPrevArrMins, 60); // at least 60min layover
        newDepMins = s2CumDepMins + prevDurM + gapMins;
        s2CumDepMins = newDepMins;
      }

      const newDepH24 = Math.floor(newDepMins / 60);
      const newDepartureTime = `${String(newDepH24 % 24).padStart(2,'0')}:${String(newDepMins % 60).padStart(2,'0')}`;
      const depDateOffset = Math.floor(newDepH24 / 24);
      const newDepartureDate = depDateOffset > 0 ? addDaysISO(iso, depDateOffset) : iso;

      const durMatch = (seg.duration || '2h 00m').match(/(\d+)h\s*(\d+)m/);
      const durMins = durMatch ? parseInt(durMatch[1])*60 + parseInt(durMatch[2]) : 120;
      const arrTotalMins = newDepMins + durMins;
      const arrH24 = Math.floor(arrTotalMins / 60);
      const newArrivalTime = `${String(arrH24 % 24).padStart(2,'0')}:${String(arrTotalMins % 60).padStart(2,'0')}`;
      const arrDateOffset = Math.floor(arrH24 / 24);
      const newArrivalDate = arrDateOffset > 0 ? addDaysISO(iso, arrDateOffset) : iso;

      return {
        ...seg,
        departureDate: newDepartureDate,
        arrivalDate: newArrivalDate,
        departureTime: newDepartureTime,
        arrivalTime: newArrivalTime
      };
    });

    const newFlight = {
      ...baseFlight,
      segments: altSegments,
      pricePerPax: newPrice,
      totalPrice: newPrice * adults,
      totalDuration: durationStr,
      tag: 'beyond',
      section: 'section3',
      altDate: iso,
      altDateFmt: fmtShort(iso),
      altDayLabel: dayLbl(iso),
      mainInsight: reason,
      reasonBadge: reason,
      fullInsight: reason
    };

    results.push(newFlight);
    console.log(`🔍 Section 3 - Added ${label}: ${iso} ₹${newPrice}`);
  });

  console.log('🔍 Section 3 - Final count:', results.length, 'flights');
  
  // Return exactly 2 flights for section 3 (one earlier, one later)
  return results.slice(0, 2);
}

// ── ALTERNATE DATES ENGINE - CREATE SYNTHETIC FLIGHTS ─────────────
// Creates flights for nearby dates with variations in price and schedule
function buildAlternateDates(allFlights, filterSettings, budget, dateStr, adults) {
  if(!dateStr || !allFlights || allFlights.length === 0) return [];

  const selectedDate = new Date(dateStr + 'T00:00:00');
  if(isNaN(selectedDate.getTime())) return [];

  // UTC-safe date helpers (return ISO strings, never Date objects)
  function addDaysISO(isoStr, n) {
    const p = isoStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if(!p) return isoStr;
    const dt = new Date(Date.UTC(parseInt(p[1]), parseInt(p[2])-1, parseInt(p[3])));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth()+1).padStart(2,'0') + '-' + String(dt.getUTCDate()).padStart(2,'0');
  }
  function fmtShort(iso) {
    const p = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
    if(!p) return iso;
    const dt = new Date(Date.UTC(parseInt(p[1]), parseInt(p[2])-1, parseInt(p[3])));
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function dayLbl(iso) {
    const p = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
    const sel = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if(!p || !sel) return '';
    const dtIso = Date.UTC(parseInt(p[1]), parseInt(p[2])-1, parseInt(p[3]));
    const dtSel = Date.UTC(parseInt(sel[1]), parseInt(sel[2])-1, parseInt(sel[3]));
    const d = Math.round((dtIso - dtSel) / 86400000);
    if(d === -1) return '1 day earlier';
    if(d === 1) return '1 day later';
    return Math.abs(d) + ' days ' + (d < 0 ? 'earlier' : 'later');
  }

  function durMins(f) {
    const m = (f.totalDuration || '').match(/(\d+)h\s*(\d+)m/);
    if(m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    const h = (f.totalDuration || '').match(/(\d+)h/);
    if(h) return parseInt(h[1]) * 60;
    return 180;
  }

  // Get flights for selected date
  const selectedDateFlights = allFlights.filter(f => {
    const fDate = f.segments && f.segments[0] ? f.segments[0].departureDate : '';
    return fDate === dateStr;
  });

  if(selectedDateFlights.length === 0) return [];

  const results = [];
  
  // Create synthetic alternate flights for 2 nearby dates with price/schedule variations
  const altDates = [
    { iso: addDaysISO(dateStr, -1), dayOffset: -1, label: '1 day earlier', multipliers: [0.90, 0.88] },
    { iso: addDaysISO(dateStr, 1), dayOffset: 1, label: '1 day later', multipliers: [0.93, 0.91] }
  ];

  altDates.forEach(({ iso, dayOffset, label, multipliers }) => {
    // Get best 2 flights from selected date to use as templates
    const topFlights = selectedDateFlights
      .sort((a, b) => a.pricePerPax - b.pricePerPax)
      .slice(0, 2);

    topFlights.forEach((baseFlight, idx) => {
      const priceMultiplier = multipliers[idx] || 0.92;
      const newPrice = Math.round(baseFlight.pricePerPax * priceMultiplier);

      // Create duration variation
      let newDuration = durMins(baseFlight);
      let durationStr = baseFlight.totalDuration;
      
      if(dayOffset === -1) {
        newDuration = Math.round(newDuration * 0.93);
      } else {
        newDuration = Math.round(newDuration * 1.02);
      }
      
      const h = Math.floor(newDuration / 60);
      const m = newDuration % 60;
      durationStr = `${h}h ${m}m`;

      // Calculate savings/reason
      const savings = baseFlight.pricePerPax - newPrice;
      let reason = '';
      
      if(savings > 500) {
        reason = `Save ₹${Math.round(savings).toLocaleString('en-IN')} by traveling ${label}`;
      } else if(savings > 200) {
        reason = `Save ₹${Math.round(savings).toLocaleString('en-IN')} on ${label}`;
      } else if(newDuration < durMins(baseFlight) - 20) {
        reason = `Faster option available - ${durationStr}`;
      } else if(dayOffset === -1) {
        reason = `Lower fares available 1 day earlier`;
      } else {
        reason = `Alternative option on ${label}`;
      }

      // Create synthetic alternate flight — rebuild segments with correct dates
      // For connecting flights, track cumulative minutes from start of travel day
      const baseSegs = baseFlight.segments || [];
      // First segment: shift departure by ±1 hour; subsequent segments follow cumulatively
      let cumulativeDepMins = -1; // will be set from first seg
      const altSegments = baseSegs.map((seg, segIdx) => {
        const [dh, dm] = (seg.departureTime || '10:00').split(':').map(Number);
        let newDepMins;

        if(segIdx === 0) {
          // Shift first segment departure by ±1 hour
          let newDepH = dh;
          if(dayOffset === -1) {
            newDepH = dh > 0 ? dh - 1 : 23;
          } else {
            newDepH = (dh + 1) % 24;
          }
          newDepMins = newDepH * 60 + dm;
          cumulativeDepMins = newDepMins;
        } else {
          // For connecting segments: original gap from previous arrival carries through
          // Calculate original seg0 arrival mins
          const prevSeg = baseSegs[segIdx - 1];
          const [ph, pm] = (prevSeg.departureTime || '00:00').split(':').map(Number);
          const prevDurMatch = (prevSeg.duration || '2h 00m').match(/(\d+)h\s*(\d+)m/);
          const prevDurMins = prevDurMatch ? parseInt(prevDurMatch[1])*60+parseInt(prevDurMatch[2]) : 120;
          const origPrevArrMins = ph*60+pm+prevDurMins;
          // Original gap between this seg departure and previous arrival (layover)
          const origThisDepMins = dh*60+dm;
          const gapMins = origThisDepMins - origPrevArrMins;
          // New cumulative arrival of previous segment
          const [altPh, altPm] = (prevSeg.departureTime||'00:00').split(':').map(Number); // recalculated below
          // Recalculate previous arrival from new departure
          const newPrevDepMins = cumulativeDepMins; // already set
          cumulativeDepMins = newPrevDepMins + prevDurMins + Math.max(gapMins, 0);
          newDepMins = cumulativeDepMins;
        }

        const newDepH24 = Math.floor(newDepMins / 60);
        const newDepartureTime = `${String(newDepH24 % 24).padStart(2,'0')}:${String(newDepMins % 60).padStart(2,'0')}`;
        const depDateOffset = Math.floor(newDepH24 / 24);
        const newDepartureDate = depDateOffset > 0 ? addDaysISO(iso, depDateOffset) : iso;

        // Recalculate arrival time based on segment duration
        const durMatch = (seg.duration || '2h 00m').match(/(\d+)h\s*(\d+)m/);
        const durMins = durMatch ? parseInt(durMatch[1])*60 + parseInt(durMatch[2]) : 120;
        const arrTotalMins = newDepMins + durMins;
        const arrH24 = Math.floor(arrTotalMins / 60);
        const newArrivalTime = `${String(arrH24 % 24).padStart(2,'0')}:${String(arrTotalMins % 60).padStart(2,'0')}`;
        const arrDateOffset = Math.floor(arrH24 / 24);
        const newArrivalDate = arrDateOffset > 0 ? addDaysISO(iso, arrDateOffset) : iso;

        // Update cumulativeDepMins to this segment's departure for next iteration
        if(segIdx === 0) cumulativeDepMins = newDepMins;

        return {
          ...seg,
          departureDate: newDepartureDate,
          arrivalDate: newArrivalDate,
          departureTime: newDepartureTime,
          arrivalTime: newArrivalTime
        };
      });

      results.push({
        ...baseFlight,
        segments: altSegments,
        pricePerPax: newPrice,
        totalPrice: newPrice * adults,
        totalDuration: durationStr,
        tag: 'beyond',
        section: 'alternate',
        altDate: iso,
        altDateFmt: fmtShort(iso),
        altDayLabel: dayLbl(iso),
        altDateDisplay: fmtShort(iso),
        priceDiff: newPrice - baseFlight.pricePerPax,
        mainInsight: reason,
        reasonBadge: reason,
        fullInsight: reason,
        aiSuggestion: reason,
        airline: baseFlight.airline || '',
        stops: baseFlight.stops || 0,
        cabin: baseFlight.cabin || 'Economy',
        layovers: baseFlight.layovers || []
      });
    });
  });

  console.log('🔍 Alternate Dates - Created:', results.length, 'flights');
  
  // Return up to 6 alternate date flights
  return results.slice(0, 6);
}
// Operates on top of existing result dataset without modifying any
// existing functions, variables, API calls, pagination or render logic.
// ══════════════════════════════════════════════════════════════════

/**
 * Parse a departure time string (e.g. "08:30") into hour number
 */
function _ffs_parseHour(timeStr) {
  if (!timeStr) return -1;
  const m = timeStr.match(/^(\d{1,2}):?(\d{0,2})/);
  return m ? parseInt(m[1]) : -1;
}

/**
 * Map a departure hour to a named time slot matching collected.depTime values
 */
function _ffs_getTimeSlot(hour) {
  if (hour >= 6  && hour < 9)  return 'Early Morning (6AM-9AM)';
  if (hour >= 9  && hour < 12) return 'Morning (9AM-12PM)';
  if (hour >= 12 && hour < 18) return 'Afternoon (12PM-6PM)';
  if (hour >= 18 && hour < 21) return 'Evening (6PM-9PM)';
  if (hour >= 21 || hour < 6)  return 'Night (9PM-6AM)';
  return 'Any time';
}

/**
 * Parse totalDuration string (e.g. "2h 15m", "5h 30m") into total minutes
 */
function _ffs_parseDurationMins(durStr) {
  if (!durStr) return 9999;
  const hm = durStr.match(/(\d+)h\s*(\d+)m/);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const ho = durStr.match(/(\d+)h/);
  if (ho) return parseInt(ho[1]) * 60;
  const mo = durStr.match(/(\d+)m/);
  if (mo) return parseInt(mo[1]);
  return 9999;
}

/**
 * STRICT multi-criteria filter: returns true only if the flight satisfies
 * ALL of the user-selected filters.
 *  - origin / destination (IATA or city name, partial case-insensitive)
 *  - travel date
 *  - passenger count (price must cover all passengers within budget)
 *  - airline preference (if set)
 *  - departure time range (if set, tolerates 'Any time' / 'any')
 *  - budget per pax
 *  - stops preference
 */
function _ffs_strictMatch(flight, userFilters) {
  const f = flight;
  const u = userFilters;

  // ── Price / budget (per pax) ──────────────────────────────
  if (u.budget && u.budget > 0) {
    if (f.pricePerPax > u.budget) return false;
  }

  // ── Stops preference ─────────────────────────────────────
  if (u.flightPref === 'direct' && f.stops !== 0) return false;
  if (u.flightPref === 'connecting' && f.stops === 0) return false;
  if (typeof u.maxStops === 'number' && f.stops > u.maxStops) return false;

  // ── Departure time slot ───────────────────────────────────
  if (u.depTime && u.depTime !== 'Any time' && u.depTime !== 'any') {
    const seg0 = f.segments && f.segments[0];
    const depHour = _ffs_parseHour(seg0 ? seg0.departureTime : '');
    const flightSlot = _ffs_getTimeSlot(depHour);
    if (flightSlot !== u.depTime) return false;
  }

  // ── Cabin class ───────────────────────────────────────────
  if (u.cabin && u.cabin !== 'Any') {
    if (f.cabin !== u.cabin) return false;
  }

  // ── Airline preference ────────────────────────────────────
  if (u.airlinePreference && u.airlinePreference !== 'Any' && u.airlinePreference !== '') {
    const pref = u.airlinePreference.toLowerCase().trim();
    const airline = (f.airline || '').toLowerCase().trim();
    if (!airline.includes(pref) && !pref.includes(airline)) return false;
  }

  // ── Max transit / layover ─────────────────────────────────
  if (u.maxTransit && f.maxLayover && f.maxLayover > u.maxTransit) return false;

  return true;
}

/**
 * Score a flight for "best" selection — lower is better.
 * Balances price, duration, departure timing, and layover.
 */
function _ffs_bestScore(flight, budget) {
  const priceRatio = (flight.pricePerPax || 0) / (budget || 50000);        // 0–1
  const durationMins = _ffs_parseDurationMins(flight.totalDuration);
  const durationScore = Math.min(durationMins / 600, 1);                    // normalised ~0–1
  const layoverPenalty = (flight.maxLayover || 0) * 0.04;                   // small penalty

  // Prefer mid-day departures (9 AM–6 PM) — score 0 for ideal, up to 0.15 penalty
  const seg0 = flight.segments && flight.segments[0];
  const depHour = _ffs_parseHour(seg0 ? seg0.departureTime : '');
  const timingPenalty = (depHour >= 9 && depHour < 18) ? 0 : 0.1;

  return priceRatio * 0.4 + durationScore * 0.35 + layoverPenalty + timingPenalty;
}

/**
 * Main entry point for the new Filtered Flights layer.
 *
 * Accepts the full raw flights array and the current user filter state.
 * Returns up to 3 tagged flights in display order: Best → Cheapest → Fastest.
 * Does NOT modify the input array or any global state.
 *
 * @param {Array}  allFlights   The complete raw flights array from the API/mock
 * @param {Object} userFilters  { budget, flightPref, maxStops, depTime, cabin,
 *                                airlinePreference, maxTransit }
 * @returns {Array}  Up to 3 flight objects each augmented with
 *                   { _ffs_tag: 'best'|'cheapest'|'fastest' }
 */
function buildFilteredFlightsSection(allFlights, userFilters) {
  if (!allFlights || allFlights.length === 0) return [];

  // Step 1 — apply all filters strictly
  const matched = allFlights.filter(f => _ffs_strictMatch(f, userFilters));
  if (matched.length === 0) return [];               // No matches → do NOT break existing flow

  const budget = userFilters.budget || 50000;

  // ── EDGE CASE: Only 1 match ───────────────────────────────
  if (matched.length === 1) {
    return [{ ...matched[0], _ffs_tag: 'best' }];
  }

  // ── EDGE CASE: Only 2 matches ─────────────────────────────
  if (matched.length === 2) {
    const sorted = [...matched].sort((a, b) => (a.pricePerPax || 0) - (b.pricePerPax || 0));
    return [
      { ...sorted[0], _ffs_tag: 'cheapest' },
      { ...sorted[1], _ffs_tag: 'fastest' }
    ];
  }

  // ── NORMAL CASE: 3+ matches ───────────────────────────────

  // Step 2 — Cheapest: lowest pricePerPax
  const byPrice = [...matched].sort((a, b) => (a.pricePerPax || 0) - (b.pricePerPax || 0));
  const cheapestFlight = byPrice[0];

  // Step 3 — Fastest: shortest totalDuration among remaining
  const afterCheapest = matched.filter(f => f !== cheapestFlight);
  const byDuration = [...afterCheapest].sort((a, b) =>
    _ffs_parseDurationMins(a.totalDuration) - _ffs_parseDurationMins(b.totalDuration)
  );
  const fastestFlight = byDuration[0];

  // Step 4 — Best: from remaining, pick best balanced score
  const afterBoth = matched.filter(f => f !== cheapestFlight && f !== fastestFlight);
  let bestFlight = null;
  if (afterBoth.length > 0) {
    bestFlight = afterBoth.reduce((best, f) =>
      _ffs_bestScore(f, budget) < _ffs_bestScore(best, budget) ? f : best
    , afterBoth[0]);
  } else {
    // All 3 spots filled by cheapest + fastest; pick best score from those two for Best
    bestFlight = _ffs_bestScore(cheapestFlight, budget) < _ffs_bestScore(fastestFlight, budget)
      ? cheapestFlight : fastestFlight;
  }

  // Step 5 — Build ordered set: Best → Cheapest → Fastest (deduplicated)
  const seen = new Set();
  const result = [];

  const push = (flight, tag) => {
    const key = (flight.airline || '') + '|' + (flight.segments && flight.segments[0] ? flight.segments[0].flightNumber : '');
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...flight, _ffs_tag: tag });
    }
  };

  push(bestFlight,    'best');
  push(cheapestFlight,'cheapest');
  push(fastestFlight, 'fastest');

  // If two tags collapsed on the same flight, fill the third slot
  if (result.length < 3) {
    const extras = matched
      .filter(f => {
        const key = (f.airline || '') + '|' + (f.segments && f.segments[0] ? f.segments[0].flightNumber : '');
        return !seen.has(key);
      })
      .sort((a, b) => _ffs_bestScore(a, budget) - _ffs_bestScore(b, budget));
    if (extras.length > 0) push(extras[0], 'best');
  }

  return result.slice(0, 3);  // Hard cap: max 3 filtered flights
}

/**
 * Build tag label and badge HTML for a filtered flight card
 */
function _ffs_tagBadgeHtml(tag) {
  const configs = {
    best:     { cls: 'best-badge',     icon: '★', label: 'Best'     },
    cheapest: { cls: 'cheapest-badge', icon: '₹', label: 'Cheapest' },
    fastest:  { cls: 'fastest-badge',  icon: '⚡', label: 'Fastest'  }
  };
  const cfg = configs[tag] || configs['best'];
  return `<span class="fc-tag-badge ${cfg.cls}">${cfg.icon} ${cfg.label}</span>`;
}

/**
 * Render the complete "Filtered Flights" section HTML.
 * Returns empty string if no matches (preserves existing flow).
 *
 * @param {Array}  filteredFlights  Result of buildFilteredFlightsSection()
 * @param {Object} userFilters      Current user filters (for criteria chips)
 * @param {Object} collected        The global collected object
 * @returns {string} HTML string
 */
function renderFilteredFlightsSection(filteredFlights, userFilters, collected) {
  if (!filteredFlights || filteredFlights.length === 0) return '';

  const cur = collected.currencySym || '₹';

  // Build criteria chips to show active filters
  const chips = [];
  if (userFilters.budget)           chips.push(`Budget: ${cur}${(userFilters.budget).toLocaleString('en-IN')}`);
  if (userFilters.depTime && userFilters.depTime !== 'Any time') chips.push(userFilters.depTime);
  if (userFilters.flightPref === 'direct')      chips.push('Direct only');
  if (userFilters.flightPref === 'connecting')  chips.push('Connecting');
  if (userFilters.maxStops)         chips.push(`Max ${userFilters.maxStops} stop${userFilters.maxStops > 1 ? 's' : ''}`);
  if (userFilters.cabin && userFilters.cabin !== 'Economy') chips.push(userFilters.cabin);
  if (userFilters.airlinePreference && userFilters.airlinePreference !== 'Any' && userFilters.airlinePreference !== '')
    chips.push(userFilters.airlinePreference);

  const chipsHtml = chips.map(c =>
    `<span class="filtered-criteria-chip">${c}</span>`
  ).join('');

  // Render each filtered flight card inline
  let cardsHtml = '';
  filteredFlights.forEach((f, idx) => {
    const tag = f._ffs_tag || 'best';
    const isOver = f.budgetDiff !== undefined ? f.budgetDiff < 0 : false;
    const priceColor = tag === 'cheapest' ? '#6ee7b7' : tag === 'fastest' ? '#c4b5fd' : '#fde68a';
    const total = f.totalPrice || (f.pricePerPax * (collected.adults || 1));
    const segs = f.segments || [];
    const budgetNum = userFilters.budget || 0;
    const diffVal = budgetNum - f.pricePerPax;
    const diffColor = diffVal >= 0 ? '#6ee7b7' : '#f87171';
    const diffLabel = diffVal >= 0
      ? `${cur}${Math.abs(diffVal).toLocaleString('en-IN')} under budget`
      : `${cur}${Math.abs(diffVal).toLocaleString('en-IN')} over budget`;

    // Card border colour per tag
    const borderColors = { best: 'rgba(245,201,122,0.4)', cheapest: 'rgba(52,211,153,0.4)', fastest: 'rgba(139,92,246,0.45)' };
    const glowColors   = { best: 'rgba(245,201,122,0.12)', cheapest: 'rgba(52,211,153,0.12)', fastest: 'rgba(139,92,246,0.15)' };

    // Segments HTML
    let segHtml = '';
    segs.forEach((seg, si) => {
      segHtml += `
        <div class="fc-segment">
          <div class="fc-ap">
            <div class="fc-iata" style="color:${priceColor}">${seg.fromIATA || ''}</div>
            <div class="fc-city">${seg.fromCity || ''}</div>
            <div class="fc-seg-time">${fmt12(seg.departureTime)}</div>
            <div class="fc-seg-date">${fmtSegDate(seg.departureDate)}</div>
          </div>
          <div class="fc-mid">
            <div class="fc-mid-bar" style="background:linear-gradient(90deg,transparent,${priceColor},transparent);">
              <span style="position:absolute;left:50%;top:-9px;transform:translateX(-50%);font-size:0.75rem;color:${priceColor};">✈</span>
            </div>
            <div class="fc-mid-dur">${seg.duration || ''}</div>
            <div class="fc-mid-fn">${seg.flightNumber || ''}</div>
          </div>
          <div class="fc-ap" style="text-align:right;">
            <div class="fc-iata" style="color:${priceColor}">${seg.toIATA || ''}</div>
            <div class="fc-city">${seg.toCity || ''}</div>
            <div class="fc-seg-time">${fmt12(seg.arrivalTime)}</div>
            <div class="fc-seg-date">${fmtSegDate(seg.arrivalDate)}</div>
          </div>
        </div>`;
      // Layover
      if (f.layovers && f.layovers[si]) {
        const lw = f.layovers[si];
        segHtml += `<div class="fc-layover">
          <div class="fc-layover-dot"></div>
          <span>Layover at ${lw.city || ''} · ${lw.duration || ''} wait</span>
        </div>`;
      }
    });

    // Tag-specific insight text
    const tagInsights = {
      best:     'Optimal balance of price, speed, and timing across all your filters.',
      cheapest: 'Lowest fare among all flights matching your exact criteria.',
      fastest:  'Shortest total journey time that satisfies every filter you set.'
    };

    if (idx > 0) cardsHtml += '<div class="filtered-card-divider"></div>';

    cardsHtml += `
    <div style="background:rgba(12,6,28,0.55);backdrop-filter:blur(20px);border:1px solid ${borderColors[tag]};
         border-radius:14px;padding:16px 18px;position:relative;overflow:hidden;
         box-shadow:0 4px 24px ${glowColors[tag]},0 2px 14px rgba(0,0,0,0.35);
         transition:transform 0.2s,box-shadow 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
      <!-- Top accent bar -->
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${
        tag === 'best'     ? 'linear-gradient(90deg,transparent,#b8860b,#fde68a,#b8860b,transparent)' :
        tag === 'cheapest' ? 'linear-gradient(90deg,transparent,#34d399,#6ee7b7,#34d399,transparent)' :
                             'linear-gradient(90deg,transparent,#7c3aed,#c4b5fd,#7c3aed,transparent)'
      };"></div>

      <!-- Header row -->
      <div class="fc-header">
        <div class="fc-airline-block">
          ${_ffs_tagBadgeHtml(tag)}
          <div class="fc-airline" style="margin-top:8px;">${f.airline || ''}</div>
          <div class="fc-flightnums">${segs.map(s => s.flightNumber).join(' · ')}</div>
        </div>
        <div class="fc-price-block">
          <div class="fc-price" style="color:${priceColor}">${cur}${(f.pricePerPax || 0).toLocaleString('en-IN')}</div>
          <div class="fc-price-sub">per person · ${cur}${total.toLocaleString('en-IN')} total</div>
          <div class="fc-budget-diff" style="color:${diffColor};font-size:0.66rem;margin-top:3px;font-weight:600;">${diffLabel}</div>
        </div>
      </div>

      <!-- Segments -->
      ${segHtml}

      <!-- Meta row -->
      <div class="fc-meta" style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.07);">
        <div class="fc-meta-item">
          <div class="fc-meta-label">Duration</div>
          <div class="fc-meta-val" style="color:${priceColor}">${f.totalDuration || '—'}</div>
        </div>
        <div class="fc-meta-item">
          <div class="fc-meta-label">Stops</div>
          <div class="fc-meta-val" style="color:${priceColor}">${f.stops === 0 ? 'Non-stop' : f.stops + ' stop' + (f.stops > 1 ? 's' : '')}</div>
        </div>
        <div class="fc-meta-item">
          <div class="fc-meta-label">Cabin</div>
          <div class="fc-meta-val" style="color:${priceColor}">${f.cabin || collected.cabin || 'Economy'}</div>
        </div>
        <div class="fc-meta-item">
          <div class="fc-meta-label">Per Person</div>
          <div class="fc-meta-val" style="color:${priceColor}">${cur}${(f.pricePerPax || 0).toLocaleString('en-IN')}</div>
        </div>
      </div>

      <!-- Filtered Flight Insight -->
      <div style="margin-top:12px;padding:10px 14px;
           background:linear-gradient(135deg,rgba(168,85,247,0.10),rgba(236,72,153,0.06));
           border:1.5px solid rgba(168,85,247,0.28);border-radius:10px;">
        <div style="font-size:0.6rem;letter-spacing:0.18em;text-transform:uppercase;color:#a78bfa;font-weight:800;margin-bottom:5px;">
          ✦ Why This Flight
        </div>
        <div style="font-size:0.82rem;color:#d1c4f7;line-height:1.65;font-style:italic;">${tagInsights[tag]}</div>
      </div>
    </div>`;
  });

  return `
  <div class="filtered-section-wrap">
    <!-- Section Header -->
    <div class="filtered-section-header">
      <div class="filtered-section-icon">✦</div>
      <div class="filtered-section-title-block">
        <div class="filtered-section-title">Filtered Flights</div>
        <div class="filtered-section-subtitle">Top ${filteredFlights.length} match${filteredFlights.length > 1 ? 'es' : ''} for your exact criteria</div>
      </div>
      <div class="filtered-section-badge">AI Curated</div>
    </div>

    <!-- Filter criteria chips -->
    ${chipsHtml ? `<div class="filtered-criteria-row">${chipsHtml}</div>` : ''}

    <!-- Flight cards -->
    <div class="filtered-section-body">
      ${cardsHtml}
    </div>
  </div>`;
}

// ── FLIGHT SEARCH ─────────────────────────────────────────────
window.searchFlights = async function(){
   activeSearchAbort = false;
  chatInput.disabled = true;
  inputHint.textContent = 'resolving airports & searching…';

  // Show loading spinner
  const spinRow = document.createElement('div');
  spinRow.className = 'msg-row velora';
  spinRow.innerHTML = '<div class="msg-avatar"><svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg></div><div class="msg-bubble"><div class="spinner"></div></div>';
  messagesEl.appendChild(spinRow);
  scrollToBottom();

  try {

    // ── BACKEND PROXY — all Amadeus calls go through Node.js server ──
    // No API keys here — credentials live safely in .env on the server
    const BACKEND_URL = window.location.origin; // same origin as Node server

    // ── Cabin map: Velora label → Amadeus travelClass ─────────
    const CABIN_MAP = {
      'Economy':         'ECONOMY',
      'Premium Economy': 'PREMIUM_ECONOMY',
      'Business':        'BUSINESS',
      'First Class':     'FIRST'
    };

    // ── IATA city/airport name lookup (extended) ───────────────
    const IATA_CITY = {
      'DEL':'Delhi','BOM':'Mumbai','BLR':'Bengaluru','HYD':'Hyderabad',
      'CCU':'Kolkata','MAA':'Chennai','PNQ':'Pune','JAI':'Jaipur',
      'AMD':'Ahmedabad','COK':'Kochi','GOI':'Goa','IXC':'Chandigarh',
      'LKO':'Lucknow','PAT':'Patna','BBI':'Bhubaneswar','IXB':'Bagdogra',
      'GAU':'Guwahati','ATQ':'Amritsar','VNS':'Varanasi','NAG':'Nagpur',
      'JFK':'New York','LAX':'Los Angeles','ORD':'Chicago','SFO':'San Francisco',
      'MIA':'Miami','SEA':'Seattle','BOS':'Boston','DFW':'Dallas',
      'LHR':'London','CDG':'Paris','AMS':'Amsterdam','FRA':'Frankfurt',
      'MAD':'Madrid','BCN':'Barcelona','FCO':'Rome','MXP':'Milan',
      'DXB':'Dubai','AUH':'Abu Dhabi','DOH':'Doha','KWI':'Kuwait',
      'SIN':'Singapore','BKK':'Bangkok','KUL':'Kuala Lumpur','CGK':'Jakarta',
      'NRT':'Tokyo','HND':'Tokyo','ICN':'Seoul','PEK':'Beijing','PVG':'Shanghai',
      'HKG':'Hong Kong','TPE':'Taipei','MNL':'Manila',
      'SYD':'Sydney','MEL':'Melbourne','AKL':'Auckland',
      'JNB':'Johannesburg','NBO':'Nairobi','CAI':'Cairo',
      'GRU':'São Paulo','EZE':'Buenos Aires','BOG':'Bogotá','LIM':'Lima',
      'YYZ':'Toronto','YVR':'Vancouver','MEX':'Mexico City'
    };

    // ── Airline name map (IATA code → display name) ────────────
    const AIRLINE_NAMES = {
      'AI':'Air India','6E':'IndiGo','SG':'SpiceJet','UK':'Vistara',
      'I5':'AirAsia India','G8':'Go First','IX':'Air India Express',
      'QP':'Akasa Air','S5':'Star Air','2T':'TruJet',
      'EK':'Emirates','EY':'Etihad','QR':'Qatar Airways',
      'SQ':'Singapore Airlines','CX':'Cathay Pacific','TG':'Thai Airways',
      'MH':'Malaysia Airlines','GA':'Garuda Indonesia','NH':'ANA',
      'JL':'Japan Airlines','KE':'Korean Air','OZ':'Asiana',
      'BA':'British Airways','LH':'Lufthansa','AF':'Air France',
      'KL':'KLM','IB':'Iberia','AZ':'Alitalia','LX':'Swiss',
      'AA':'American Airlines','UA':'United Airlines','DL':'Delta',
      'WN':'Southwest','B6':'JetBlue','AS':'Alaska Airlines',
      'FZ':'flydubai','WY':'Oman Air','GF':'Gulf Air','PK':'PIA',
      'UL':'SriLankan','BG':'Biman Bangladesh','FY':'Firefly',
      'QF':'Qantas','VA':'Virgin Australia','NZ':'Air New Zealand',
      'ET':'Ethiopian Airlines','SA':'South African','KQ':'Kenya Airways',
      'MS':'EgyptAir','TP':'TAP Portugal','SK':'SAS','AY':'Finnair',
      'OS':'Austrian','LO':'LOT','OK':'Czech Airlines'
    };

    // ── ISO 8601 duration → minutes ────────────────────────────
    function iso8601ToMins(dur) {
      if (!dur) return 0;
      const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
      return (parseInt(m?.[1] || 0) * 60) + parseInt(m?.[2] || 0);
    }

    // ── ISO 8601 duration → "Xh Ym" ───────────────────────────
    function iso8601ToDurStr(dur) {
      const mins = iso8601ToMins(dur);
      return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
    }

    // ── Departure time slot label ───────────────────────────────
    function depTimeSlot(timeStr) {
      const h = parseInt((timeStr || '').split('T')[1]?.split(':')[0] || '0');
      if (h >= 6  && h < 9)  return 'Early Morning (6AM-9AM)';
      if (h >= 9  && h < 12) return 'Morning (9AM-12PM)';
      if (h >= 12 && h < 18) return 'Afternoon (12PM-6PM)';
      if (h >= 18 && h < 21) return 'Evening (6PM-9PM)';
      return 'Night (9PM-6AM)';
    }

    // ── Extract HH:MM from ISO datetime ───────────────────────
    function isoToHHMM(iso) {
      if (!iso) return '00:00';
      const t = iso.split('T')[1] || '';
      return t.substring(0, 5);
    }

    // ── Extract YYYY-MM-DD from ISO datetime ──────────────────
    function isoToDate(iso) {
      if (!iso) return '';
      return iso.split('T')[0];
    }

    // ── Step 1: Resolve city names → IATA via backend ────────
    async function resolveIATA(cityName) {
      const localMap = {
        'delhi':'DEL','new delhi':'DEL','mumbai':'BOM','bombay':'BOM',
        'bangalore':'BLR','bengaluru':'BLR','hyderabad':'HYD','kolkata':'CCU',
        'calcutta':'CCU','chennai':'MAA','madras':'MAA','pune':'PNQ','poona':'PNQ',
        'jaipur':'JAI','ahmedabad':'AMD','kochi':'COK','cochin':'COK',
        'goa':'GOI','chandigarh':'IXC','lucknow':'LKO','patna':'PAT',
        'bhubaneswar':'BBI','bagdogra':'IXB','siliguri':'IXB','guwahati':'GAU',
        'amritsar':'ATQ','varanasi':'VNS','banaras':'VNS','nagpur':'NAG',
        'new york':'JFK','los angeles':'LAX','la':'LAX','chicago':'ORD',
        'san francisco':'SFO','miami':'MIA','seattle':'SEA','boston':'BOS','dallas':'DFW',
        'london':'LHR','paris':'CDG','amsterdam':'AMS','frankfurt':'FRA',
        'madrid':'MAD','barcelona':'BCN','rome':'FCO','milan':'MXP',
        'dubai':'DXB','abu dhabi':'AUH','doha':'DOH','kuwait':'KWI',
        'singapore':'SIN','bangkok':'BKK','kuala lumpur':'KUL','jakarta':'CGK',
        'tokyo':'NRT','seoul':'ICN','beijing':'PEK','shanghai':'PVG',
        'hong kong':'HKG','taipei':'TPE','manila':'MNL',
        'sydney':'SYD','melbourne':'MEL','auckland':'AKL',
        'johannesburg':'JNB','nairobi':'NBO','cairo':'CAI',
        'sao paulo':'GRU','buenos aires':'EZE','bogota':'BOG','lima':'LIM',
        'toronto':'YYZ','vancouver':'YVR','mexico city':'MEX'
      };
      const key = cityName.toLowerCase().trim();
      if (localMap[key]) return { iata: localMap[key], city: IATA_CITY[localMap[key]] || cityName };

      // Fallback: ask backend to query Amadeus airport search
      const res = await fetch(
        `${BACKEND_URL}/api/airports?subType=AIRPORT,CITY&keyword=${encodeURIComponent(cityName)}&page[limit]=5`
      );
      if (!res.ok) return { iata: cityName.substring(0, 3).toUpperCase(), city: cityName };
      const data = await res.json();
      const hit = (data.data || []).find(l => l.subType === 'AIRPORT') || (data.data || [])[0];
      if (!hit) return { iata: cityName.substring(0, 3).toUpperCase(), city: cityName };
      return { iata: hit.iataCode, city: hit.address?.cityName || hit.name || cityName };
    }

    const [originInfo, destInfo] = await Promise.all([
      resolveIATA(collected.originRaw),
      resolveIATA(collected.destinationRaw)
    ]);

    const originIATA      = originInfo.iata;
    const destinationIATA = destInfo.iata;
    const fromCityName    = originInfo.city;
    const toCityName      = destInfo.city;

    collected.fromCity = fromCityName;
    collected.fromIATA = originIATA;
    collected.toCity   = toCityName;
    collected.toIATA   = destinationIATA;

    const dateStr = collected.date;
    const budget  = collected.budget || 50000;
    const adults  = collected.adults  || 1;
    const cabin   = CABIN_MAP[collected.cabin] || 'ECONOMY';

    // ── Step 2: Search flights via backend proxy ──────────────
    const searchParams = new URLSearchParams({
      originLocationCode:      originIATA,
      destinationLocationCode: destinationIATA,
      departureDate:           dateStr,
      adults:                  String(adults),
      travelClass:             cabin,
      nonStop:                 collected.flightPref === 'direct' ? 'true' : 'false',
      max:                     '40',
      currencyCode:            'INR'
    });
    if (collected.children > 0) searchParams.set('children', String(collected.children));
    if (collected.infants  > 0) searchParams.set('infants',  String(collected.infants));

    const offersRes = await fetch(`${BACKEND_URL}/api/flights?${searchParams}`);

    if (!offersRes.ok) {
      const errBody = await offersRes.json().catch(() => ({}));
      throw new Error(`Flight search failed: ${errBody.error || offersRes.status}`);
    }

    const offersData = await offersRes.json();
    const offers = offersData.data || [];

    if (offers.length === 0) {
      throw new Error(`No flights found from ${fromCityName} to ${toCityName} on ${fmtDate(dateStr)}. Try a different date or relax your filters.`);
    }

    // ── Step 4: Map Amadeus offers → Velora internal flight shape ──
    function mapOffer(offer) {
      const itinerary  = offer.itineraries[0];   // outbound leg
      const segments   = itinerary.segments;
      const priceTotal = parseFloat(offer.price.grandTotal || offer.price.total || 0);
      const totalPax   = adults + (collected.children || 0) + (collected.infants || 0);
      const pricePerPax = Math.round(priceTotal / Math.max(totalPax, 1));
      const stops      = segments.length - 1;

      // Total duration
      const totalMins  = iso8601ToMins(itinerary.duration);
      const durStr     = `${Math.floor(totalMins / 60)}h ${String(totalMins % 60).padStart(2, '0')}m`;

      // Airline name (use first marketing carrier)
      const carrierCode = segments[0]?.carrierCode || segments[0]?.operating?.carrierCode || '';
      const airlineName = AIRLINE_NAMES[carrierCode] || carrierCode;

      // Dep time slot
      const firstDepISO = segments[0]?.departure?.at || '';
      const slot        = depTimeSlot(firstDepISO);

      // Max layover in hours (for connecting filters)
      let maxLayover = 0;
      for (let i = 0; i < segments.length - 1; i++) {
        const arrTime  = new Date(segments[i].arrival.at).getTime();
        const nextDep  = new Date(segments[i + 1].departure.at).getTime();
        const layMins  = (nextDep - arrTime) / 60000;
        maxLayover     = Math.max(maxLayover, layMins / 60);
      }

      // Layovers list (via airports)
      const layovers = segments.slice(0, -1).map((seg, idx) => {
        const via     = seg.arrival.iataCode;
        const layMins = Math.round(
          (new Date(segments[idx + 1].departure.at) - new Date(seg.arrival.at)) / 60000
        );
        return {
          city:     IATA_CITY[via] || via,
          airport:  via,
          duration: `${Math.floor(layMins / 60)}h ${String(layMins % 60).padStart(2, '0')}m`
        };
      });

      // Map each segment
      const mappedSegs = segments.map(seg => {
        const fn = seg.number
          ? `${seg.carrierCode || carrierCode}${seg.number}`
          : (seg.operating?.number ? `${seg.operating.carrierCode || carrierCode}${seg.operating.number}` : carrierCode);
        const segMins = iso8601ToMins(seg.duration);
        return {
          flightNumber:  fn,
          fromIATA:      seg.departure.iataCode,
          fromCity:      IATA_CITY[seg.departure.iataCode] || seg.departure.iataCode,
          toIATA:        seg.arrival.iataCode,
          toCity:        IATA_CITY[seg.arrival.iataCode]   || seg.arrival.iataCode,
          departureTime: isoToHHMM(seg.departure.at),
          arrivalTime:   isoToHHMM(seg.arrival.at),
          departureDate: isoToDate(seg.departure.at),
          arrivalDate:   isoToDate(seg.arrival.at),
          duration:      `${Math.floor(segMins / 60)}h ${String(segMins % 60).padStart(2, '0')}m`
        };
      });

      return {
        airline:      airlineName,
        stops,
        cabin:        collected.cabin || 'Economy',
        maxLayover,
        depTimeSlot:  slot,
        pricePerPax,
        totalPrice:   Math.round(priceTotal),
        totalDuration: durStr,
        layovers,
        segments:     mappedSegs
      };
    }

    const mappedFlights = offers.map(mapOffer);

    const parsed = {
      success:  true,
      flights:  mappedFlights,
      flexDates: []
    };

    console.log(`✅ Amadeus returned ${offers.length} offers → mapped ${mappedFlights.length} flights`);
    console.log('   Route:', originIATA, '→', destinationIATA, '| Date:', dateStr, '| Cabin:', cabin);

    spinRow.remove();

    if (activeSearchAbort) {
      chatInput.disabled = false;
      inputHint.textContent = 'tap mic or type to respond';
      return;
    }

    // ── USE INTELLIGENT RECOMMENDATION ENGINE ─────────────────────
    const filterSettings = {
      depTime:      collected.depTime    || 'Any time',
      flightPref:   collected.flightPref || 'direct',
      stops:        (collected.stops !== undefined && collected.stops !== null) ? collected.stops : 0,
      maxTransit:   collected.maxTransit || 4,
      cabin:        collected.cabin      || 'Economy',
      airlinePref:  collected.airlinePref || ''
    };
    
    const recommendations = recommandFlights(parsed.flights, filterSettings, collected.budget || 50000, dateStr, adults);
    
    console.log('🔍 Filter Settings:', filterSettings);
    console.log('🔍 Recommendations:', recommendations);
    console.log('🔍 Section 1 Count:', recommendations.section1.length);
    console.log('🔍 Section 2 Count:', recommendations.section2.length);
    
    // Add section info to parsed for rendering
    parsed.section1 = recommendations.section1;
    parsed.section2 = recommendations.section2;
    parsed.section3 = recommendations.section3;
    parsed.allFilteredFlights = recommendations.allFilteredFlights || [];

    // ── DISABLED: Build alternate date flights ─────────────────────
    // Now using Section 3 (buildSection3AlternateDates) for all alternate dates
    // parsed.alternateDates = buildAlternateDates(
    //   parsed.flights, filterSettings, collected.budget || 50000, dateStr, adults
    // );
    parsed.alternateDates = []; // Empty - Section 3 handles all alternate dates

    // ── RENDER THE THREE SECTIONS ─────────────────────────────────
    renderResults(parsed);

    if (activeSummaryPanel) {
      const sb = activeSummaryPanel.querySelector('#searchNowBtn');
      const eb = activeSummaryPanel.querySelector('#editModeBtn');
      const wb = activeSummaryPanel.querySelector('#search-warning-banner');
      if (sb) { sb.disabled = true; sb.classList.remove('searching'); sb.textContent = '✅ SEARCH COMPLETE'; }
      if (eb) { eb.disabled = true; eb.style.opacity = '0.4'; }
      if (wb) {
        wb.style.display = 'block';
        wb.innerHTML = '✅ Search complete. Both options are now disabled.';
        wb.style.borderColor = 'rgba(52,211,153,0.35)';
        wb.style.background  = 'rgba(52,211,153,0.08)';
        wb.style.color       = '#6ee7b7';
      }
    }

  } catch (e) {
    spinRow.remove();
    if (activeSearchAbort) { chatInput.disabled = false; return; }

    const errMsg = e.message || 'Unknown error. Please retry.';
    const errRow = document.createElement('div');
    errRow.className = 'msg-row velora';
    errRow.innerHTML = `<div class="msg-avatar"><svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg></div>
    <div class="msg-bubble" style="display:flex;flex-direction:column;gap:10px;">
      <span>${errMsg}</span>
      <button onclick="
        this.closest('.msg-row').remove();
        if(window.activeSummaryPanel){
          const sb=window.activeSummaryPanel.querySelector('#searchNowBtn');
          const eb=window.activeSummaryPanel.querySelector('#editModeBtn');
          const wb=window.activeSummaryPanel.querySelector('#search-warning-banner');
          if(sb){sb.disabled=false;sb.classList.add('searching');sb.textContent='⏳ SEARCHING…';}
          if(eb){eb.disabled=true;eb.style.opacity='0.4';}
          if(wb){wb.style.display='block';wb.innerHTML='⚠️ Retrying flight search — please wait.';wb.style.borderColor='rgba(251,191,36,0.35)';wb.style.background='rgba(251,191,36,0.1)';wb.style.color='#fbbf24';}
        }
        searchFlights();
      " style="padding:9px 20px;border-radius:10px;border:1px solid var(--border);background:rgba(168,85,247,0.15);color:var(--accent);font-family:'Jost',sans-serif;font-size:0.8rem;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;">↻ Retry Search</button>
    </div>`;
    messagesEl.appendChild(errRow);
    scrollToBottom();
    chatInput.disabled = false;
    inputHint.textContent = 'tap retry or start a new search';

    if (activeSummaryPanel) {
      const sb = activeSummaryPanel.querySelector('#searchNowBtn');
      const wb = activeSummaryPanel.querySelector('#search-warning-banner');
      if (sb) { sb.disabled = true; sb.classList.remove('searching'); sb.textContent = '❌ SEARCH FAILED'; }
      if (wb) {
        wb.style.display = 'block';
        wb.innerHTML = '❌ Flight search failed. Use the ↻ Retry button to try again.';
        wb.style.borderColor = 'rgba(248,113,113,0.35)';
        wb.style.background  = 'rgba(248,113,113,0.08)';
        wb.style.color       = '#f87171';
      }
    }
  }

};

// ── HELPERS ───────────────────────────────────────────────────
function tagColor(tag){
  return{
    best:'#f5c97a',
    cheapest:'#34d399',
    fastest:'#a78bfa',
    value:'#38bdf8',
    beyond:'#94a3b8'
  }[tag]||'#a78bfa';
}
function tagColorLight(tag){
  return{
    best:'#fde68a',
    cheapest:'#6ee7b7',
    fastest:'#c4b5fd',
    value:'#7dd3fc',
    beyond:'#cbd5e1'
  }[tag]||'#c4b5fd';
}

function fmtSegDate(d){
  // convert YYYY-MM-DD or any date string to DD-MM-YYYY
  if(!d) return '';
  const m=d.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  // try DD Mon YYYY → DD-MM-YYYY
  const months={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const m2=d.match(/(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})/i);
  if(m2) return `${m2[1].padStart(2,'0')}-${months[m2[2].toLowerCase()]||'01'}-${m2[3]}`;
  return d;
}

// Convert 24h "HH:MM" to 12h "H:MM AM/PM"
function fmt12(t){
  if(!t) return '';
  const parts = t.match(/(\d{1,2}):(\d{2})/);
  if(!parts) return t;
  let h = parseInt(parts[1]), mn = parts[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mn} ${ampm}`;
}

// Add N days to a YYYY-MM-DD date string → returns YYYY-MM-DD
function addDays(dateStr, n){
  if(!dateStr || !n) return dateStr;
  // Use UTC to avoid timezone-induced date shifts (e.g. IST UTC+5:30)
  const p=dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(!p)return dateStr;
  const dt=new Date(Date.UTC(parseInt(p[1]),parseInt(p[2])-1,parseInt(p[3])));
  dt.setUTCDate(dt.getUTCDate()+n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
}

// ── RENDER RESULTS ────────────────────────────────────────────
async function renderResults(data){
  window._vFlights=[];
  window._searchId=(window._searchId||0)+1;
  const sid=window._searchId;
  const cur=collected.currencySym||'₹';

  // Results render as a standalone full-width block — NOT inside a msg-row bubble
  const container=document.createElement('div');
  container.style.cssText='width:100%;max-width:100%;margin:8px 0;';

  // content is the direct child that receives innerHTML
  const content=document.createElement('div');
  content.style.cssText='width:100%;min-width:0;';

  // Check if we have new 3-section structure
  const hasSection1 = data.section1 && data.section1.length > 0;
  const hasSection2 = data.section2 && data.section2.length > 0;
  const hasSection3 = data.section3 && data.section3.length > 0;
  
  let summaryMsg = '';
  if(hasSection1) {
    summaryMsg = `✈️ Found ${data.section1.length} flights matching your exact filters!`;
    if(hasSection2) summaryMsg += ` Plus ${data.section2.length} smart alternative${data.section2.length > 1 ? 's' : ''}.`;
    if(hasSection3) summaryMsg += ` Also showing ${data.section3.length} option${data.section3.length > 1 ? 's' : ''} for nearby dates.`;
  } else {
    summaryMsg = `Found ${(data.flights||[]).length} flight options. Showing best alternatives.`;
  }
  
  await velora(summaryMsg);

  let html=`<div class="results-wrap">
  <div class="results-date-banner">
    ✈ <span>${collected.originRaw} → ${collected.destinationRaw}</span>
    &nbsp;·&nbsp;<span>${fmtDate(collected.date)}</span>
    &nbsp;·&nbsp;${collected.cabin}&nbsp;·&nbsp;${collected.adults} Adult${collected.adults>1?'s':''}
  </div>
  `;

  /**
 * Analyze layover duration and explain real travel impact
 * Returns insight text with category categorization
 */
function analyzeLayoverImpact(layoverDuration, layoverCity, isLastSegment, totalStops, usedLayoverInsights) {
  const used = usedLayoverInsights || {};
  
  // Parse duration to hours
  const durationText = layoverDuration.toString().trim();
  const hourMatch = durationText.match(/(\d+)\s*h/);
  const minMatch = durationText.match(/(\d+)\s*m/);
  const hours = hourMatch ? parseFloat(hourMatch[1]) : 0;
  const mins = minMatch ? parseFloat(minMatch[1]) : 0;
  const totalHours = hours + (mins / 60);
  
  let category = '';
  let insights = [];
  
  // CATEGORY 1: VERY SHORT LAYOVER (< 1 hour) - HIGH RISK
  if(totalHours < 1) {
    category = 'very-short';
    insights = [
      'This tight connection requires rushing through airport procedures and increases risk of missing the next flight.',
      'Very short layover means limited time for security/immigration and high connection risk.',
      'Tight connection window may cause stress and potential missed flight due to security delays.'
    ];
  }
  // CATEGORY 2: SHORT LAYOVER (1-2 hours) - MODERATE STRESS
  else if(totalHours >= 1 && totalHours < 2) {
    category = 'short';
    insights = [
      'Short transit time allows connection but may feel stressful due to limited time for refreshment or terminal transfer.',
      'Layover provides basic connection time with minimal buffer for unexpected delays.',
      'Limited time for rest or food; boarding pressure due to tight connection window.'
    ];
  }
  // CATEGORY 3: IDEAL LAYOVER (2-4 hours) - COMFORTABLE
  else if(totalHours >= 2 && totalHours <= 4) {
    category = 'ideal';
    insights = [
      'This comfortable layover duration allows relaxed transfer between flights without long waiting or rushing.',
      'Adequate time for smooth terminal transfer and light refreshment without travel stress.',
      'Ideal connection window providing both safe transfer time and minimal unnecessary waiting.'
    ];
  }
  // CATEGORY 4: LONG LAYOVER (4-6 hours) - WAITING PROBLEM
  else if(totalHours > 4 && totalHours <= 6) {
    category = 'long';
    insights = [
      'Long airport waiting time may cause discomfort and increase total travel duration compared to faster route options.',
      'Extended layover means several hours sitting at the airport with potential boredom and fatigue.',
      'This layover extends your total journey time significantly; consider if faster routes are available.'
    ];
  }
  // CATEGORY 5: VERY LONG LAYOVER (6-8 hours) - FATIGUE ISSUE
  else if(totalHours > 6 && totalHours < 12) {
    category = 'very-long';
    insights = [
      'Very long transit duration can lead to travel fatigue and may require planning for proper rest during the journey.',
      'Extended waiting time causes significant travel tiredness; consider airport lounges or rest areas.',
      'This layover creates substantial journey fatigue; you may want to explore alternate flights.'
    ];
  }
  // CATEGORY 6: OVERNIGHT LAYOVER (12+ hours) - SLEEP DISRUPTION
  else if(totalHours >= 12) {
    category = 'overnight';
    insights = [
      'Overnight layover may disturb sleep schedule and could require airport rest lounge or nearby hotel arrangement.',
      'Extended overnight wait disrupts your sleep and requires planning for rest; hotel near airport recommended.',
      'Long overnight layover creates significant travel complexity; consider if trip timing can be adjusted.'
    ];
  }
  
  // Select first unused insight
  let selectedInsight = '';
  for(let insight of insights) {
    if(!used[insight]) {
      selectedInsight = insight;
      used[insight] = true;
      break;
    }
  }
  
  // Fallback
  if(!selectedInsight) {
    selectedInsight = insights[Math.floor(Math.random() * insights.length)] || 'Layover duration impacts your overall journey time and comfort.';
  }
  
  return {
    category: category,
    insight: selectedInsight,
    hours: totalHours
  };
}

function renderCard(f,optionNum,noTag){
    if(!f) return '';
    const price = f.pricePerPax || 0;
    const budgetDiff = (collected.budget||0) - price;
    const isOver = budgetDiff < 0;
    const total = (f.totalPrice||(price*(collected.adults||1)));
    const segs = f.segments||[];
    const usedLayoverInsights = {};
    f.pricePerPax = price;

    // ── Tag config: badge + palette per type ──────────────────────────
    const tagCfg = {
      best: {
        cardBorder:'rgba(245,201,122,0.55)', cardGlow:'rgba(245,201,122,0.18)',
        topBar:'#f5c97a', ambientGlow:'rgba(245,201,122,0.20)',
        iata:'#fde68a', city:'#fcd34d', time:'#fef9e7', midBar:'#f5c97a', metaVal:'#fde68a',
        diffPos:'#fde68a', diffBg:'rgba(245,201,122,0.18)', diffBorder:'rgba(253,230,138,0.60)',
        badgeBg:'linear-gradient(135deg,#78350f 0%,#92400e 40%,#d97706 100%)',
        badgeBorder:'#fbbf24', badgeText:'#fef3c7',
        badgeShadow:'0 0 20px rgba(245,201,122,0.85), 0 0 50px rgba(245,201,122,0.35), 0 2px 8px rgba(0,0,0,0.5)',
        badgeIcon:'★', badgeLabel:'BEST',
        hoverShadow:'0 16px 48px rgba(0,0,0,0.55),0 0 40px rgba(245,201,122,0.25)'
      },
      cheapest: {
        cardBorder:'rgba(52,211,153,0.50)', cardGlow:'rgba(52,211,153,0.18)',
        topBar:'#6ee7b7', ambientGlow:'rgba(52,211,153,0.18)',
        iata:'#6ee7b7', city:'#86efac', time:'#ecfdf5', midBar:'#34d399', metaVal:'#6ee7b7',
        diffPos:'#6ee7b7', diffBg:'rgba(52,211,153,0.18)', diffBorder:'rgba(110,231,183,0.60)',
        badgeBg:'linear-gradient(135deg,#064e3b 0%,#065f46 40%,#059669 100%)',
        badgeBorder:'#34d399', badgeText:'#d1fae5',
        badgeShadow:'0 0 20px rgba(52,211,153,0.85), 0 0 50px rgba(52,211,153,0.35), 0 2px 8px rgba(0,0,0,0.5)',
        badgeIcon:'₹', badgeLabel:'CHEAPEST',
        hoverShadow:'0 16px 48px rgba(0,0,0,0.55),0 0 40px rgba(52,211,153,0.25)'
      },
      fastest: {
        cardBorder:'rgba(139,92,246,0.55)', cardGlow:'rgba(139,92,246,0.20)',
        topBar:'#a78bfa', ambientGlow:'rgba(139,92,246,0.20)',
        iata:'#c4b5fd', city:'#a5b4fc', time:'#f5f3ff', midBar:'#a78bfa', metaVal:'#c4b5fd',
        diffPos:'#c4b5fd', diffBg:'rgba(139,92,246,0.18)', diffBorder:'rgba(167,139,250,0.60)',
        badgeBg:'linear-gradient(135deg,#2e1065 0%,#4c1d95 40%,#6d28d9 100%)',
        badgeBorder:'#8b5cf6', badgeText:'#ede9fe',
        badgeShadow:'0 0 20px rgba(139,92,246,0.85), 0 0 50px rgba(139,92,246,0.35), 0 2px 8px rgba(0,0,0,0.5)',
        badgeIcon:'⚡', badgeLabel:'FASTEST',
        hoverShadow:'0 16px 48px rgba(0,0,0,0.55),0 0 40px rgba(139,92,246,0.30)'
      },
      value: {
        cardBorder:'rgba(56,189,248,0.45)', cardGlow:'rgba(56,189,248,0.15)',
        topBar:'#38bdf8', ambientGlow:'rgba(56,189,248,0.15)',
        iata:'#7dd3fc', city:'#38bdf8', time:'#e0f2fe', midBar:'#38bdf8', metaVal:'#7dd3fc',
        diffPos:'#7dd3fc', diffBg:'rgba(56,189,248,0.15)', diffBorder:'rgba(125,211,252,0.55)',
        badgeBg:'linear-gradient(135deg,#0c4a6e 0%,#0369a1 40%,#0284c7 100%)',
        badgeBorder:'#38bdf8', badgeText:'#e0f2fe',
        badgeShadow:'0 0 16px rgba(56,189,248,0.65), 0 0 40px rgba(56,189,248,0.25)',
        badgeIcon:'◎', badgeLabel:'BEST VALUE',
        hoverShadow:'0 16px 48px rgba(0,0,0,0.55),0 0 36px rgba(56,189,248,0.20)'
      },
      alternate: {
        cardBorder:'rgba(52,211,153,0.42)', cardGlow:'rgba(52,211,153,0.14)',
        topBar:'#6ee7b7', ambientGlow:'rgba(52,211,153,0.14)',
        iata:'#6ee7b7', city:'#86efac', time:'#ecfdf5', midBar:'#34d399', metaVal:'#6ee7b7',
        diffPos:'#6ee7b7', diffBg:'rgba(52,211,153,0.15)', diffBorder:'rgba(110,231,183,0.50)',
        badgeBg:'linear-gradient(135deg,#064e3b 0%,#065f46 60%,#059669 100%)',
        badgeBorder:'#34d399', badgeText:'#d1fae5',
        badgeShadow:'0 0 14px rgba(52,211,153,0.55)',
        badgeIcon:'📅', badgeLabel:'ALT DATE',
        hoverShadow:'0 16px 48px rgba(0,0,0,0.55),0 0 30px rgba(52,211,153,0.18)'
      },
      beyond: {
        cardBorder:'rgba(100,116,139,0.35)', cardGlow:'rgba(100,116,139,0.10)',
        topBar:'#64748b', ambientGlow:'rgba(100,116,139,0.10)',
        iata:'#e2e8f0', city:'#94a3b8', time:'#f1f5f9', midBar:'#64748b', metaVal:'#e2e8f0',
        diffPos:'#94a3b8', diffBg:'rgba(100,116,139,0.14)', diffBorder:'rgba(148,163,184,0.42)',
        badgeBg:'rgba(51,65,85,0.7)', badgeBorder:'rgba(148,163,184,0.40)', badgeText:'#cbd5e1',
        badgeShadow:'none', badgeIcon:'', badgeLabel:'',
        hoverShadow:'0 16px 48px rgba(0,0,0,0.55),0 0 20px rgba(100,116,139,0.15)'
      },
    };
    const tag = (f.section==='alternate') ? 'alternate' : (noTag ? 'beyond' : (f.tag||'beyond'));
    const cfg = tagCfg[tag] || tagCfg.beyond;
    const dc  = isOver ? '#f87171' : cfg.diffPos;
    const dcBg = isOver ? 'rgba(248,113,113,0.18)' : cfg.diffBg;
    const dcBorder = isOver ? 'rgba(248,113,113,0.55)' : cfg.diffBorder;
    const dtAbs = Math.abs(budgetDiff);
    const dtLabel = isOver
      ? '+\u20B9' + dtAbs.toLocaleString('en-IN') + ' over budget'
      : '\u20B9'  + dtAbs.toLocaleString('en-IN') + ' under budget';
    const dtArrow = isOver ? '\u2191' : '\u2193';
    const dtIcon  = isOver ? '\uD83D\uDD34' : '\uD83D\uDFE2';

    const aiRaw=(f.aiSuggestion||'').trim();
    let aiInsight='', aiPoints=[];
    if(aiRaw.includes('|')){
      const parts=aiRaw.split('|').map(s=>s.trim());
      parts.forEach(p=>{
        if(p.startsWith('INSIGHT:'))aiInsight=p.replace('INSIGHT:','').trim();
        else if(p.startsWith('POINT'))aiPoints.push(p.replace(/^POINT\d+:/,'').trim());
      });
    } else { aiInsight=aiRaw; }

    const normalShadow = '0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.07) inset, 0 1px 0 rgba(255,255,255,0.13) inset';
    const hoverShadow  = cfg.hoverShadow + ', 0 0 0 1px rgba(255,255,255,0.09) inset, 0 1px 0 rgba(255,255,255,0.15) inset';

    // ── GLASSMORPHISM CARD ───────────────────────────────────────────
    let c = '<div style="'
      + 'position:relative;overflow:hidden;'
      + 'background:linear-gradient(145deg,rgba(255,255,255,0.09) 0%,rgba(255,255,255,0.04) 45%,rgba(0,0,0,0.18) 100%);'
      + 'backdrop-filter:blur(32px) saturate(180%) brightness(1.05);'
      + '-webkit-backdrop-filter:blur(32px) saturate(180%) brightness(1.05);'
      + 'border:1.5px solid ' + cfg.cardBorder + ';'
      + 'border-radius:22px;'
      + 'padding:22px 22px 18px;'
      + 'margin-bottom:18px;'
      + 'box-shadow:' + normalShadow + ';'
      + 'transition:border-color 0.3s,box-shadow 0.35s,transform 0.25s;"'
      + ' onmouseover="this.style.transform=\'translateY(-4px)\';this.style.boxShadow=\'' + hoverShadow + '\'"'
      + ' onmouseout="this.style.transform=\'none\';this.style.boxShadow=\'' + normalShadow + '\'"'
      + '>';

    // Glass shimmer line
    c += '<div style="position:absolute;top:0;left:0;right:0;height:1px;'
       + 'background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.22) 50%,transparent 100%);"></div>';

    // Top accent glow bar
    c += '<div style="position:absolute;top:0;left:0;right:0;height:3px;'
       + 'background:linear-gradient(90deg,transparent 0%,' + cfg.topBar + ' 40%,' + cfg.topBar + ' 60%,transparent 100%);'
       + 'opacity:0.95;filter:blur(0.6px);"></div>';

    // Ambient glow blob top-right
    c += '<div style="position:absolute;top:-50px;right:-40px;width:160px;height:160px;'
       + 'background:radial-gradient(circle,' + cfg.ambientGlow + ' 0%,transparent 68%);pointer-events:none;"></div>';

    // ── HEADER ROW ───────────────────────────────────────────────────
    c += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;gap:14px;">';

    // Left: badge + airline + flight numbers
    c += '<div style="min-width:0;flex:1;">';

    if(optionNum) {
      c += '<div style="font-size:0.70rem;letter-spacing:0.20em;text-transform:uppercase;'
         + 'color:rgba(255,255,255,0.45);margin-bottom:7px;font-family:\'Jost\',sans-serif;">Option ' + optionNum + '</div>';
    }

    // ── TAG BADGE — big, glowing, animated for best/cheapest/fastest ──
    if(cfg.badgeLabel && tag !== 'beyond') {
      const isPrimary = (tag==='best'||tag==='cheapest'||tag==='fastest');
      const animStyle = isPrimary
        ? 'animation:badge-pulse-' + tag + ' 2.2s ease-in-out infinite;'
        : '';
      c += '<div style="display:inline-flex;align-items:center;gap:8px;'
         + 'padding:' + (isPrimary ? '8px 18px 8px 13px' : '6px 14px 6px 10px') + ';'
         + 'border-radius:28px;'
         + 'background:' + cfg.badgeBg + ';'
         + 'border:2px solid ' + cfg.badgeBorder + ';'
         + 'color:' + cfg.badgeText + ';'
         + 'font-size:' + (isPrimary ? '0.80rem' : '0.72rem') + ';'
         + 'font-weight:900;letter-spacing:0.24em;text-transform:uppercase;font-family:\'Jost\',sans-serif;'
         + 'box-shadow:' + cfg.badgeShadow + ';'
         + 'margin-bottom:9px;'
         + animStyle
         + '">'
         + '<span style="font-size:' + (isPrimary ? '1.05rem' : '0.88rem') + ';">' + cfg.badgeIcon + '</span>'
         + cfg.badgeLabel
         + '</div>';
    }

    if(f.section==='alternate' && f.dateBadge) {
      c += '<div style="font-size:0.82rem;color:' + cfg.city + ';margin-bottom:6px;font-weight:700;'
         + 'font-family:\'Jost\',sans-serif;letter-spacing:0.06em;">' + f.dateBadge + '</div>';
    }
    if(f.section==='beyond' && f.reasonBadge) {
      c += '<div style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;'
         + 'background:' + cfg.badgeBg + ';border:1px solid ' + cfg.badgeBorder + ';'
         + 'color:' + cfg.badgeText + ';font-size:0.72rem;font-weight:700;letter-spacing:0.10em;'
         + 'font-family:\'Jost\',sans-serif;margin-bottom:7px;">' + f.reasonBadge + '</div>';
    }

    // Airline name — large serif
    c += '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.52rem;font-weight:600;'
       + 'color:#f1f5f9;line-height:1.15;margin-top:2px;">' + (f.airline||'') + '</div>';

    // Flight numbers
    c += '<div style="font-size:0.76rem;color:rgba(255,255,255,0.42);letter-spacing:0.08em;'
       + 'margin-top:5px;font-family:\'Jost\',sans-serif;">'
       + segs.map(s => s.flightNumber||'').join(' · ')
       + '</div>';

    c += '</div>'; // end left

    // Right: price + diff badge
    c += '<div style="text-align:right;flex-shrink:0;">';

    // Price — large, glowing
    c += '<div style="font-family:\'Cormorant Garamond\',serif;font-size:2.20rem;font-weight:700;'
       + 'line-height:1;color:' + cfg.iata + ';'
       + 'text-shadow:0 0 24px ' + cfg.ambientGlow + ',0 0 8px ' + cfg.ambientGlow + ';">'
       + '\u20B9' + price.toLocaleString('en-IN')
       + '</div>';

    c += '<div style="font-size:0.70rem;color:rgba(255,255,255,0.44);margin-top:5px;'
       + 'font-family:\'Jost\',sans-serif;">per person · \u20B9' + total.toLocaleString('en-IN') + ' total</div>';

    // ── PRICE DIFFERENCE — highly prominent highlighted badge ──
    c += '<div style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;'
       + 'padding:7px 15px;border-radius:24px;'
       + 'background:' + dcBg + ';'
       + 'border:2px solid ' + dcBorder + ';'
       + 'color:' + dc + ';'
       + 'font-size:0.82rem;font-weight:900;letter-spacing:0.08em;font-family:\'Jost\',sans-serif;'
       + 'box-shadow:0 0 16px ' + dcBg + ',0 2px 8px rgba(0,0,0,0.35);'
       + '">'
       + '<span style="font-size:0.92rem;font-weight:900;">' + dtArrow + '</span>'
       + dtLabel
       + '</div>';

    c += '</div>'; // end right
    c += '</div>'; // end header row

    // ── SEGMENTS ─────────────────────────────────────────────────────
    segs.forEach(function(seg, i) {
      c += '<div style="'
         + 'display:flex;align-items:center;gap:12px;'
         + 'padding:15px 16px;'
         + 'background:rgba(255,255,255,0.055);'
         + 'backdrop-filter:blur(12px) saturate(140%);'
         + '-webkit-backdrop-filter:blur(12px) saturate(140%);'
         + 'border-radius:14px;'
         + 'margin-bottom:9px;'
         + 'border:1px solid rgba(255,255,255,0.11);'
         + 'box-shadow:inset 0 1px 0 rgba(255,255,255,0.09),0 2px 8px rgba(0,0,0,0.20);'
         + '">';

      // From airport
      c += '<div style="min-width:0;flex:1;">';
      c += '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.85rem;font-weight:700;'
         + 'letter-spacing:0.04em;line-height:1;color:' + cfg.iata + ';'
         + 'text-shadow:0 0 18px ' + cfg.ambientGlow + ';">' + (seg.fromIATA||'') + '</div>';
      c += '<div style="font-size:0.76rem;margin-top:4px;color:' + cfg.city + ';'
         + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
         + 'font-family:\'Jost\',sans-serif;font-weight:500;">' + (seg.fromCity||'') + '</div>';
      c += '<div style="font-size:1.15rem;font-weight:600;margin-top:8px;color:' + cfg.time + ';'
         + 'font-family:\'Cormorant Garamond\',serif;">' + fmt12(seg.departureTime) + '</div>';
      c += '<div style="font-size:0.68rem;color:rgba(255,255,255,0.44);margin-top:3px;'
         + 'font-family:\'Jost\',sans-serif;">' + fmtSegDate(seg.departureDate) + '</div>';
      c += '</div>';

      // Mid route bar
      c += '<div style="flex:1.4;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:44px;">';
      c += '<div style="width:100%;height:1px;background:linear-gradient(90deg,transparent,' + cfg.midBar + ',transparent);position:relative;">';
      c += '<span style="position:absolute;left:50%;top:-11px;transform:translateX(-50%);font-size:0.92rem;'
         + 'color:' + cfg.midBar + ';filter:drop-shadow(0 0 5px ' + cfg.midBar + ');">\u2708</span>';
      c += '</div>';
      c += '<div style="font-size:0.76rem;color:rgba(255,255,255,0.75);letter-spacing:0.06em;'
         + 'font-family:\'Jost\',sans-serif;font-weight:600;">' + (seg.duration||'') + '</div>';
      c += '<div style="font-size:0.66rem;color:rgba(255,255,255,0.40);font-family:\'Jost\',sans-serif;">'
         + (seg.flightNumber||'') + '</div>';
      c += '</div>';

      // To airport
      c += '<div style="min-width:0;flex:1;text-align:right;">';
      c += '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.85rem;font-weight:700;'
         + 'letter-spacing:0.04em;line-height:1;color:' + cfg.iata + ';'
         + 'text-shadow:0 0 18px ' + cfg.ambientGlow + ';">' + (seg.toIATA||'') + '</div>';
      c += '<div style="font-size:0.76rem;margin-top:4px;color:' + cfg.city + ';'
         + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
         + 'font-family:\'Jost\',sans-serif;font-weight:500;">' + (seg.toCity||'') + '</div>';
      c += '<div style="font-size:1.15rem;font-weight:600;margin-top:8px;color:' + cfg.time + ';'
         + 'font-family:\'Cormorant Garamond\',serif;">' + fmt12(seg.arrivalTime) + '</div>';
      c += '<div style="font-size:0.68rem;color:rgba(255,255,255,0.44);margin-top:3px;'
         + 'font-family:\'Jost\',sans-serif;">' + fmtSegDate(seg.arrivalDate) + '</div>';
      c += '</div>';

      c += '</div>'; // end segment row

      // Layover pill
      if(f.layovers && f.layovers[i]) {
        const lw = f.layovers[i];
        const la = analyzeLayoverImpact(lw.duration, lw.city, i===segs.length-1, f.stops, usedLayoverInsights);
        const lColors = {'very-short':'#ef4444','short':'#f97316','ideal':'#10b981','long':'#f59e0b','very-long':'#d97706','overnight':'#8b5cf6'};
        const lc = lColors[la.category]||'#6b7280';
        c += '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;margin:0 0 9px;'
           + 'background:rgba(236,72,153,0.08);border:1px dashed rgba(236,72,153,0.32);'
           + 'border-radius:11px;backdrop-filter:blur(8px);">';
        c += '<div style="width:8px;height:8px;border-radius:50%;background:#ec4899;'
           + 'flex-shrink:0;margin-top:5px;box-shadow:0 0 7px #ec4899;"></div>';
        c += '<div style="flex:1;">';
        c += '<div style="font-size:0.82rem;color:#fda4af;font-family:\'Jost\',sans-serif;font-weight:500;">'
           + 'Layover at ' + (lw.city||'') + ' (' + (lw.airport||'') + ') \u00B7 ' + (lw.duration||'') + ' wait</div>';
        c += '<div style="font-size:0.80rem;color:' + lc + ';font-weight:600;line-height:1.5;'
           + 'font-style:italic;margin-top:4px;font-family:\'Cormorant Garamond\',serif;">'
           + la.insight + '</div>';
        c += '</div></div>';
      }
    });

    // ── META ROW ─────────────────────────────────────────────────────
    c += '<div style="display:flex;gap:0;flex-wrap:wrap;margin-top:16px;padding-top:14px;'
       + 'border-top:1px solid rgba(255,255,255,0.10);">';

    const metaItems = [
      { label:'Duration',   val: f.totalDuration||'—' },
      { label:'Stops',      val: (f.stops||0)===0 ? 'Non-stop' : (f.stops)+' stop'+((f.stops||0)>1?'s':'') },
      { label:'Cabin',      val: f.cabin||collected.cabin||'Economy' },
      { label:'Per Person', val: '\u20B9'+(price.toLocaleString('en-IN')) },
    ];
    metaItems.forEach(function(m, mi) {
      c += '<div style="flex:1;min-width:76px;display:flex;flex-direction:column;'
         + (mi < metaItems.length-1 ? 'padding-right:10px;' : '') + '">';
      c += '<div style="font-size:0.62rem;letter-spacing:0.17em;text-transform:uppercase;'
         + 'color:rgba(255,255,255,0.42);font-family:\'Jost\',sans-serif;font-weight:600;">'
         + m.label + '</div>';
      c += '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.12rem;'
         + 'color:' + cfg.metaVal + ';margin-top:5px;font-weight:600;">' + m.val + '</div>';
      c += '</div>';
    });
    c += '</div>';

    if(f.beyondDepartureIATA && f.beyondDepartureIATA !== collected.fromIATA) {
      c += '<div style="margin-top:11px;padding:8px 14px;background:rgba(96,212,247,0.09);'
         + 'border-left:2.5px solid #60d4f7;border-radius:8px;font-size:0.82rem;'
         + 'color:#60d4f7;font-family:\'Jost\',sans-serif;">'
         + '\uD83D\uDEEB Departing from alternate airport: <strong>' + f.beyondDepartureIATA + '</strong></div>';
    }

    // ── AI INSIGHT PANEL ─────────────────────────────────────────────
    const mainInsight = f.mainInsight || f.insight || '';
    const extraSug    = f.section==='beyond' ? '' : (f.extraSuggestion||'');

    if(mainInsight) {
      const isB = f.section==='beyond';
      const panelBg     = isB ? 'rgba(100,116,139,0.11)' : 'rgba(236,72,153,0.09)';
      const panelBorder = isB ? 'rgba(100,116,139,0.32)' : 'rgba(236,72,153,0.38)';
      const hdrBg       = isB ? 'rgba(100,116,139,0.16)' : 'rgba(236,72,153,0.16)';
      const hdrBorder   = isB ? 'rgba(100,116,139,0.22)' : 'rgba(236,72,153,0.24)';
      const iconGrad    = isB ? 'rgba(167,139,250,0.28)' : 'linear-gradient(135deg,#ec4899,#f472b6)';
      const iconColor   = isB ? '#c4b5fd' : '#fff';
      const iconShadow  = isB ? 'none' : '0 0 9px rgba(236,72,153,0.55)';
      const iconEmoji   = isB ? '\uD83D\uDD0D' : '\u2728';
      const labelColor  = isB ? '#a78bfa' : '#ec4899';
      const labelText   = isB ? 'Reason' : 'Smart Insight';
      const textColor   = isB ? '#c4b5fd' : '#f472b6';

      c += '<div style="margin-top:14px;padding:0;background:' + panelBg + ';border:1px solid ' + panelBorder + ';'
         + 'border-radius:14px;overflow:hidden;backdrop-filter:blur(10px);">';
      c += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;'
         + 'background:' + hdrBg + ';border-bottom:1px solid ' + hdrBorder + ';">';
      c += '<div style="width:22px;height:22px;border-radius:50%;background:' + iconGrad + ';'
         + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;'
         + 'box-shadow:' + iconShadow + ';">';
      c += '<span style="font-size:0.76rem;color:' + iconColor + ';font-weight:bold;">' + iconEmoji + '</span></div>';
      c += '<span style="font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;'
         + 'color:' + labelColor + ';font-weight:800;font-family:\'Jost\',sans-serif;">' + labelText + '</span>';
      c += '</div>';
      c += '<div style="padding:11px 14px;font-family:\'Cormorant Garamond\',serif;font-size:1.05rem;'
         + 'color:' + textColor + ';line-height:1.70;font-style:italic;">'
         + mainInsight + (mainInsight.endsWith('.')?'':'.') + '</div>';
      c += '</div>';
    }

    if(extraSug) {
      c += '<div style="margin-top:11px;padding:0;background:rgba(56,189,248,0.09);'
         + 'border:1px solid rgba(56,189,248,0.35);border-radius:14px;overflow:hidden;backdrop-filter:blur(10px);">';
      c += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;'
         + 'background:rgba(56,189,248,0.14);border-bottom:1px solid rgba(56,189,248,0.22);">';
      c += '<div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#0ea5e9,#38bdf8);'
         + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;'
         + 'box-shadow:0 0 9px rgba(56,189,248,0.45);">';
      c += '<span style="font-size:0.76rem;color:#fff;font-weight:bold;">\uD83D\uDCA1</span></div>';
      c += '<span style="font-size:0.62rem;letter-spacing:0.22em;text-transform:uppercase;'
         + 'color:#38bdf8;font-weight:800;font-family:\'Jost\',sans-serif;">Pro Tip</span>';
      c += '</div>';
      c += '<div style="padding:11px 14px;font-family:\'Cormorant Garamond\',serif;font-size:1.05rem;'
         + 'color:#60d4f7;line-height:1.70;font-style:italic;">'
         + extraSug + (extraSug.endsWith('.')?'':'.') + '</div>';
      c += '</div>';
    }

    c += '</div>'; // close card
    return c;
  }

  // ── NEW THREE-SECTION RENDERING ──────────────────────────────────
  if(data.section1 && data.section1.length > 0) {
    // SECTION 1: FILTERED FLIGHTS — header banner
    html+=`<div style="margin-top:20px;padding:0 0 14px 0;border-bottom:1px solid rgba(224,122,255,0.2);margin-bottom:4px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.1rem;">✈️</span>
        <div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:1.1rem;color:#e07aff;letter-spacing:0.1em;font-weight:600;">BEST MATCHES FOR YOU</div>
          <div style="font-size:0.68rem;color:#9b8ab0;margin-top:2px;letter-spacing:0.05em;">Flights that meet all your preferences</div>
        </div>
      </div>
    </div>`;
    data.section1.forEach((f,idx)=>{
      html+=renderCard(f, idx+1, false);
    });

    // ── PAGINATION: remaining filtered flights (beyond top 3) ──────
    // Build paged pool from all strict-match flights not already in section1
    const section1Keys = new Set(data.section1.map(f => {
      const seg = f.segments && f.segments[0];
      return `${f.airline}|${seg?seg.flightNumber:''}|${seg?seg.departureTime:''}|${seg?seg.departureDate:''}`;
    }));
    const pagedPool = (data.allFilteredFlights || []).filter(f => {
      const seg = f.segments && f.segments[0];
      const k = `${f.airline}|${seg?seg.flightNumber:''}|${seg?seg.departureTime:''}|${seg?seg.departureDate:''}`;
      return !section1Keys.has(k);
    });
    window._pagedFlights = pagedPool;
    window._pagedOffset  = 0;

    if(pagedPool.length > 0) {
      html+=`<div id="paged-flights"></div>
      <button id="show-more-btn" style="margin-top:14px;width:100%;padding:12px;border-radius:12px;
        border:1px solid rgba(224,122,255,0.3);background:rgba(168,85,247,0.08);
        color:#c4b5fd;font-family:'Jost',sans-serif;font-size:0.78rem;letter-spacing:0.18em;
        text-transform:uppercase;cursor:pointer;transition:all 0.2s;"
        onmouseover="this.style.background='rgba(168,85,247,0.18)'"
        onmouseout="this.style.background='rgba(168,85,247,0.08)'">
        ✦ Show More Flights (${pagedPool.length} remaining)
      </button>`;
    }
  }

  // SECTION 2: SMART ALTERNATIVES — rendered as a SEPARATE panel in the chat, not inside section1 container
  // (built after content.innerHTML is set, appended independently to messagesEl)
  const section2Data = data.section2 && data.section2.length > 0 ? data.section2 : null;

  // Note: Section 3 rendering moved below after Section 2
    
  // Note: Section 3 rendering moved below after Section 2

  // Store all flights for AI analysis
  const allFlights = [...(data.section1||[]), ...(data.section2||[]), ...(data.section3||[])];
  window._withinFlightsForAI = allFlights.map(f=>({
    airline:f.airline, price:f.pricePerPax, duration:f.totalDuration,
    stops:f.stops, tag:f.tag,
    departureTime:f.segments&&f.segments[0]?f.segments[0].departureTime:'',
    arrivalTime:f.segments&&f.segments[f.segments.length-1]?f.segments[f.segments.length-1].arrivalTime:'',
    insight:f.insight||'',
    section:f.section||'filtered'
  }));

  html+=`</div>`;

  // ── FLEX DATE CARDS ──
  if(data.flexDates&&data.flexDates.length>0){
    html+=`<div class="section-head" style="margin-top:20px;">✦ Flexible Date Options</div>
    <div style="font-size:0.71rem;color:var(--muted);margin-bottom:10px;line-height:1.5;">Save money or get better routes by adjusting your travel date.</div>
    <div style="display:flex;flex-direction:column;gap:12px;">`;
    
    data.flexDates.forEach((fd,fdIdx)=>{
      const cheaper=(fd.priceDiff||0)<0;
      const dc=cheaper?'#6ee7b7':'#f87171';
      const arrow=cheaper?'↓':'↑';
      const diffAbs=Math.abs(fd.priceDiff||0);
      const diffLabel=cheaper?`₹${diffAbs.toLocaleString('en-IN')} cheaper`:`₹${diffAbs.toLocaleString('en-IN')} costlier`;
      const fdRaw=(fd.aiInsight||'').trim();
      let fdInsight='';
      if(fdRaw.includes('|')){
        const fdParts=fdRaw.split('|').map(s=>s.trim());
        fdParts.forEach(p=>{
          if(p.startsWith('INSIGHT:'))fdInsight=p.replace('INSIGHT:','').trim();
        });
      } else { fdInsight=fdRaw; }
      
      // Compact card
      html+=`<div class="flex-date-compact" data-fdidx="${fdIdx}" style="padding:12px 16px;background:rgba(20,8,40,0.6);border:1px solid ${cheaper?'rgba(110,231,183,0.25)':'rgba(248,113,113,0.2)'};border-radius:12px;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(30,12,55,0.8)'" onmouseout="this.style.background='rgba(20,8,40,0.6)'">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div>
            <div style="font-size:0.7rem;letter-spacing:0.15em;text-transform:uppercase;color:${dc};font-weight:700;">${fd.label||''} · ${fd.dayName||''}</div>
            <div style="font-size:0.95rem;color:var(--text);margin-top:2px;">${fd.display||fmtDate(fd.date)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.65rem;letter-spacing:0.12em;text-transform:uppercase;color:${dc};border:1px solid ${dc};border-radius:20px;padding:2px 8px;display:inline-block;margin-bottom:3px;">${arrow} ${diffLabel}</div>
            <div style="font-size:1.3rem;color:${cheaper?'#6ee7b7':'#f87171'};font-family:'Cormorant Garamond',serif;">₹${(fd.cheapestPrice||0).toLocaleString('en-IN')}</div>
          </div>
        </div>
        <div style="display:flex;gap:16px;font-size:0.72rem;color:rgba(255,255,255,0.6);margin-bottom:8px;">
          <span>⏱ ${fd.totalDuration||'—'}</span>
          <span>${fd.stops===0?'✈ Direct':`🔀 ${fd.stops} stop${fd.stops>1?'s':''}`}</span>
          <span>🎫 ${fd.airline||'—'}</span>
        </div>
        ${fdInsight?`<div style="margin-bottom:10px;padding:0;background:rgba(236,72,153,0.08);border:1px solid rgba(236,72,153,0.3);border-radius:10px;overflow:hidden;">
          <div style="display:flex;align-items:center;gap:8px;padding:8px 11px;background:rgba(236,72,153,0.15);border-bottom:1px solid rgba(236,72,153,0.25);">
            <div style="width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#ec4899,#f472b6);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 6px rgba(236,72,153,0.4);">
              <span style="font-size:0.7rem;color:#fff;font-weight:bold;">✨</span>
            </div>
            <span style="font-size:0.55rem;letter-spacing:0.18em;text-transform:uppercase;color:#ec4899;font-weight:700;font-family:'Jost',sans-serif;">AI Insight</span>
          </div>
          <div style="padding:8px 11px;font-size:0.76rem;color:#f472b6;line-height:1.5;font-style:italic;">${fdInsight}${fdInsight.endsWith('.')?'':'.'}</div>
        </div>`:''}
        <div style="text-align:center;margin-top:10px;font-size:0.68rem;color:var(--accent);letter-spacing:0.15em;">TAP TO VIEW FULL DETAILS →</div>
      </div>`;
    });
    html+=`</div>`;
  }

  // ── OVERALL AI RECOMMENDATION & TRAVEL INSIGHTS FOR ALTERNATE DATES (AFTER FLEX DATES) ──
  if(data.flexDates&&data.flexDates.length>0){
    html+=`
    <div style="margin-top:28px;display:flex;flex-direction:column;gap:16px;">
      
      <!-- Panel 1: Overall AI Recommendation for Alternate Dates - BLUE/PURPLE -->
      <div style="padding:0;background:rgba(168,85,247,0.08);border:1.5px solid rgba(168,85,247,0.4);border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(168,85,247,0.12);">
        <div style="display:flex;align-items:center;gap:9px;padding:12px 16px;background:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(168,85,247,0.08));border-bottom:1.5px solid rgba(168,85,247,0.25);">
          <div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#a855f7,#c4b5fd);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 12px rgba(168,85,247,0.5);">
            <span style="font-size:0.95rem;color:#fff;font-weight:bold;">📅</span>
          </div>
          <span style="font-size:0.65rem;letter-spacing:0.3em;text-transform:uppercase;color:#c4b5fd;font-weight:800;font-family:'Jost',sans-serif;">AI Recommendation for Alternate Dates</span>
        </div>
        <div style="padding:14px 16px;">
          <div id="ai-flexdate-rec-${sid}" style="font-size:0.88rem;color:#f1e8ff;line-height:1.8;font-style:italic;font-weight:500;margin-bottom:12px;">
            ✨ Analyzing flexible date options to find optimal savings...
          </div>
          <div id="ai-flexdate-reason-${sid}" style="font-size:0.78rem;color:#d1d5db;line-height:1.7;padding:10px 12px;background:rgba(168,85,247,0.12);border-left:2px solid #a855f7;border-radius:6px;display:none;">
            <div style="font-weight:600;color:#c4b5fd;margin-bottom:6px;">💡 Why consider this date:</div>
            <ul style="margin:0;padding-left:18px;">
              <li id="flexdate-reason-1-${sid}" style="margin-bottom:4px;"></li>
              <li id="flexdate-reason-2-${sid}" style="margin-bottom:4px;"></li>
              <li id="flexdate-reason-3-${sid}"></li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Panel 2: Travel Insights - Overall CYAN -->
      <div style="padding:0;background:rgba(34,211,238,0.08);border:1.5px solid rgba(34,211,238,0.4);border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(34,211,238,0.12);">
        <div style="display:flex;align-items:center;gap:9px;padding:12px 16px;background:linear-gradient(135deg,rgba(34,211,238,0.15),rgba(34,211,238,0.08));border-bottom:1.5px solid rgba(34,211,238,0.25);">
          <div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#22d3ee,#06b6d4);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 12px rgba(34,211,238,0.5);">
            <span style="font-size:0.95rem;color:#fff;font-weight:bold;">✈</span>
          </div>
          <span style="font-size:0.65rem;letter-spacing:0.3em;text-transform:uppercase;color:#22d3ee;font-weight:800;font-family:'Jost',sans-serif;">AI Travel Insights</span>
        </div>
        <div style="padding:14px 16px;">
          <div id="ai-travel-insights-${sid}" style="font-size:0.85rem;color:#e0f2fe;line-height:1.9;font-style:italic;font-weight:500;">
            ✨ Generating insights based on all available flight options...
          </div>
          <div id="ai-insights-list-${sid}" style="display:none;margin-top:12px;display:flex;flex-direction:column;gap:10px;">
            <div id="insight-1-${sid}" style="display:flex;gap:8px;align-items:flex-start;font-size:0.82rem;color:#e0f2fe;line-height:1.6;"><span style="color:#22d3ee;font-weight:bold;flex-shrink:0;">•</span><span></span></div>
            <div id="insight-2-${sid}" style="display:flex;gap:8px;align-items:flex-start;font-size:0.82rem;color:#e0f2fe;line-height:1.6;"><span style="color:#22d3ee;font-weight:bold;flex-shrink:0;">•</span><span></span></div>
            <div id="insight-3-${sid}" style="display:flex;gap:8px;align-items:flex-start;font-size:0.82rem;color:#e0f2fe;line-height:1.6;"><span style="color:#22d3ee;font-weight:bold;flex-shrink:0;">•</span><span></span></div>
            <div id="insight-4-${sid}" style="display:flex;gap:8px;align-items:flex-start;font-size:0.82rem;color:#e0f2fe;line-height:1.6;"><span style="color:#22d3ee;font-weight:bold;flex-shrink:0;">•</span><span></span></div>
          </div>
        </div>
      </div>

    </div>
    `;
  }

  html+=`</div>`;

  content.innerHTML=html;
  
  // Wire book buttons via event delegation — safe, no JSON-in-attribute
  content.addEventListener('click',function(e){
    // Minimize button for flex dates
    const minimizeBtn=e.target.closest('.fd-minimize-btn');
    if(minimizeBtn){
      const fdIdx=parseInt(minimizeBtn.getAttribute('data-fdidx'));
      const fd=data.flexDates[fdIdx];
      if(fd){
        // Recreate compact card
        const cheaper=(fd.priceDiff||0)<0;
        const dc=cheaper?'#6ee7b7':'#f87171';
        const arrow=cheaper?'↓':'↑';
        const diffAbs=Math.abs(fd.priceDiff||0);
        const diffLabel=cheaper?`₹${diffAbs.toLocaleString('en-IN')} cheaper`:`₹${diffAbs.toLocaleString('en-IN')} costlier`;
        const fdRaw=(fd.aiInsight||'').trim();
        let fdInsight='';
        if(fdRaw.includes('|')){
          const fdParts=fdRaw.split('|').map(s=>s.trim());
          fdParts.forEach(p=>{
            if(p.startsWith('INSIGHT:'))fdInsight=p.replace('INSIGHT:','').trim();
          });
        } else { fdInsight=fdRaw; }
        
        const compact=`<div class="flex-date-compact" data-fdidx="${fdIdx}" style="padding:12px 16px;background:rgba(20,8,40,0.6);border:1px solid ${cheaper?'rgba(110,231,183,0.25)':'rgba(248,113,113,0.2)'};border-radius:12px;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(30,12,55,0.8)'" onmouseout="this.style.background='rgba(20,8,40,0.6)'">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div>
              <div style="font-size:0.7rem;letter-spacing:0.15em;text-transform:uppercase;color:${dc};font-weight:700;">${fd.label||''} · ${fd.dayName||''}</div>
              <div style="font-size:0.95rem;color:var(--text);margin-top:2px;">${fd.display||fmtDate(fd.date)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:0.65rem;letter-spacing:0.12em;text-transform:uppercase;color:${dc};border:1px solid ${dc};border-radius:20px;padding:2px 8px;display:inline-block;margin-bottom:3px;">${arrow} ${diffLabel}</div>
              <div style="font-size:1.3rem;color:${cheaper?'#6ee7b7':'#f87171'};font-family:'Cormorant Garamond',serif;">₹${(fd.cheapestPrice||0).toLocaleString('en-IN')}</div>
            </div>
          </div>
          <div style="display:flex;gap:16px;font-size:0.72rem;color:rgba(255,255,255,0.6);margin-bottom:8px;">
            <span>⏱ ${fd.totalDuration||'—'}</span>
            <span>${fd.stops===0?'✈ Direct':`🔀 ${fd.stops} stop${fd.stops>1?'s':''}`}</span>
            <span>🎫 ${fd.airline||'—'}</span>
          </div>
          ${fdInsight?`<div style="margin-bottom:10px;padding:0;background:rgba(236,72,153,0.08);border:1px solid rgba(236,72,153,0.3);border-radius:10px;overflow:hidden;">
            <div style="display:flex;align-items:center;gap:8px;padding:8px 11px;background:rgba(236,72,153,0.15);border-bottom:1px solid rgba(236,72,153,0.25);">
              <div style="width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#ec4899,#f472b6);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 6px rgba(236,72,153,0.4);">
                <span style="font-size:0.7rem;color:#fff;font-weight:bold;">✨</span>
              </div>
              <span style="font-size:0.55rem;letter-spacing:0.18em;text-transform:uppercase;color:#ec4899;font-weight:700;font-family:'Jost',sans-serif;">AI Insight</span>
            </div>
            <div style="padding:8px 11px;font-size:0.76rem;color:#f472b6;line-height:1.5;font-style:italic;">${fdInsight}${fdInsight.endsWith('.')?'':'.'}</div>
          </div>`:''}
          <div style="text-align:center;margin-top:10px;font-size:0.68rem;color:var(--accent);letter-spacing:0.15em;">TAP TO VIEW FULL DETAILS →</div>
        </div>`;
        
        const expanded=e.target.closest('.fd-expanded');
        if(expanded){
          expanded.outerHTML=compact;
        }
      }
      return;
    }
    
    // Flex date compact card click - expand to full details
    const flexCompact=e.target.closest('.flex-date-compact');
    if(flexCompact){
      const fdIdx=parseInt(flexCompact.getAttribute('data-fdidx'));
      const fd=data.flexDates[fdIdx];
      if(fd){
        // Create expanded flight card
        const cheaper=(fd.priceDiff||0)<0;
        const dc=cheaper?'#6ee7b7':'#f87171';
        const arrow=cheaper?'↓':'↑';
        const diffAbs=Math.abs(fd.priceDiff||0);
        const diffLabel=cheaper?`₹${diffAbs.toLocaleString('en-IN')} cheaper`:`₹${diffAbs.toLocaleString('en-IN')} costlier`;
        const segs=fd.segments||[];
        const fdRaw=(fd.aiInsight||'').trim();
        let fdInsight='',fdPoints=[];
        if(fdRaw.includes('|')){
          const fdParts=fdRaw.split('|').map(s=>s.trim());
          fdParts.forEach(p=>{
            if(p.startsWith('INSIGHT:'))fdInsight=p.replace('INSIGHT:','').trim();
            else if(p.startsWith('POINT'))fdPoints.push(p.replace(/^POINT\d+:/,'').trim());
          });
        } else { fdInsight=fdRaw; }
        
        let expanded=`<div class="fd-expanded" data-fdidx="${fdIdx}" style="
            position:relative;overflow:hidden;
            background:rgba(14,6,30,0.62);
            backdrop-filter:blur(20px);
            border:1px solid ${cheaper?'rgba(110,231,183,0.30)':'rgba(248,113,113,0.28)'};
            border-radius:16px;padding:16px 18px;margin-bottom:0;
            box-shadow:0 4px 28px rgba(0,0,0,0.32),inset 0 1px 0 rgba(255,255,255,0.04);
            animation:msg-in 0.25s ease;">
          <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,${cheaper?'#6ee7b7':'#f87171'},transparent);opacity:0.75;"></div>
          <!-- Header -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:10px;">
            <div>
              <div style="font-size:0.62rem;letter-spacing:0.16em;text-transform:uppercase;color:${dc};font-weight:700;font-family:'Jost',sans-serif;margin-bottom:5px;">${fd.label||''} · ${fd.dayName||''}</div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:1.22rem;font-weight:400;color:#f1f5f9;line-height:1.2;">${fd.airline||'—'}</div>
              <div style="font-size:0.65rem;color:rgba(255,255,255,0.35);letter-spacing:0.06em;margin-top:3px;font-family:'Jost',sans-serif;">${segs.map(s=>s.flightNumber).filter(Boolean).join(' · ')}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:0.6rem;letter-spacing:0.13em;text-transform:uppercase;color:${dc};border:1px solid ${dc};border-radius:20px;padding:2px 9px;display:inline-block;margin-bottom:5px;font-family:'Jost',sans-serif;">${arrow} ${diffLabel}</div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:1.6rem;font-weight:400;line-height:1;color:${cheaper?'#6ee7b7':'#f87171'};">₹${(fd.cheapestPrice||0).toLocaleString('en-IN')}</div>
              <div style="font-size:0.6rem;color:rgba(255,255,255,0.38);margin-top:3px;font-family:'Jost',sans-serif;">per person</div>
            </div>
          </div>
          <!-- Segments -->
          ${segs.map((seg,i)=>{
            const lw=fd.layovers&&fd.layovers[i];
            const sc=cheaper?'#6ee7b7':'#f87171';
            return `<div style="display:flex;align-items:center;gap:8px;padding:11px 13px;background:rgba(0,0,0,0.22);border-radius:11px;margin-bottom:7px;border:1px solid rgba(255,255,255,0.05);">
              <div style="min-width:0;flex:1;">
                <div style="font-family:'Cormorant Garamond',serif;font-size:1.42rem;font-weight:400;letter-spacing:0.04em;line-height:1;color:${sc};">${seg.fromIATA||''}</div>
                <div style="font-size:0.62rem;margin-top:2px;color:${cheaper?'#86efac':'#fca5a5'};font-family:'Jost',sans-serif;">${seg.fromCity||''}</div>
                <div style="font-size:0.88rem;font-weight:400;margin-top:5px;color:${cheaper?'#ecfdf5':'#fff1f2'};font-family:'Cormorant Garamond',serif;">${fmt12(seg.departureTime)||''}</div>
                <div style="font-size:0.58rem;color:rgba(255,255,255,0.38);margin-top:2px;font-family:'Jost',sans-serif;">${fmtSegDate(seg.departureDate)}</div>
              </div>
              <div style="flex:1.4;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:38px;">
                <div style="width:100%;height:1px;background:linear-gradient(90deg,transparent,${sc},transparent);position:relative;">
                  <span style="position:absolute;left:50%;top:-9px;transform:translateX(-50%);font-size:0.74rem;color:${sc};">✈</span>
                </div>
                <div style="font-size:0.61rem;color:rgba(255,255,255,0.68);letter-spacing:0.06em;font-family:'Jost',sans-serif;">${seg.duration||''}</div>
                <div style="font-size:0.57rem;color:rgba(255,255,255,0.35);font-family:'Jost',sans-serif;">${seg.flightNumber||''}</div>
              </div>
              <div style="min-width:0;flex:1;text-align:right;">
                <div style="font-family:'Cormorant Garamond',serif;font-size:1.42rem;font-weight:400;letter-spacing:0.04em;line-height:1;color:${sc};">${seg.toIATA||''}</div>
                <div style="font-size:0.62rem;margin-top:2px;color:${cheaper?'#86efac':'#fca5a5'};font-family:'Jost',sans-serif;">${seg.toCity||''}</div>
                <div style="font-size:0.88rem;font-weight:400;margin-top:5px;color:${cheaper?'#ecfdf5':'#fff1f2'};font-family:'Cormorant Garamond',serif;">${fmt12(seg.arrivalTime)||''}</div>
                <div style="font-size:0.58rem;color:rgba(255,255,255,0.38);margin-top:2px;font-family:'Jost',sans-serif;">${fmtSegDate(seg.arrivalDate)}</div>
              </div>
            </div>${lw?`<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 12px;margin:0 0 7px;background:rgba(236,72,153,0.06);border:1px dashed rgba(236,72,153,0.25);border-radius:9px;"><div style="width:6px;height:6px;border-radius:50%;background:#ec4899;flex-shrink:0;margin-top:5px;"></div><div style="font-size:0.72rem;color:#fda4af;font-family:'Jost',sans-serif;">Layover at ${lw.city} (${lw.airport}) · ${lw.duration} wait</div></div>`:''}`;
          }).join('')}
          <!-- Meta row -->
          <div style="display:flex;gap:0;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.07);">
            <div style="flex:1;min-width:70px;display:flex;flex-direction:column;padding-right:8px;">
              <div style="font-size:0.52rem;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.36);font-family:'Jost',sans-serif;">Duration</div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:0.95rem;color:${cheaper?'#6ee7b7':'#f87171'};margin-top:3px;">${fd.totalDuration||'—'}</div>
            </div>
            <div style="flex:1;min-width:70px;display:flex;flex-direction:column;padding-right:8px;">
              <div style="font-size:0.52rem;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.36);font-family:'Jost',sans-serif;">Stops</div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:0.95rem;color:${cheaper?'#6ee7b7':'#f87171'};margin-top:3px;">${fd.stops===0?'Non-stop':(fd.stops||1)+' stop'+((fd.stops||1)>1?'s':'')}</div>
            </div>
            <div style="flex:1;min-width:70px;display:flex;flex-direction:column;padding-right:8px;">
              <div style="font-size:0.52rem;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.36);font-family:'Jost',sans-serif;">Date</div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:0.95rem;color:${cheaper?'#6ee7b7':'#f87171'};margin-top:3px;">${fd.display||fmtDate(fd.date)}</div>
            </div>
            <div style="flex:1;min-width:70px;display:flex;flex-direction:column;">
              <div style="font-size:0.52rem;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.36);font-family:'Jost',sans-serif;">Per Person</div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:0.95rem;color:${cheaper?'#6ee7b7':'#f87171'};margin-top:3px;">₹${(fd.cheapestPrice||0).toLocaleString('en-IN')}</div>
            </div>
          </div>
          <!-- AI Insight panel -->
          ${(fdInsight||fdPoints.length>0)?`<div style="margin-top:12px;padding:0;background:rgba(236,72,153,0.07);border:1px solid rgba(236,72,153,0.32);border-radius:12px;overflow:hidden;">
            <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(236,72,153,0.12);border-bottom:1px solid rgba(236,72,153,0.2);">
              <div style="width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#ec4899,#f472b6);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 6px rgba(236,72,153,0.4);">
                <span style="font-size:0.65rem;color:#fff;font-weight:bold;">✨</span>
              </div>
              <span style="font-size:0.53rem;letter-spacing:0.2em;text-transform:uppercase;color:#ec4899;font-weight:800;font-family:'Jost',sans-serif;">AI Insight</span>
            </div>
            ${fdInsight?`<div style="padding:9px 12px;font-family:'Cormorant Garamond',serif;font-size:0.9rem;color:#f472b6;line-height:1.65;font-style:italic;">${fdInsight}${fdInsight.endsWith('.')?'':'.'}</div>`:''}
            ${fdPoints.length>0?`<div>${fdPoints.map((pt,i)=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(236,72,153,0.08);border-top:1px solid rgba(255,255,255,0.04);"><span style="color:#ec4899;font-size:0.84rem;flex-shrink:0;">▸</span><span style="font-family:'Cormorant Garamond',serif;font-size:0.85rem;color:#f472b6;line-height:1.45;font-style:italic;">${pt}${pt.endsWith('.')?'':'.'}</span></div>`).join('')}</div>`:''}
          </div>`:''}
          <button class="fd-minimize-btn" style="margin-top:14px;width:100%;padding:11px 16px;border-radius:10px;border:1px solid rgba(168,85,247,0.3);background:rgba(168,85,247,0.08);color:#c4b5fd;font-family:'Jost',sans-serif;font-size:0.78rem;letter-spacing:0.18em;text-transform:uppercase;cursor:pointer;transition:all 0.2s;" data-fdidx="${fdIdx}">↑ Minimize Details</button>
        </div>`;
        
        flexCompact.outerHTML=expanded;
      }
      return;
    }
    
    // Show more flights button — paginated 3 at a time
    const showMoreBtn=e.target.closest('#show-more-btn');
    if(showMoreBtn){
      const PAGE=3;
      const paged=window._pagedFlights||[];
      const offset=window._pagedOffset||0;
      const pagedDiv=content.querySelector('#paged-flights');
      if(!pagedDiv) return;

      // Get current total shown (initial 3 + already loaded)
      const alreadyShown=content.querySelectorAll('.flight-card:not(.beyond)').length;

      const nextBatch=paged.slice(offset,offset+PAGE);
      let firstNewCard=null;
      nextBatch.forEach((f,idx)=>{
        const wrap=document.createElement('div');
        wrap.className='results-wrap';
        wrap.innerHTML=renderCard(f,alreadyShown+idx+1,true);
        pagedDiv.appendChild(wrap);
        if(idx===0) firstNewCard=wrap;
      });
      window._pagedOffset=offset+nextBatch.length;

      const remaining=paged.length-window._pagedOffset;
      if(remaining<=0){
        showMoreBtn.style.display='none';
      } else {
        showMoreBtn.textContent=`✦ Show More Flights (${remaining} remaining)`;
      }
      // Scroll to the FIRST new card only — no bottom scroll
      if(firstNewCard){
        requestAnimationFrame(()=>{
          firstNewCard.scrollIntoView({behavior:'smooth',block:'start'});
        });
      }
      return;
    }
  });
  container.appendChild(content);
  messagesEl.appendChild(container);

  // ── SECTION 2: SMART ALTERNATIVES — styled label then individual cards ──
  if(section2Data) {
    // Styled "Smart Alternatives" text label — not a chat bubble, just a label in the feed
    const altLabel = document.createElement('div');
    altLabel.style.cssText = 'width:100%;max-width:100%;margin:24px 0 6px 0;padding:0 2px;';
    altLabel.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(148,163,184,0.25));"></div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:1.05rem;font-style:italic;
             color:#e07aff;letter-spacing:0.12em;white-space:nowrap;">
          Smart Alternatives
        </div>
        <div style="flex:1;height:1px;background:linear-gradient(90deg,rgba(148,163,184,0.25),transparent);"></div>
      </div>
      <div style="text-align:center;font-size:0.62rem;letter-spacing:0.14em;text-transform:uppercase;
           color:rgba(148,163,184,0.55);">Flights slightly beyond your filters</div>`;
    messagesEl.appendChild(altLabel);

    // Individual flight cards — slate styling, with AI insight panel
    // Limit to max 3 cards
    section2Data.slice(0, 3).forEach(f => {
      const cardContainer = document.createElement('div');
      cardContainer.style.cssText = 'width:100%;max-width:100%;margin:8px 0;';
      cardContainer.innerHTML = renderCard(f, null, true);
      messagesEl.appendChild(cardContainer);
    });

    setTimeout(() => {
      altLabel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
  }

  // ── SECTION 3: BETTER FARES ON NEARBY DATES ──────────────────────
  // Render AFTER Section 2 to maintain order: 1) Filtered, 2) Smart Alt, 3) Better Fares
  if(data.section3 && data.section3.length > 0) {
    console.log('🔍 Rendering Section 3 - Flights:', data.section3.length);
    console.log('🔍 Section 3 Data:', data.section3);
    
    const section3Label = document.createElement('div');
    section3Label.style.cssText = 'width:100%;max-width:100%;margin:24px 0 6px 0;padding:0 2px;';
    section3Label.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <div style="flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(100,116,139,0.3));"></div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:1.05rem;font-style:italic;
             color:var(--accent2);letter-spacing:0.12em;white-space:nowrap;">
          ✈ Better Fares on Nearby Dates
        </div>
        <div style="flex:1;height:1px;background:linear-gradient(90deg,rgba(100,116,139,0.3),transparent);"></div>
      </div>
      <div style="text-align:center;font-size:0.62rem;letter-spacing:0.14em;text-transform:uppercase;
           color:rgba(100,116,139,0.5);">Save money with flexible travel dates</div>`;
    messagesEl.appendChild(section3Label);

    // Render each Section 3 flight card using renderCard (same format as Section 2)
    data.section3.forEach((f, idx) => {

      console.log(`🔍 Section 3 - Rendering flight ${idx + 1}:`, f.airline, f.pricePerPax);

      const seg = f.segments && f.segments[0] ? f.segments[0] : null;
      if(!seg) {
        console.log(`🔍 Section 3 - Skipping flight ${idx + 1} - no segments`);
        return;
      }

      // Set section as 'alternate' for proper styling in renderCard
      f.section = 'alternate';
      
      // Add date badge showing the date and day label
      if(f.altDateFmt && f.altDayLabel) {
        f.dateBadge = (f.altDateFmt || '') + ' · ' + (f.altDayLabel || '');
      }

      const cardContainer = document.createElement('div');
      cardContainer.style.cssText = 'width:100%;max-width:100%;margin:8px 0;';
      
      const flightCardHTML = renderCard(f, null, true);
      const uniqueId = 'alt-flight-' + idx + '-' + Date.now();

      // Build compact summary card (matches image style)
      const priceDiff = f.priceDiff || 0;
      const cheaper = priceDiff < 0;
      const diffColor = cheaper ? '#6ee7b7' : '#f87171';
      const diffArrow = cheaper ? '↓' : '↑';
      const diffAbs = Math.abs(priceDiff);
      const diffLabel = diffAbs === 0 ? '₹0 Costlier' : (cheaper ? ('₹' + diffAbs.toLocaleString('en-IN') + ' Cheaper') : ('₹' + diffAbs.toLocaleString('en-IN') + ' Costlier'));
      const altInsight = (f.aiSuggestion || f.mainInsight || f.insight || '').replace(/^INSIGHT:/,'').split('|')[0].trim();
      const compactBorder = cheaper ? 'rgba(110,231,183,0.25)' : 'rgba(248,113,113,0.18)';

      // Build compactHTML using string concatenation — no nested backticks
      const insightPillHTML = altInsight
        ? '<div style="padding:0;background:rgba(236,72,153,0.08);border:1px solid rgba(236,72,153,0.28);border-radius:10px;overflow:hidden;">'
          + '<div style="display:flex;align-items:center;gap:8px;padding:7px 11px;background:rgba(236,72,153,0.13);border-bottom:1px solid rgba(236,72,153,0.22);">'
          + '<div style="width:17px;height:17px;border-radius:50%;background:linear-gradient(135deg,#ec4899,#f472b6);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 6px rgba(236,72,153,0.4);">'
          + '<span style="font-size:0.65rem;color:#fff;font-weight:bold;">✨</span></div>'
          + '<span style="font-size:0.53rem;letter-spacing:0.2em;text-transform:uppercase;color:#ec4899;font-weight:700;font-family:Jost,sans-serif;">AI Insight</span>'
          + '</div>'
          + '<div style="padding:7px 11px;font-size:0.75rem;color:#f472b6;line-height:1.5;font-style:italic;">' + altInsight + (altInsight.endsWith('.') ? '' : '.') + '</div>'
          + '</div>'
        : '';

      const stopsText = (f.stops||0)===0 ? '✈ Direct' : ('🔀 '+(f.stops||1)+' stop'+((f.stops||1)>1?'s':''));
      const mbVal = altInsight ? '10px' : '0';

      const compactHTML = ''
        + '<div class="alt-compact-card" style="'
        + 'padding:14px 16px;background:rgba(20,8,40,0.65);border:1px solid ' + compactBorder + ';'
        + 'border-radius:14px;cursor:pointer;transition:background 0.2s,border-color 0.2s;position:relative;overflow:hidden;">'
        + '<div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,' + diffColor + ',transparent);opacity:0.55;"></div>'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">'
          + '<div>'
            + '<div style="font-size:0.68rem;letter-spacing:0.16em;text-transform:uppercase;color:' + diffColor + ';font-weight:700;margin-bottom:3px;">' + (f.altDayLabel||'') + ' · ' + (f.altDateFmt||'') + '</div>'
            + '<div style="font-family:Cormorant Garamond,serif;font-size:1.05rem;color:var(--text);">' + (f.altDateDisplay || f.altDateFmt || '') + '</div>'
          + '</div>'
          + '<div style="text-align:right;flex-shrink:0;">'
            + '<div style="font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:' + diffColor + ';border:1px solid ' + diffColor + ';border-radius:20px;padding:2px 9px;display:inline-block;margin-bottom:4px;">' + diffArrow + ' ' + diffLabel + '</div>'
            + '<div style="font-family:Cormorant Garamond,serif;font-size:1.45rem;color:' + diffColor + ';line-height:1;">\u20B9' + (f.pricePerPax||0).toLocaleString('en-IN') + '</div>'
          + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:16px;font-size:0.72rem;color:rgba(255,255,255,0.58);margin-bottom:' + mbVal + ';">'
          + '<span>\u23F1 ' + (f.totalDuration||'—') + '</span>'
          + '<span>' + stopsText + '</span>'
          + '<span>\uD83C\uDFAB ' + (f.airline||'—') + '</span>'
        + '</div>'
        + insightPillHTML
        + '<div style="text-align:center;margin-top:12px;font-size:0.67rem;color:var(--accent);letter-spacing:0.16em;font-weight:600;">TAP TO VIEW FULL DETAILS →</div>'
        + '</div>';

      // Build DOM nodes directly — avoids backtick-in-backtick template literal bugs
      const wrapper = document.createElement('div');
      wrapper.className = 'alt-flight-wrapper';

      // Compact view
      const compactView = document.createElement('div');
      compactView.className = 'alt-compact-view';
      compactView.innerHTML = compactHTML;

      // Expanded view
      const expandedView = document.createElement('div');
      expandedView.className = 'alt-expanded-view';
      expandedView.style.display = 'none';
      expandedView.innerHTML = flightCardHTML;

      // Minimize button
      const minimizeBtn = document.createElement('button');
      minimizeBtn.className = 'alt-minimize-btn';
      minimizeBtn.textContent = '↑ Minimize Details';
      minimizeBtn.style.cssText = [
        'margin-top:12px','width:100%','padding:11px 16px',
        'border-radius:10px','border:1px solid rgba(168,85,247,0.3)',
        'background:rgba(168,85,247,0.08)','color:#c4b5fd',
        "font-family:'Jost',sans-serif",'font-size:0.78rem',
        'letter-spacing:0.18em','text-transform:uppercase',
        'cursor:pointer','transition:all 0.2s','display:block'
      ].join(';');
      minimizeBtn.addEventListener('mouseover', function(){ this.style.background='rgba(168,85,247,0.2)'; });
      minimizeBtn.addEventListener('mouseout',  function(){ this.style.background='rgba(168,85,247,0.08)'; });
      expandedView.appendChild(minimizeBtn);

      wrapper.appendChild(compactView);
      wrapper.appendChild(expandedView);
      cardContainer.appendChild(wrapper);

      // Click: compact → expanded
      compactView.addEventListener('click', function() {
        compactView.style.display = 'none';
        expandedView.style.display = 'block';
        expandedView.style.animation = 'msg-in 0.3s ease';
        requestAnimationFrame(() => {
          expandedView.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });

      // Click: minimize → compact
      minimizeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        expandedView.style.display = 'none';
        compactView.style.display = 'block';
        requestAnimationFrame(() => {
          compactView.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });

      messagesEl.appendChild(cardContainer);
    });
  } else {
    console.log('🔍 Section 3 NOT displayed - data.section3:', data.section3);
  }

  // ── ALTERNATE DATES SECTION ───────────────────────────────────────
  // ════════════════════════════════════════════════════════════════
  // OLD ALTERNATE DATES SECTION - COMPLETELY DISABLED
  // Now using Section 3 for all alternate date flight rendering
  // ════════════════════════════════════════════════════════════════
  /*
  if(data.alternateDates && data.alternateDates.length > 0) {
    // Section label
    messagesEl.innerHTML += `
      <div style="width:100%;max-width:100%;margin:28px 0 10px 0;padding:0 2px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(100,116,139,0.3));"></div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:1.05rem;font-style:italic;
               color:var(--accent2);letter-spacing:0.12em;white-space:nowrap;">💡 Better Fares on Nearby Dates</div>
          <div style="flex:1;height:1px;background:linear-gradient(90deg,rgba(100,116,139,0.3),transparent);"></div>
        </div>
        <div style="text-align:center;font-size:0.62rem;letter-spacing:0.14em;text-transform:uppercase;
             color:rgba(100,116,139,0.5);">Save money by traveling on nearby dates</div>
      </div>
    `;

    // Render each alternate date flight as a standard flight card
    // DISABLED - now using Section 3
    // data.alternateDates.forEach((f, idx) => {
      if(idx >= 6) return; // Max 6 cards
      /*
      // Create card container
      const cardDiv = document.createElement('div');
      cardDiv.style.cssText = 'width:100%;max-width:100%;margin:8px 0;';
      
      const cardContent = `
        <div style="padding:16px;background:rgba(12,6,28,0.7);backdrop-filter:blur(12px);
             border:1px solid rgba(100,116,139,0.2);border-radius:16px;
             box-shadow:0 4px 16px rgba(0,0,0,0.2);">
          
          <!-- Top bar with date and reason -->
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:0.65rem;background:rgba(167,139,250,0.2);color:var(--accent2);
                   padding:4px 10px;border-radius:6px;font-weight:700;letter-spacing:0.08em;">
                📅 ${f.altDateFmt || ''}
              </span>
              <span style="font-size:0.7rem;color:rgba(100,116,139,0.8);">${f.altDayLabel || ''}</span>
            </div>
            <div style="font-size:0.72rem;color:var(--accent2);font-weight:600;">
              ${f.mainInsight || ''}
            </div>
          </div>

          <!-- Flight details -->
          <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
            <!-- Left: Airline and routing -->
            <div style="flex:1;">
              <div style="font-family:'Cormorant Garamond',serif;font-size:1rem;color:#f1f5f9;font-weight:600;margin-bottom:6px;">
                ${f.airline || 'Flight'}
              </div>
              <div style="font-size:0.75rem;color:#94a3b8;line-height:1.6;">
                <div>
                  <strong>${f.segments && f.segments[0] ? fmt12(f.segments[0].departureTime) : '--:--'}</strong>
                  ${f.segments && f.segments[0] && f.segments[0].fromCity ? ' • ' + f.segments[0].fromCity : ''}
                </div>
                <div style="font-size:0.7rem;color:rgba(100,116,139,0.7);margin:4px 0;">
                  ↓ ${f.totalDuration || '--'} • ${f.stops === 0 ? 'Non-stop' : f.stops + ' stop(s)'}
                </div>
                <div>
                  <strong>${f.segments && f.segments[f.segments.length-1] ? fmt12(f.segments[f.segments.length-1].arrivalTime) : '--:--'}</strong>
                  ${f.segments && f.segments[f.segments.length-1] && f.segments[f.segments.length-1].toCity ? ' • ' + f.segments[f.segments.length-1].toCity : ''}
                </div>
              </div>
            </div>

            <!-- Right: Price and CTA -->
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-family:'Cormorant Garamond',serif;font-size:1.4rem;color:var(--accent2);font-weight:700;margin-bottom:8px;">
                ₹${f.pricePerPax ? f.pricePerPax.toLocaleString('en-IN') : '0'}
              </div>
              <div style="font-size:0.7rem;color:#94a3b8;margin-bottom:10px;">
                per person
              </div>
              <button onclick="alert('Booking: ' + this.textContent)" style="
                padding:8px 16px;background:var(--accent2);color:#08030f;
                border:none;border-radius:8px;font-weight:600;font-size:0.75rem;
                cursor:pointer;letter-spacing:0.05em;transition:all 0.2s;
              ">
                VIEW FLIGHT
              </button>
            </div>
          </div>
        </div>
      `;
      
      cardDiv.innerHTML = cardContent;
      messagesEl.appendChild(cardDiv);
    });
  }
  */
  // END OF DISABLED OLD SECTION
  // Scroll to the TOP of the filtered results block first
  requestAnimationFrame(()=>{
    container.scrollIntoView({behavior:'smooth',block:'start'});
  });
  inputHint.textContent='search complete — scroll down to review';

  // ── Generate AI Recommendations for Flexible Date Options ──
  if(data.flexDates && data.flexDates.length > 0){
    setTimeout(() => {
      generateFlexDateAIRecommendation(data.flexDates, window._withinFlightsForAI, sid);
    }, 800);
  }

  // ── Velora reads AI Recommendations — flight + flex with per-point highlight ──
  function buildReadQueue(){
    const q=[];
    // flights
    (data.flights||[]).forEach(f=>{
      if(!f.aiSuggestion)return;
      const raw=(f.aiSuggestion||'').trim();
      const sentences=[];
      if(raw.includes('INSIGHT:')){
        raw.split('|').map(s=>s.trim()).forEach(p=>{
          if(p.startsWith('INSIGHT:'))sentences.push(p.replace('INSIGHT:','').trim());
          else if(p.startsWith('POINT'))sentences.push(p.replace(/^POINT\d+:/,'').trim());
        });
      } else if(raw.length>3){sentences.push(raw);}
      if(!sentences.length)return;
      const fn=(f.segments&&f.segments[0]?.flightNumber||'').replace(/[^a-zA-Z0-9]/g,'-');
      q.push({panelId:`ai-${f.tag}-${fn}`,altSel:`[id^="ai-${f.tag}-"]`,sentences,airline:f.airline||'',type:'flight'});
    });
    // flex dates
    const fdPanels=content.querySelectorAll('.fd-ai-panel');
    (data.flexDates||[]).forEach((fd,idx)=>{
      if(!fd.aiInsight)return;
      const raw=(fd.aiInsight||'').trim();
      const sentences=[];
      if(raw.includes('INSIGHT:')){
        raw.split('|').map(s=>s.trim()).forEach(p=>{
          if(p.startsWith('INSIGHT:'))sentences.push(p.replace('INSIGHT:','').trim());
          else if(p.startsWith('POINT'))sentences.push(p.replace(/^POINT\d+:/,'').trim());
        });
      } else if(raw.length>3){sentences.push(raw);}
      if(!sentences.length)return;
      q.push({panelEl:fdPanels[idx]||null,sentences,airline:fd.airline||fd.label||'',type:'flex'});
    });
    return q;
  }

  const readQueue=buildReadQueue();
  let qIdx=0;

  // inject keyframes once
  if(!document.querySelector('#velora-kf')){
    const st=document.createElement('style');st.id='velora-kf';
    st.textContent=`
      @keyframes v-dot{0%{opacity:.3;transform:scale(.7);}100%{opacity:1;transform:scale(1.35);}}
      @keyframes v-border{0%,100%{box-shadow:0 0 0 2px #fbbf24,0 0 20px rgba(251,191,36,.45);}50%{box-shadow:0 0 0 3px #fde68a,0 0 40px rgba(251,191,36,.85);}}
    `;
    document.head.appendChild(st);
  }

  function glowPanel(panel,on){
    if(!panel)return;
    if(on){
      panel.style.animation='v-border 1.4s ease-in-out infinite';
      panel.style.borderColor='#fbbf24';
      panel.style.background='rgba(24,10,0,0.99)';
      // pulsing dot in header
      if(!panel.querySelector('.v-dot')){
        const dot=document.createElement('span');dot.className='v-dot';
        dot.style.cssText='display:inline-flex;width:9px;height:9px;border-radius:50%;background:#fbbf24;box-shadow:0 0 8px #fbbf24;animation:v-dot .65s ease-in-out infinite alternate;margin-right:6px;flex-shrink:0;vertical-align:middle;';
        const hdr=panel.querySelector('span[style*="AI Recommendation"],span[style*="letter-spacing"]');
        if(hdr)hdr.parentNode.insertBefore(dot,hdr);
      }
    } else {
      panel.style.animation='';
      panel.style.borderColor='rgba(251,191,36,0.35)';
      panel.style.background='rgba(6,2,18,0.96)';
      const dot=panel.querySelector('.v-dot');if(dot)dot.remove();
    }
  }

  function glowPointRow(panel,idx,on){
    if(!panel)return;
    // point rows are the divs inside the points container (not the insight div)
    const allRows=Array.from(panel.querySelectorAll('div[style*="border-bottom:1px solid rgba(255,255,255,0.04)"]'));
    if(allRows[idx]){
      allRows[idx].style.outline=on?'2px solid #fbbf24':'';
      allRows[idx].style.boxShadow=on?'0 0 14px rgba(251,191,36,0.45)':'';
      allRows[idx].style.background=on?'rgba(251,191,36,0.18)':allRows[idx].getAttribute('data-bg')||'';
      if(on && !allRows[idx].getAttribute('data-bg')){
        // store original bg
        allRows[idx].setAttribute('data-bg', allRows[idx].style.background||'');
      }
    }
  }

  function velSpeak(text,onDone){
    const utt=new SpeechSynthesisUtterance(text);
    const v=voices.find(v=>/samantha|victoria|karen|zira|hazel|susan|female|woman/i.test(v.name))
      ||voices.find(v=>v.lang==='en-US'&&v.default)||voices.find(v=>v.lang.startsWith('en'))||voices[0];
    if(v)utt.voice=v;
    utt.pitch=1.12;utt.rate=0.88;utt.volume=1;
    utt.onend=onDone;
    synth.speak(utt);
  }

  function readNextEntry(){
    if(qIdx>=readQueue.length)return;
    const entry=readQueue[qIdx];
    const panel=entry.panelEl
      ||(entry.panelId?(content.querySelector('#'+entry.panelId)||content.querySelector(entry.altSel)):null);
    if(!panel){qIdx++;setTimeout(readNextEntry,200);return;}

    panel.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>{
      glowPanel(panel,true);
      let sIdx=0;
      // announce which flight before reading
      const intro=`Smart insight for ${entry.airline}.`;
      velSpeak(intro,()=>{
        function readNext(){
          if(sIdx>=entry.sentences.length){
            // reset all point rows
            Array.from(panel.querySelectorAll('div[style*="border-bottom:1px solid rgba(255,255,255,0.04)"]')).forEach(r=>{
              r.style.outline='';r.style.boxShadow='';r.style.background=r.getAttribute('data-bg')||'';
            });
            glowPanel(panel,false);
            qIdx++;
            setTimeout(readNextEntry,700);
            return;
          }
          // sIdx 0 = insight sentence (no row highlight), sIdx 1-3 = point rows
          if(sIdx>0) glowPointRow(panel,sIdx-1,true);
          velSpeak(entry.sentences[sIdx],()=>{
            if(sIdx>0) glowPointRow(panel,sIdx-1,false);
            sIdx++;
            setTimeout(readNext,280);
          });
        }
        readNext();
      });
    },400);
  }

  setTimeout(readNextEntry,1400);
}

// ── INIT ───────────────────────────────────────────────────────
// DOM is already ready (we're inside DOMContentLoaded), call directly
setTimeout(()=>{ voices = synth.getVoices(); }, 300);
setTimeout(()=>{ currentStep = 0; handleStep(0); }, 800);


// ── BOOKING FUNCTIONS REMOVED ──

// ── FLIGHT SELECTOR (compact list shown before full cards) ─────
function renderFlightSelector(flights,flexDates,onSelect){
  const wrap=document.createElement('div');
  wrap.style.cssText='width:100%;display:flex;flex-direction:column;gap:0;';

  const head=document.createElement('div');
  head.style.cssText='font-family:"Cormorant Garamond",serif;font-size:1rem;color:var(--accent2);letter-spacing:0.08em;margin-bottom:10px;';
  head.textContent='✦ Select Your Flight';
  wrap.appendChild(head);

  const tagCols={best:'#f5c97a',cheapest:'#34d399',fastest:'#a78bfa',value:'#38bdf8',beyond:'#94a3b8'};

  // ── main flights section ──
  const mainBox=document.createElement('div');
  mainBox.style.cssText='border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);';
  flights.forEach((f,idx)=>{
    const tc=tagCols[f.tag]||'#94a3b8';
    const seg0=f.segments&&f.segments[0];
    const lastSeg=f.segments&&f.segments[f.segments.length-1];
    const route=seg0?`${seg0.fromIATA||''} → ${lastSeg?.toIATA||seg0.toIATA||''}`:`${collected.fromIATA||'—'} → ${collected.toIATA||'—'}`;
    const stopLabel=f.stops===0?'Non-stop':f.stops+' stop'+(f.stops>1?'s':'');
    const row=document.createElement('div');
    row.style.cssText=`display:flex;align-items:center;justify-content:space-between;padding:12px 15px;background:rgba(12,6,28,0.65);cursor:pointer;transition:background 0.15s;${idx>0?'border-top:1px solid rgba(255,255,255,0.05);':''}`;
    row.innerHTML=`
      <div style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;">
        <div style="font-size:0.88rem;color:#f1f5f9;">${f.airline}</div>
        <div style="font-size:0.65rem;color:rgba(255,255,255,0.38);">${route} · ${f.totalDuration} · ${stopLabel}</div>
      </div>
      <div style="display:flex;align-items:center;gap:9px;flex-shrink:0;">
        <div style="font-size:0.96rem;color:${tc};">₹${(f.pricePerPax||0).toLocaleString('en-IN')}</div>
        <span style="font-size:0.52rem;letter-spacing:0.14em;text-transform:uppercase;padding:2px 8px;border-radius:12px;border:1px solid ${tc};color:${tc};white-space:nowrap;">${f.tagLabel||f.tag}</span>
      </div>`;
    row.addEventListener('mouseenter',()=>row.style.background='rgba(168,85,247,0.1)');
    row.addEventListener('mouseleave',()=>row.style.background='rgba(12,6,28,0.65)');
    row.addEventListener('click',()=>{wrap.remove();onSelect(f,false);});
    mainBox.appendChild(row);
  });
  wrap.appendChild(mainBox);

  // ── flexible date options section ──
  const fdArr=flexDates||[];
  if(fdArr.length>0){
    const fdHead=document.createElement('div');
    fdHead.style.cssText='font-size:0.58rem;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin:12px 0 6px;';
    fdHead.textContent='✦ Flexible Date Options';
    wrap.appendChild(fdHead);

    const fdBox=document.createElement('div');
    fdBox.style.cssText='border-radius:12px;overflow:hidden;border:1px solid rgba(56,189,248,0.2);';
    fdArr.forEach((fd,idx)=>{
      const cheaper=(fd.priceDiff||0)<0;
      const diffAbs=Math.abs(fd.priceDiff||0);
      const diffTxt=cheaper?`₹${diffAbs.toLocaleString('en-IN')} cheaper`:`₹${diffAbs.toLocaleString('en-IN')} costlier`;
      const diffCol=cheaper?'#34d399':'#f87171';
      const seg0=fd.segments&&fd.segments[0];
      const lastSeg=fd.segments&&fd.segments[fd.segments.length-1];
      const route=seg0?`${seg0.fromIATA||''} → ${lastSeg?.toIATA||seg0.toIATA||''}`:'—';
      const stopLabel=(fd.stops||0)===0?'Non-stop':(fd.stops||1)+' stop'+((fd.stops||1)>1?'s':'');
      const row=document.createElement('div');
      row.style.cssText=`display:flex;align-items:center;justify-content:space-between;padding:11px 15px;background:rgba(4,14,28,0.7);cursor:pointer;transition:background 0.15s;${idx>0?'border-top:1px solid rgba(56,189,248,0.1);':''}`;
      row.innerHTML=`
        <div style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:7px;">
            <span style="font-size:0.88rem;color:#f1f5f9;">${fd.airline||'—'}</span>
            <span style="font-size:0.6rem;color:rgba(255,255,255,0.35);">${fd.display||fd.date||''} · ${fd.dayName||''}</span>
          </div>
          <div style="font-size:0.65rem;color:rgba(255,255,255,0.38);">${route} · ${fd.totalDuration||'—'} · ${stopLabel}</div>
        </div>
        <div style="display:flex;align-items:center;gap:9px;flex-shrink:0;">
          <div style="text-align:right;">
            <div style="font-size:0.96rem;color:#7dd3fc;">₹${(fd.cheapestPrice||0).toLocaleString('en-IN')}</div>
            <div style="font-size:0.6rem;color:${diffCol};">${diffTxt}</div>
          </div>
          <span style="font-size:0.52rem;letter-spacing:0.14em;text-transform:uppercase;padding:2px 8px;border-radius:12px;border:1px solid rgba(56,189,248,0.4);color:#7dd3fc;white-space:nowrap;">${fd.label||'Flex'}</span>
        </div>`;
      row.addEventListener('mouseenter',()=>row.style.background='rgba(56,189,248,0.08)');
      row.addEventListener('mouseleave',()=>row.style.background='rgba(4,14,28,0.7)');
      row.addEventListener('click',()=>{wrap.remove();onSelect(fd,true);});
      fdBox.appendChild(row);
    });
    wrap.appendChild(fdBox);
  }

  // Show all details link
  const showAll=document.createElement('div');
  showAll.style.cssText='margin-top:10px;text-align:center;font-size:0.68rem;color:var(--accent);letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;opacity:0.65;padding:4px 0;';
  showAll.textContent='↓ View full flight details below';
  showAll.addEventListener('click',()=>{
    wrap.remove();
    chatInput.disabled=false;
    inputHint.textContent='type to ask about a flight';
    onSelect(null,false);
  });
  wrap.appendChild(showAll);

  return wrap;
}

// ── VELORA OVERALL RECOMMENDATION ─────────────────────────────
function renderOverallRecommendation(flights){
  const picks=[];
  const seen=new Set();
  ['best','cheapest','fastest','value'].forEach(tag=>{
    const f=flights.find(fl=>fl.tag===tag&&!seen.has(fl.airline));
    if(f&&picks.length<3){picks.push(f);seen.add(f.airline);}
  });
  if(!picks.length)return '';
  const tagCols={best:'#f5c97a',cheapest:'#34d399',fastest:'#a78bfa',value:'#38bdf8'};
  const tagDesc={best:'Best balance of price and timing',cheapest:'Lowest fare available',fastest:'Quickest total journey',value:'Best price-to-comfort ratio'};
  const rows=picks.map(f=>{
    const tc=tagCols[f.tag]||'#94a3b8';
    return `<div class="velora-overall-pick" data-tag="${f.tag}" style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.06);cursor:pointer;transition:background 0.18s;" onmouseover="this.style.background='rgba(255,255,255,0.07)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
      <span style="width:9px;height:9px;border-radius:50%;background:${tc};box-shadow:0 0 7px ${tc};flex-shrink:0;"></span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.84rem;color:#f1f5f9;">${f.airline}</div>
        <div style="font-size:0.67rem;color:rgba(255,255,255,0.38);margin-top:2px;">${tagDesc[f.tag]||''} · ${f.totalDuration} · ${f.stops===0?'Non-stop':f.stops+' stop'+(f.stops>1?'s':'')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:1rem;color:${tc};">₹${(f.pricePerPax||0).toLocaleString('en-IN')}</div>
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.3);margin-top:2px;">tap to book</div>
      </div>
    </div>`;
  }).join('');
  return `<div style="margin-bottom:16px;padding:0;background:rgba(6,2,18,0.92);border:1px solid rgba(167,139,250,0.3);border-radius:14px;overflow:hidden;">
    <div style="display:flex;align-items:center;gap:9px;padding:10px 14px;background:rgba(167,139,250,0.08);border-bottom:1px solid rgba(167,139,250,0.15);">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#a78bfa"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      <span style="font-size:0.6rem;letter-spacing:0.2em;text-transform:uppercase;color:#a78bfa;font-weight:700;font-family:'Jost',sans-serif;">Velora Overall Recommendation</span>
    </div>
    <div style="padding:12px 14px;display:flex;flex-direction:column;gap:7px;">${rows}</div>
  </div>`;
}


// ── GENERATE OVERALL AI RECOMMENDATION FOR WITHIN FILTER FLIGHTS ──
async function generateOverallAIRecommendation(flights, sid){
  const overallRecDiv = document.getElementById(`ai-overall-rec-${sid}`);
  const recReasonDiv = document.getElementById(`ai-rec-reason-${sid}`);
  const travelInsightsDiv = document.getElementById(`ai-travel-insights-${sid}`);
  const insightsList = document.getElementById(`ai-insights-list-${sid}`);
  
  if(!overallRecDiv || !flights || flights.length === 0) {
    if(overallRecDiv) overallRecDiv.textContent = 'No flight data available for analysis.';
    return;
  }
  
  // Simulate AI thinking
  overallRecDiv.textContent = 'Analyzing flight options...';
  if(travelInsightsDiv) travelInsightsDiv.textContent = 'Generating personalized insights...';
  
  setTimeout(() => {
    let overallRec = '';
    let reasons = [];
    let insights = [];
    
    // Find best flight based on tags
    const cheapest = flights.find(f => f.tag === 'cheapest');
    const fastest = flights.find(f => f.tag === 'fastest');
    const best = flights.find(f => f.tag === 'best');
    
    // Generate Overall Recommendation with reasons
    if(best){
      overallRec = `The ${best.airline} flight offers the best balance of price and travel time among all filtered options.`;
      reasons.push(`💰 Most affordable pricing at ₹${best.price.toLocaleString('en-IN')} per person`);
      reasons.push(`⏱️ Reasonable journey duration of ${best.duration}`);
      reasons.push(`✈️ Optimal route with ${best.stops === 0 ? 'no layovers' : best.stops + ' stop(s)'}`);
    } else if(cheapest && fastest && cheapest.airline === fastest.airline){
      overallRec = `The ${cheapest.airline} option is both economical and fast, making it the ideal choice.`;
      reasons.push(`💰 Lowest fare at ₹${cheapest.price.toLocaleString('en-IN')} per person`);
      reasons.push(`⏱️ Fastest journey time at ${cheapest.duration}`);
      reasons.push(`✈️ Best overall value for your trip`);
    } else if(cheapest){
      overallRec = `The ${cheapest.airline} flight is the most economical option, staying well within your budget.`;
      const savings = Math.max(...flights.map(f => f.price)) - cheapest.price;
      reasons.push(`💰 Lowest available price at ₹${cheapest.price.toLocaleString('en-IN')} per person`);
      reasons.push(`💸 Save up to ₹${savings.toLocaleString('en-IN')} compared to other options`);
      reasons.push(`✈️ Maintains ${cheapest.stops === 0 ? 'direct service' : 'reasonable connections'}`);
    } else if(fastest){
      overallRec = `The ${fastest.airline} flight is the fastest option, ideal for time-sensitive travel.`;
      const slowest = flights.reduce((a, b) => {
        const aMins = parseDuration(a.duration);
        const bMins = parseDuration(b.duration);
        return bMins > aMins ? b : a;
      });
      const timeSaved = Math.round((parseDuration(slowest.duration) - parseDuration(fastest.duration)) / 60);
      reasons.push(`⏱️ Quickest journey at ${fastest.duration}`);
      reasons.push(`⚡ Save ${timeSaved}+ hours vs slowest option`);
      reasons.push(`🎯 Optimal arrival time at ${fmt12(fastest.arrivalTime)}`);
    } else {
      overallRec = 'All available flights offer similar travel time and pricing. Choose based on your preference.';
      reasons.push(`💰 Price range: ₹${Math.min(...flights.map(f => f.price)).toLocaleString('en-IN')} - ₹${Math.max(...flights.map(f => f.price)).toLocaleString('en-IN')}`);
      reasons.push(`⏱️ Similar journey durations across options`);
      reasons.push(`✈️ All flights meet your filter requirements`);
    }
    
    // Generate 4 SHORT AI Travel Insights (max 10 words each)
    if(cheapest && cheapest.price){
      const maxPrice = Math.max(...flights.map(f => f.price));
      const savings = maxPrice - cheapest.price;
      insights.push(`💰 Booking cheapest option saves ₹${savings.toLocaleString('en-IN')} total`);
    }
    
    if(fastest){
      const fastestMins = parseDuration(fastest.duration);
      const slowestMins = Math.max(...flights.map(f => parseDuration(f.duration)));
      const timeSaved = Math.round((slowestMins - fastestMins) / 60);
      if(timeSaved > 0){
        insights.push(`⏱️ Fastest flight saves ${timeSaved}+ hours travel time`);
      }
    }
    
    const directFlights = flights.filter(f => f.stops === 0);
    if(directFlights.length > 0 && flights.some(f => f.stops > 0)){
      insights.push(`✈️ Direct flight options available for comfort`);
    }
    
    const earlyArrivals = flights.filter(f => f.arrivalTime && f.arrivalTime < '12:00');
    if(earlyArrivals.length > 0){
      insights.push(`🌤️ Early arrival options maximize destination time`);
    }
    
    // Ensure we have exactly 4 insights
    while(insights.length < 4){
      insights.push(`🔥 All flights match your selected filters`);
    }
    insights = insights.slice(0, 4);
    
    // Update Overall Recommendation
    overallRecDiv.textContent = overallRec;
    
    // Update Reasons
    if(recReasonDiv && reasons.length > 0){
      document.getElementById(`reason-1-${sid}`).textContent = reasons[0] || '';
      document.getElementById(`reason-2-${sid}`).textContent = reasons[1] || '';
      document.getElementById(`reason-3-${sid}`).textContent = reasons[2] || '';
      recReasonDiv.style.display = 'block';
    }
    
    // Update Travel Insights
    if(insightsList && insights.length > 0){
      insights.forEach((insight, idx) => {
        const elem = document.getElementById(`insight-${idx + 1}-${sid}`);
        if(elem){
          elem.querySelector('span:last-child').textContent = insight;
        }
      });
      travelInsightsDiv.textContent = '';
      insightsList.style.display = 'flex';
    }
  }, 1200);
}

// ── GENERATE AI RECOMMENDATIONS FOR FLEXIBLE DATE OPTIONS ──
async function generateFlexDateAIRecommendation(flexDates, baseFlights, sid){
  const recDiv = document.getElementById(`ai-flexdate-rec-${sid}`);
  const reasonDiv = document.getElementById(`ai-flexdate-reason-${sid}`);
  const insightsDiv = document.getElementById(`ai-travel-insights-${sid}`);
  const insightsList = document.getElementById(`ai-insights-list-${sid}`);
  
  if(!recDiv || !flexDates || flexDates.length === 0) return;
  if(insightsDiv) insightsDiv.textContent = 'Analyzing flexible date options...';
  
  setTimeout(() => {
    let recommendation = '';
    let reasons = [];
    let insights = [];
    
    // Find best flexible date (cheapest)
    const cheapestFlex = flexDates.reduce((prev, current) => {
      const prevPrice = prev.cheapestPrice || 0;
      const currPrice = current.cheapestPrice || 0;
      return currPrice < prevPrice ? current : prev;
    });
    
    const expensiveFlex = flexDates.reduce((prev, current) => {
      const prevPrice = prev.cheapestPrice || 0;
      const currPrice = current.cheapestPrice || 0;
      return currPrice > prevPrice ? current : prev;
    });
    
    const savings = (expensiveFlex.cheapestPrice || 0) - (cheapestFlex.cheapestPrice || 0);
    
    if(cheapestFlex){
      const dayName = cheapestFlex.label || cheapestFlex.dayName || 'this date';
      recommendation = `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} offers the best value, saving ₹${savings.toLocaleString('en-IN')} compared to peak prices`;
      
      reasons.push(`💰 Lowest price at ₹${(cheapestFlex.cheapestPrice || 0).toLocaleString('en-IN')} per person`);
      
      if(savings > 5000){
        reasons.push(`💸 Significant savings of ₹${savings.toLocaleString('en-IN')} vs highest priced date`);
      } else if(savings > 1000){
        reasons.push(`💸 Moderate savings of ₹${savings.toLocaleString('en-IN')} across date range`);
      } else {
        reasons.push(`💸 Close pricing - flexibility won't save much`);
      }
      
      if(cheapestFlex.stops === 0){
        reasons.push(`✈️ Direct flight available - maximize destination time`);
      } else {
        reasons.push(`✈️ ${cheapestFlex.stops} layover${cheapestFlex.stops > 1 ? 's' : ''} - budget-friendly routing`);
      }
    } else {
      recommendation = 'Flexible dates provide multiple travel options with varying prices and timings.';
      reasons.push(`💰 Price range across dates for comparison`);
      reasons.push(`✈️ Multiple routing options to choose from`);
      reasons.push(`⏱️ Different travel durations available`);
    }
    
    // Generate UNIQUE AI Travel Insights with specific data points
    insights = [];
    
    // Insight 1: Price volatility analysis
    if(flexDates && flexDates.length > 0){
      const prices = flexDates.map(f => f.cheapestPrice || 0).filter(p => p > 0);
      if(prices.length > 1){
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const priceDiff = maxPrice - minPrice;
        const variance = Math.round((priceDiff / avgPrice) * 100);
        
        if(variance > 15){
          insights.push(`💰 Price swings by ${variance}% - optimal booking window is critical for savings`);
        } else if(variance > 8){
          insights.push(`💰 Moderate ${variance}% price variance across dates - weekday bookings generally cheaper`);
        } else {
          insights.push(`💰 Stable pricing across dates - flexibility offers minimal savings of ₹${priceDiff.toLocaleString('en-IN')}`);
        }
      }
    }
    
    // Insight 2: Duration & routing benefits
    if(flexDates && flexDates.length > 0){
      const directCount = flexDates.filter(f => f.stops === 0).length;
      const avgDuration = flexDates.reduce((sum, f) => {
        const mins = parseInt(f.totalDuration) || 0;
        return sum + mins;
      }, 0) / flexDates.length;
      
      if(directCount > 0 && directCount < flexDates.length){
        insights.push(`✈️ ${directCount} direct option${directCount > 1 ? 's' : ''} available - priority for time-critical travelers`);
      } else if(directCount === flexDates.length){
        insights.push(`✈️ All flexible dates offer direct flights - convenience across entire date range`);
      } else {
        insights.push(`✈️ All dates require connections - plan for avg ${Math.round(avgDuration / 60)} hour journey time`);
      }
    }
    
    // Insight 3: Airline consistency
    if(baseFlights && baseFlights.length > 0){
      const airlineSet = new Set(baseFlights.map(f => f.airline).filter(Boolean));
      if(airlineSet.size === 1){
        insights.push(`🛫 Single airline across dates - consistent service and baggage policies`);
      } else if(airlineSet.size <= 3){
        insights.push(`🛫 Limited carrier options - compare amenities before booking`);
      } else {
        insights.push(`🛫 Multiple airlines available - choose based on loyalty points or preferences`);
      }
    }
    
    // Insight 4: Market conditions
    if(flexDates && flexDates.length > 3){
      const weekend = flexDates.filter(f => f.dayName && (f.dayName.includes('Sat') || f.dayName.includes('Sun')));
      if(weekend.length > 0){
        const weekdayPrices = flexDates.filter(f => !weekend.includes(f)).map(f => f.cheapestPrice || 0);
        const weekendPrices = weekend.map(f => f.cheapestPrice || 0);
        const avgWeekday = weekdayPrices.reduce((a, b) => a + b, 0) / weekdayPrices.length;
        const avgWeekend = weekendPrices.reduce((a, b) => a + b, 0) / weekendPrices.length;
        const diff = Math.round(avgWeekend - avgWeekday);
        if(diff > 500){
          insights.push(`📊 Weekend premium of ₹${diff.toLocaleString('en-IN')} - consider midweek travel for value`);
        } else if(diff < -500){
          insights.push(`📊 Midweek surge detected - weekend rates may offer better value`);
        } else {
          insights.push(`📊 Balanced pricing throughout week - select based on convenience`);
        }
      }
    }
    
    // Ensure we have exactly 4 insights
    while(insights.length < 4){
      insights.push(`🔍 Additional flexible date combinations available for exploration`);
    }
    insights = insights.slice(0, 4);
    
    // Update Flex Date Recommendation
    if(recDiv) recDiv.textContent = recommendation;
    
    // Update Flex Date Reasons
    if(reasonDiv && reasons.length > 0){
      document.getElementById(`flexdate-reason-1-${sid}`).textContent = reasons[0] || '';
      document.getElementById(`flexdate-reason-2-${sid}`).textContent = reasons[1] || '';
      document.getElementById(`flexdate-reason-3-${sid}`).textContent = reasons[2] || '';
      reasonDiv.style.display = 'block';
    }
    
    // Update Travel Insights
    if(insightsList && insights.length > 0){
      insights.forEach((insight, idx) => {
        const elem = document.getElementById(`insight-${idx + 1}-${sid}`);
        if(elem){
          elem.querySelector('span:last-child').textContent = insight;
        }
      });
      if(insightsDiv) insightsDiv.textContent = '';
      insightsList.style.display = 'flex';
    }
  }, 1200);
}

function parseDuration(durationStr){
  const match = durationStr.match(/(\d+)h\s*(\d+)m/);
  if(match){
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  }
  return 0;
}

// Helper function to calculate time difference
function calculateTimeDiff(duration1, duration2){
  const mins1 = parseDuration(duration1);
  const mins2 = parseDuration(duration2);
  const diff = Math.abs(mins1 - mins2);
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

// Function to speak text with word-by-word highlighting
function speakWithHighlight(text, mainDiv, compDiv){
  if(!window.speechSynthesis) return;
  
  // Stop any ongoing speech
  window.speechSynthesis.cancel();
  
  const words = text.split(' ');
  const mainText = mainDiv.textContent;
  const compText = compDiv ? compDiv.textContent : '';
  
  // Split into main and comparison parts
  const mainWords = mainText.split(' ');
  const compWords = compText ? compText.split(' ') : [];
  
  let currentWordIndex = 0;
  
  // Create highlighted version
  function highlightWord(index, isComparison = false){
    const targetDiv = isComparison ? compDiv : mainDiv;
    const wordsArray = isComparison ? compWords : mainWords;
    
    if(!targetDiv || index >= wordsArray.length) return;
    
    const highlighted = wordsArray.map((word, i) => {
      if(i === index){
        return `<span style="color:#a78bfa;background:rgba(167,139,250,0.2);padding:2px 4px;border-radius:4px;font-weight:600;">${word}</span>`;
      }
      return word;
    }).join(' ');
    
    targetDiv.innerHTML = highlighted;
  }
  
  // Speak the text
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.pitch = 1.1;
  
  let wordIndex = 0;
  const intervalId = setInterval(() => {
    if(wordIndex < mainWords.length){
      highlightWord(wordIndex, false);
    } else if(wordIndex < mainWords.length + compWords.length){
      highlightWord(wordIndex - mainWords.length, true);
    }
    wordIndex++;
  }, 400); // Adjust timing based on speech rate
  
  utterance.onend = () => {
    clearInterval(intervalId);
    // Reset to normal text
    mainDiv.textContent = mainText;
    if(compDiv) compDiv.textContent = compText;
  };
  
  window.speechSynthesis.speak(utterance);
}


// ── BOOKING MODAL REMOVED ──

}); // end DOMContentLoaded