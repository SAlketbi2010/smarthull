'use strict';
const LiveData = (() => {
 const states=new Set(['SETTLING','DRIVE_ZERO','BOTH_CLIPPED','SENSING_CLIPPED','REFERENCE_CLIPPED','REFERENCE_NEAR_ZERO','SENSING_NEAR_ZERO','LIVE_UNCALIBRATED']);
 function parse(line){
  const f=line.trim().split(',');if(f.length!==6||!/^\d+$/.test(f[0])||!/^\d+$/.test(f[1])||!states.has(f[5]))return null;
  if(!f[2].trim()||!f[3].trim())return null;
  const [ms,drive,reference,sense]=f.slice(0,4).map(Number);
  if(![ms,drive,reference,sense].every(Number.isFinite)||drive>255||ms>4294967295||reference<0||sense<0||reference>3300||sense>3300)return null;
  // Firmware column 3 is D34 (physical reference), column 4 is D35 (physical sensing).
  const status=({SENSING_CLIPPED:'REFERENCE_CLIPPED',REFERENCE_CLIPPED:'SENSING_CLIPPED',REFERENCE_NEAR_ZERO:'SENSING_NEAR_ZERO',SENSING_NEAR_ZERO:'REFERENCE_NEAR_ZERO'})[f[5]]||f[5];
  const valid=status==='LIVE_UNCALIBRATED'&&drive>0&&reference>30&&sense>30&&reference<3000&&sense<3000;
  return {ms,drive,reference,sense,status,valid,ratio:valid?sense/reference:null};
 }
 const median=values=>{const a=[...values].sort((a,b)=>a-b),m=Math.floor(a.length/2);return a.length?a.length%2?a[m]:(a[m-1]+a[m])/2:null;};
 const decrease=(ratio,baseline)=>Number.isFinite(ratio)&&Number.isFinite(baseline)&&baseline>0?100*(1-ratio/baseline):null;
 class Lines{constructor(){this.buffer='';}push(chunk){this.buffer+=chunk;const lines=this.buffer.split('\n');this.buffer=lines.pop();if(this.buffer.length>4096)this.buffer='';return lines.filter(l=>l.length<=4096).map(parse).filter(Boolean);}}
 // Learned strain estimator: through-origin regression of calculated strain on the receiver decrease (fixed-stop presses, 8.5-28.5 mm).
 const MODEL={slope:1917.3,range:[0,6500],looError:380};
 const strainFromDecrease=q=>Number.isFinite(q)?Math.max(0,MODEL.slope*q):null;
 // Warning levels come from published limits, not from a user setting.
 // Hull side: glass/polyester hull laminates start to micro-crack at about 0.2% strain (SP Systems, Guide to Composites);
 // BS 4994:1987 caps the allowable strain of reinforced-plastic structures at min(0.1*eps_R, 0.2%). Limit = 2,000 ue.
 // Strain is a geometric ratio, so the same 2,000 ue can be produced in the polycarbonate test plate: eps = 6*t*delta/L^2.
 const HULL={limit:2000,approachFraction:0.8};
 const PLATE={t:2,span:228.6,E:2300,yieldStress:60,yieldStrain:0.06};//mm, mm, MPa (flexural), MPa, strain at yield (ISO 527 data sheet)
 const LEVELS={yellow:HULL.limit*HULL.approachFraction,red:HULL.limit};
 const deflectionFor=strain=>strain*1e-6*PLATE.span*PLATE.span/(6*PLATE.t);//mm, small-deflection three-point bending
 const plateStress=strain=>PLATE.E*strain*1e-6;//MPa, sigma = E*eps
 const plateYieldShare=strain=>strain*1e-6/PLATE.yieldStrain;
 function level(strain,yellow=LEVELS.yellow,red=LEVELS.red){
  if(!Number.isFinite(strain))return null;
  if(strain>=red)return 'danger';if(strain>=yellow)return 'approaching';return 'safe';
 }
 // Auto-baseline: learns the unloaded level when the signal is still, and follows slow drift without absorbing real bends.
 class Tracker{
  constructor(){this.win=[];this.stableSince=null;this.lastAt=null;}
  reset(){this.win=[];this.stableSince=null;this.lastAt=null;}
  spread(){const v=this.win.map(x=>x[1]).sort((a,b)=>a-b),n=v.length;if(n<60)return null;const m=v[Math.floor(n/2)];return {median:m,range:(v[Math.floor(n*.95)]-v[Math.floor(n*.05)])/m,span:this.win[n-1][0]-this.win[0][0]};}
  push(at,ratio){
   if(this.lastAt!==null&&at-this.lastAt>1500)this.reset();
   this.lastAt=at;this.win.push([at,ratio]);while(this.win.length&&this.win[0][0]<at-10000)this.win.shift();
   const s=this.spread(),ok=!!s&&s.span>=9000&&s.range<0.003;
   if(ok){if(this.stableSince===null)this.stableSince=at;}else this.stableSince=null;
   return ok?s.median:null;
  }
  stableFor(at){return this.stableSince===null?0:at-this.stableSince;}
 }
 function trackDrift(baseline,stableMedian,dtMs,maxQ=0.4){
  if(!Number.isFinite(stableMedian)||!Number.isFinite(baseline))return baseline;
  const q=decrease(stableMedian,baseline);if(q===null||Math.abs(q)>maxQ)return baseline;
  return baseline+(stableMedian-baseline)*Math.min(1,dtMs/60000);
 }
 return {parse,median,decrease,Lines,MODEL,strainFromDecrease,HULL,PLATE,LEVELS,deflectionFor,plateStress,plateYieldShare,level,Tracker,trackDrift};
})();
if(typeof module!=='undefined')module.exports=LiveData;
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id);
 const tracker=new LiveData.Tracker();let autoOn=true,baseline0=null,lastTrack=null,autoCapture=false;const yellowAt=LiveData.LEVELS.yellow,redAt=LiveData.LEVELS.red;
 let port=null,reader=null,task=null,busy=false,closing=false,writing=false,last=null,rows=[],baseline=null,capture=null,drawPending=false,sessionStart=null;
 const fresh=()=>!!last&&!!port&&!closing&&Date.now()-last.at<2000;
 function message(s,error=false){$('status').textContent=s;$('status').dataset.error=error;}
 function resetBaseline(reason){baseline=null;baseline0=null;lastTrack=null;autoCapture=false;tracker.reset();capture=null;$('baselineInfo').textContent=reason||'No baseline captured. Keep the plate unloaded and still during capture.';}
 const HOLD_MS=1000,RANK={safe:0,approaching:1,danger:2},NAME=['safe','approaching','danger'];let heldLvl=null,winSince=null,winDir=0,winExt=0;
 // A different level is adopted only if the reading stayed on that side of the held level for HOLD_MS. Rising adopts the lowest level seen in the window and falling the highest, so noise between amber and red cannot reset the timer.
 function holdLevel(raw,now){
  if(raw===null){winSince=null;return null;}
  if(heldLvl===null){winSince=null;return raw;}
  const r=RANK[raw],h=RANK[heldLvl];
  if(r===h){winSince=null;return heldLvl;}
  const dir=r>h?1:-1;
  if(winSince===null||dir!==winDir){winSince=now;winDir=dir;winExt=r;}else winExt=dir>0?Math.min(winExt,r):Math.max(winExt,r);
  if(now-winSince>=HOLD_MS){winSince=null;return NAME[winExt];}
  return heldLvl;
 }
 // Unloaded readings wobble by about +/-0.5 pp (about +/-1,000 ue). Smooth over 1.5 s and show 0 inside that noise floor, with hysteresis so it does not flicker.
 const SMOOTH_MS=1500,ZERO_EXIT_PP=0.6,ZERO_ENTER_PP=0.4;let qBuf=[],zeroed=true;
 function smoothedQ(qRaw){
  const t=Date.now();if(Number.isFinite(qRaw))qBuf.push([t,qRaw]);qBuf=qBuf.filter(p=>t-p[0]<=SMOOTH_MS);
  if(!Number.isFinite(qRaw)||!qBuf.length){zeroed=true;return {q:null,zero:false};}
  const v=qBuf.map(p=>p[1]).sort((a,b)=>a-b),m=Math.floor(v.length/2),qs=v.length%2?v[m]:(v[m-1]+v[m])/2;
  if(zeroed&&qs>=ZERO_EXIT_PP)zeroed=false;else if(!zeroed&&qs<ZERO_ENTER_PP)zeroed=true;
  return {q:qs,zero:zeroed};
 }
 function strainPanel(qRaw){
  const sm=smoothedQ(qRaw),q=sm.q;
  const panel=$('strainPanel'),chip=$('levelChip'),est=q===null?null:(sm.zero?0:LiveData.strainFromDecrease(q)),rawLvl=LiveData.level(est,yellowAt,redAt),max=LiveData.MODEL.range[1];
  // Hold the level: a change is shown only after it has lasted HOLD_MS, so a single noisy reading cannot flash amber or red.
  const nowT=Date.now();heldLvl=holdLevel(rawLvl,nowT);
  const lvl=heldLvl;
  const marks={safe:['SAFE','●'],approaching:['APPROACHING LIMIT','▲'],danger:['DANGER','■']};
  panel.dataset.level=lvl||'none';
  chip.textContent=lvl?marks[lvl][1]+' '+marks[lvl][0]:(baseline===null?'NEEDS BASELINE':'WAITING FOR DATA');
  $('strain').textContent=est===null?'—':'≈ '+(Math.round(est/10)*10).toLocaleString()+' µε';
  $('gaugeMark').style.left=est===null?'0%':Math.min(100,est/max*100)+'%';$('gaugeMark').hidden=est===null;
  $('gaugeBar').style.background=`linear-gradient(90deg,var(--ok) 0 ${yellowAt/max*100}%,var(--warn) ${yellowAt/max*100}% ${redAt/max*100}%,var(--bad) ${redAt/max*100}% 100%)`;
  $('yLabel').textContent=yellowAt.toLocaleString();$('rLabel').textContent=redAt.toLocaleString();
  let note='Estimated by the learned model from the decrease. Typical error ±'+LiveData.MODEL.looError+' µε inside the calibrated 0–'+max.toLocaleString()+' µε range.';
  if(est!==null)note='That is '+Math.round(est/LiveData.HULL.limit*100)+'% of the '+LiveData.HULL.limit.toLocaleString()+' µε hull limit. The polycarbonate plate itself carries about '+LiveData.plateStress(est).toFixed(1)+' MPa, '+(LiveData.plateYieldShare(est)*100).toFixed(0)+'% of its yield strain. '+note;
  if(est===0&&q!==null&&baseline!==null)note='No load detected. Readings within about ±0.5 percentage points (about ±1,000 µε) are indistinguishable from noise, so they are shown as 0.';
  else if(est!==null&&est>max)note='Above the calibrated range (>'+max.toLocaleString()+' µε): the true strain may be higher than shown.';
  else if(q!==null&&q<-0.5)note='Reading is above the baseline. If the plate is unloaded, re-capture the baseline.';
  else if(baseline===null)note='Capture or auto-learn an unloaded baseline to see an estimate.';
  $('strainNote').textContent=note;
 }
 function render(){
  const f=fresh(),connected=!!port&&!closing;
  $('connection').textContent=busy?'CONNECTING':closing?'DISCONNECTING':!connected?'DISCONNECTED':f?'RECEIVING':'WAITING FOR DATA';
  $('connect').disabled=busy||!!port||closing||!('serial' in navigator);$('disconnect').disabled=!port||closing;
  $('enable').disabled=$('disable').disabled=!connected||!port.writable||writing;
  $('baseline').disabled=!f||!last.valid||!!capture||writing;$('clear').disabled=baseline===null&&!capture;$('download').disabled=!rows.length;
  $('sense').textContent=f?last.sense.toFixed(2):'—';$('reference').textContent=f?last.reference.toFixed(2):'—';
  $('ratio').textContent=f&&last.valid?last.ratio.toFixed(6):'—';const q=f&&last.valid?LiveData.decrease(last.ratio,baseline):null;
  $('decrease').textContent=q===null?'—':q.toFixed(2)+'%';strainPanel(q);
  $('age').textContent=last?'Last sample '+Math.max(0,(Date.now()-last.at)/1000).toFixed(1)+' s ago':'Waiting for readings';
  $('details').textContent=last?`D25 drive: ${last.drive}/255 · ${last.status.replaceAll('_',' ')} · ${rows.length.toLocaleString()} retained rows · ${new Date(last.at).toLocaleTimeString()}`:'No samples received.';
  if(!drawPending){drawPending=true;requestAnimationFrame(()=>{drawPending=false;plot();});}
 }
 function accept(r){
  if(last&&(r.ms<last.ms||r.drive!==last.drive)){resetBaseline('Board restart or drive change detected. Capture a new unloaded baseline.');}
  if(last&&r.ms===last.ms)return;
  r.at=Date.now();r.utc=new Date(r.at).toISOString();
  if(capture){
   if(!r.valid||r.drive!==capture.drive||r.at-capture.lastAt>1500){resetBaseline('Baseline capture interrupted. Wait for valid, steady readings and try again.');}
   else{capture.values.push(r.ratio);capture.lastAt=r.at;const elapsed=r.at-capture.start;
    if(elapsed>=20000){if(capture.values.length>=120){const v=[...capture.values].sort((a,b)=>a-b),mid=LiveData.median(v),spread=(v[Math.floor(v.length*.95)]-v[Math.floor(v.length*.05)])/mid;if(capture.auto&&spread>0.01){resetBaseline('Auto-baseline rejected: the signal was not steady for 20 s. It will try again when still.');}else{baseline=mid;baseline0=mid;tracker.reset();$('baselineInfo').textContent=`${capture.auto?'Auto-learned':'Unloaded'} baseline R₀ = ${baseline.toFixed(6)} · median of ${capture.values.length} samples · captured ${new Date().toLocaleTimeString()}${autoOn?' · auto-baseline is following slow drift':''}`;capture=null;}}else resetBaseline('Too few samples for a baseline. Try again.');}
    else $('baselineInfo').textContent=`Capturing unloaded baseline… ${Math.ceil((20000-elapsed)/1000)} s remaining. Keep still.`;
   }
  }
  if(r.valid){
   const steady=tracker.push(r.at,r.ratio);
   if(autoOn&&!capture){
    if(baseline!==null&&steady!==null){
     const nb=LiveData.trackDrift(baseline,steady,lastTrack===null?100:r.at-lastTrack);
     if(baseline0!==null&&Math.abs(nb/baseline0-1)>0.03){if(Math.abs(baseline/baseline0-1)<=0.03)$('baselineInfo').textContent='Auto-baseline stopped: drift passed 3% from the captured level. Check the setup and re-capture.';}
     else baseline=nb;
    }else if(baseline===null&&tracker.stableFor(r.at)>=10000){
     autoCapture=true;capture={start:r.at,lastAt:r.at,drive:r.drive,values:[],auto:true};$('baselineInfo').textContent='Auto-baseline: steady signal found, assuming the plate is unloaded. Capturing 20 s…';
    }
   }
   lastTrack=r.at;
  }else{tracker.reset();lastTrack=null;}
  r.baseline=baseline;r.decrease=LiveData.decrease(r.ratio,baseline);rows.push(r);if(rows.length>36000)rows.shift();last=r;
  message(r.valid?'Receiving real hardware readings · USB connection · data stays in this tab':r.status==='DRIVE_ZERO'?'Transmitter drive is off. Click Enable transmitter drive when ready.':'Receiving readings · '+r.status.replaceAll('_',' '),!r.valid);render();
 }
 async function readLoop(active){
  const lines=new LiveData.Lines(),decoder=new TextDecoder();
  try{reader=active.readable.getReader();while(!closing){const {value,done}=await reader.read();if(done)break;for(const row of lines.push(decoder.decode(value,{stream:true})))accept(row);}}
  catch(e){if(!closing)message('USB reading stopped. Reconnect the ESP32. '+e.message,true);}
  finally{if(reader)reader.releaseLock();reader=null;while(writing)await new Promise(r=>setTimeout(r,20));try{await active.close();}catch(e){}if(port===active)port=null;closing=false;resetBaseline('Disconnected. Reconnect and capture a new baseline.');message('Disconnected — recorded session remains available for CSV export.');render();}
 }
 $('connect').onclick=async()=>{
  busy=true;render();let selected;
  try{selected=await navigator.serial.requestPort();await selected.open({baudRate:115200});port=selected;last=null;if(!sessionStart)sessionStart=new Date().toISOString();resetBaseline();message('Port connected. Waiting for firmware readings…');task=readLoop(selected);}
  catch(e){message(e.name==='NotFoundError'?'Connection cancelled. Select your ESP32 when ready.':'Could not open the port. Close VS Code Serial Monitor and other serial readers, then retry. '+e.message,true);}
  finally{busy=false;render();}
 };
 $('disconnect').onclick=async()=>{closing=true;render();if(reader)await reader.cancel().catch(()=>{});if(task)await task;message('Disconnected — recorded session remains available for CSV export.');};
 async function command(char){if(!port||closing||!port.writable||writing)return;writing=true;resetBaseline('Drive command sent. Wait for valid readings, then capture a new baseline.');render();let writer;
  try{writer=port.writable.getWriter();await writer.write(new TextEncoder().encode(char));}
  catch(e){message('Could not send drive command: '+e.message,true);}
  finally{if(writer)writer.releaseLock();writing=false;render();}
 }
 $('enable').onclick=()=>command('l');$('disable').onclick=()=>command('d');
 $('baseline').onclick=()=>{if(!fresh()||!last.valid)return;baseline=null;capture={start:Date.now(),lastAt:Date.now(),drive:last.drive,values:[]};$('baselineInfo').textContent='Capturing unloaded baseline… keep still for twenty seconds.';render();};
 $('auto').onchange=()=>{autoOn=$('auto').checked;tracker.reset();if(!autoOn&&!capture)$('baselineInfo').textContent=baseline===null?'Auto-baseline is off. Use the capture button when the plate is unloaded.':$('baselineInfo').textContent;render();};
 $('clear').onclick=()=>{resetBaseline();render();};
 $('download').onclick=()=>{const header=['received_utc','device_ms','drive','sensing_D35_mV','reference_D34_mV','ratio','baseline_ratio','decrease_pct','status','strain_estimate_ue','level'];const data=rows.map(r=>{const e=LiveData.strainFromDecrease(r.decrease);return [r.utc,r.ms,r.drive,r.sense,r.reference,r.ratio??'',r.baseline??'',r.decrease??'',r.status,e===null?'':e.toFixed(0),e===null?'':LiveData.level(e,yellowAt,redAt)];});const csv=[header,...data].map(r=>r.join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='SmartHull-live-'+(sessionStart||new Date().toISOString()).replaceAll(':','-')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 function plot(){
  const canvas=$('livePlot'),c=canvas.getContext('2d'),w=canvas.clientWidth,h=canvas.clientHeight||360,dpr=window.devicePixelRatio||1;if(!w)return;canvas.width=w*dpr;canvas.height=h*dpr;c.setTransform(dpr,0,0,dpr,0,0);
  const dark=document.documentElement.dataset.theme==='dark',text=dark?'#bcd0da':'#526977',grid=dark?'#344954':'#dce5e9',zero=dark?'#7f98a6':'#8aa0ac';
  const now=Date.now(),data=rows.filter(r=>now-r.at<=60000),left=62,right=20,X=t=>left+(t-(now-60000))/60000*(w-left-right);
  const med=a=>{const s=a.filter(Number.isFinite).sort((p,q)=>p-q);return s.length?s[s.length>>1]:null;};
  const mS=med(data.map(r=>r.sense)),mR=med(data.map(r=>r.reference));
  // Each panel is auto-zoomed to what is on screen, so small changes fill the height instead of sitting on a 0-3300 mV axis.
  const panels=[
   {top:24,bot:Math.round(h*.52),title:'Change from the 60 s median (%)',sym:true,minSpan:.4,dec:2,series:[['#30a4bb',r=>mS?100*(r.sense/mS-1):null],['#de9b46',r=>mR?100*(r.reference/mR-1):null]]},
   {top:Math.round(h*.52)+34,bot:h-30,title:'Ratio decrease q (%) — sensing/reference',sym:false,minSpan:1,dec:2,series:[['#c55a11',r=>r.decrease]]}
  ];
  c.font='11px system-ui';
  for(const p of panels){
   let lo=Infinity,hi=-Infinity;for(const [,f] of p.series)for(const r of data){const v=f(r);if(Number.isFinite(v)){if(v<lo)lo=v;if(v>hi)hi=v;}}
   if(!Number.isFinite(lo)){lo=-p.minSpan/2;hi=p.minSpan/2;}
   if(p.sym){const m=Math.max(Math.abs(lo),Math.abs(hi),p.minSpan/2)*1.15;lo=-m;hi=m;}else{lo=Math.min(lo,0);hi=Math.max(hi,0);const pad=Math.max(hi-lo,p.minSpan)*.12;if(hi-lo<p.minSpan){const mid=(hi+lo)/2;lo=Math.min(lo,mid-p.minSpan/2);hi=Math.max(hi,mid+p.minSpan/2);}lo-=pad;hi+=pad;}
   const Y=v=>p.bot-(v-lo)/(hi-lo)*(p.bot-p.top);
   c.fillStyle=text;c.textAlign='left';c.fillText(p.title,left,p.top-9);
   c.textAlign='right';for(let k=0;k<=4;k++){const v=lo+(hi-lo)*k/4;c.strokeStyle=grid;c.lineWidth=1;c.beginPath();c.moveTo(left,Y(v));c.lineTo(w-right,Y(v));c.stroke();c.fillStyle=text;c.fillText(v.toFixed(p.dec),left-8,Y(v)+4);}
   if(lo<0&&hi>0){c.strokeStyle=zero;c.lineWidth=1.4;c.beginPath();c.moveTo(left,Y(0));c.lineTo(w-right,Y(0));c.stroke();}
   c.save();c.beginPath();c.rect(left,p.top-2,w-left-right,p.bot-p.top+4);c.clip();
   for(const [color,f] of p.series){c.strokeStyle=color;c.lineWidth=2;c.beginPath();let prev=null;for(const r of data){const v=f(r);if(!Number.isFinite(v)){prev=null;continue;}if(!prev||r.at-prev.at>1500||r.ms<prev.ms)c.moveTo(X(r.at),Y(v));else c.lineTo(X(r.at),Y(v));prev=r;}c.stroke();}
   c.restore();
  }
  c.fillStyle=text;c.textAlign='center';for(const t of [-60,-40,-20,0])c.fillText(t+' s',X(now+t*1000),h-10);
  if(!data.length){c.textAlign='center';c.fillText('No recent hardware readings',w/2,h/2);}
 }
 const theme=()=>{const dark=document.documentElement.dataset.theme==='dark';$('themeToggle').textContent=dark?'Light mode':'Dark mode';$('themeToggle').setAttribute('aria-pressed',String(dark));};theme();
 $('themeToggle').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('smarthull-theme',document.documentElement.dataset.theme);}catch(e){}theme();render();};
 if(!('serial' in navigator)){$('support').textContent='USB connection requires a browser with Web Serial support. Open this page in desktop Chrome or Edge; the in-app browser may not support it.';message('Disconnected — this browser does not provide USB serial access.',true);}
 setInterval(()=>{if(port&&!closing&&!fresh()){if(capture)resetBaseline('Baseline capture interrupted by missing data. Try again after readings resume.');message(last?'Readings paused — no new valid firmware rows for at least two seconds. Check USB and firmware.':'Connected, waiting for six-column firmware readings at 115200 baud.',true);}render();},500);
 window.addEventListener('resize',render);window.addEventListener('beforeunload',e=>{if(port){e.preventDefault();e.returnValue='';}});render();
}

