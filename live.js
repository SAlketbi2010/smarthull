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
 return {parse,median,decrease,Lines};
})();
if(typeof module!=='undefined')module.exports=LiveData;
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id);
 let port=null,reader=null,task=null,busy=false,closing=false,writing=false,last=null,rows=[],baseline=null,capture=null,drawPending=false,sessionStart=null;
 const fresh=()=>!!last&&!!port&&!closing&&Date.now()-last.at<2000;
 function message(s,error=false){$('status').textContent=s;$('status').dataset.error=error;}
 function resetBaseline(reason){baseline=null;capture=null;$('baselineInfo').textContent=reason||'No baseline captured. Keep the plate unloaded and still during capture.';}
 function render(){
  const f=fresh(),connected=!!port&&!closing;
  $('connection').textContent=busy?'CONNECTING':closing?'DISCONNECTING':!connected?'DISCONNECTED':f?'RECEIVING':'WAITING FOR DATA';
  $('connect').disabled=busy||!!port||closing||!('serial' in navigator);$('disconnect').disabled=!port||closing;
  $('enable').disabled=$('disable').disabled=!f||writing;
  $('baseline').disabled=!f||!last.valid||!!capture||writing;$('clear').disabled=baseline===null&&!capture;$('download').disabled=!rows.length;
  $('sense').textContent=f?last.sense.toFixed(2):'—';$('reference').textContent=f?last.reference.toFixed(2):'—';
  $('ratio').textContent=f&&last.valid?last.ratio.toFixed(6):'—';const q=f&&last.valid?LiveData.decrease(last.ratio,baseline):null;
  $('decrease').textContent=q===null?'—':q.toFixed(2)+'%';
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
    if(elapsed>=5000){if(capture.values.length>=30){baseline=LiveData.median(capture.values);$('baselineInfo').textContent=`Unloaded baseline R₀ = ${baseline.toFixed(6)} · median of ${capture.values.length} samples · captured ${new Date().toLocaleTimeString()}`;capture=null;}else resetBaseline('Too few samples for a baseline. Try again.');}
    else $('baselineInfo').textContent=`Capturing unloaded baseline… ${Math.ceil((5000-elapsed)/1000)} s remaining. Keep still.`;
   }
  }
  r.baseline=baseline;r.decrease=LiveData.decrease(r.ratio,baseline);rows.push(r);if(rows.length>36000)rows.shift();last=r;
  message(r.valid?'Receiving real hardware readings · USB connection · data stays in this tab':r.status==='DRIVE_ZERO'?'Transmitter drive is off. Click Enable transmitter drive when ready.':'Receiving readings · '+r.status.replaceAll('_',' '),!r.valid);render();
 }
 async function readLoop(active){
  const lines=new LiveData.Lines(),decoder=new TextDecoder();
  try{reader=active.readable.getReader();while(!closing){const {value,done}=await reader.read();if(done)break;for(const row of lines.push(decoder.decode(value,{stream:true})))accept(row);}}
  catch(e){if(!closing)message('USB reading stopped. Reconnect the ESP32. '+e.message,true);}
  finally{if(reader)reader.releaseLock();reader=null;while(writing)await new Promise(r=>setTimeout(r,20));try{await active.close();}catch(e){}if(port===active)port=null;closing=false;resetBaseline('Disconnected. Reconnect and capture a new baseline.');if(!$('status').dataset.error||$('status').dataset.error==='false')message('Disconnected — recorded session remains available for CSV export.');render();}
 }
 $('connect').onclick=async()=>{
  busy=true;render();let selected;
  try{selected=await navigator.serial.requestPort();await selected.open({baudRate:115200});port=selected;last=null;rows=[];sessionStart=new Date().toISOString();resetBaseline();message('Port connected. Waiting for firmware readings…');task=readLoop(selected);}
  catch(e){message(e.name==='NotFoundError'?'Connection cancelled. Select your ESP32 when ready.':'Could not open the port. Close VS Code Serial Monitor and other serial readers, then retry. '+e.message,true);}
  finally{busy=false;render();}
 };
 $('disconnect').onclick=async()=>{closing=true;render();if(reader)await reader.cancel().catch(()=>{});if(task)await task;message('Disconnected — recorded session remains available for CSV export.');};
 async function command(char){if(!fresh()||writing)return;writing=true;resetBaseline('Drive command sent. Wait for valid readings, then capture a new baseline.');render();let writer;
  try{writer=port.writable.getWriter();await writer.write(new TextEncoder().encode(char));}
  catch(e){message('Could not send drive command: '+e.message,true);}
  finally{if(writer)writer.releaseLock();writing=false;render();}
 }
 $('enable').onclick=()=>command('l');$('disable').onclick=()=>command('d');
 $('baseline').onclick=()=>{if(!fresh()||!last.valid)return;baseline=null;capture={start:Date.now(),lastAt:Date.now(),drive:last.drive,values:[]};$('baselineInfo').textContent='Capturing unloaded baseline… keep still for five seconds.';render();};
 $('clear').onclick=()=>{resetBaseline();render();};
 $('download').onclick=()=>{const header=['received_utc','device_ms','drive','sensing_D35_mV','reference_D34_mV','ratio','baseline_ratio','decrease_pct','status'];const data=rows.map(r=>[r.utc,r.ms,r.drive,r.sense,r.reference,r.ratio??'',r.baseline??'',r.decrease??'',r.status]);const csv=[header,...data].map(r=>r.join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='SmartHull-live-'+(sessionStart||new Date().toISOString()).replaceAll(':','-')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 function plot(){
  const canvas=$('livePlot'),c=canvas.getContext('2d'),w=canvas.clientWidth,h=300,dpr=window.devicePixelRatio||1;if(!w)return;canvas.width=w*dpr;canvas.height=h*dpr;c.setTransform(dpr,0,0,dpr,0,0);
  const dark=document.documentElement.dataset.theme==='dark',text=dark?'#bcd0da':'#526977',grid=dark?'#344954':'#dce5e9';const now=Date.now(),data=rows.filter(r=>now-r.at<=60000),left=55,right=20,top=20,bottom=38,X=t=>left+(t-(now-60000))/60000*(w-left-right),Y=v=>h-bottom-v/3300*(h-top-bottom);
  c.font='11px system-ui';c.fillStyle=text;c.textAlign='right';for(const v of [0,1000,2000,3000]){c.strokeStyle=grid;c.beginPath();c.moveTo(left,Y(v));c.lineTo(w-right,Y(v));c.stroke();c.fillText(v,left-8,Y(v)+4);}
  c.textAlign='center';for(const t of [-60,-40,-20,0])c.fillText(t+' s',X(now+t*1000),h-14);c.textAlign='left';c.fillText('mV',10,15);
  for(const [key,color] of [['sense','#30a4bb'],['reference','#de9b46']]){c.strokeStyle=color;c.lineWidth=2;c.beginPath();let prev=null;for(const r of data){if(!prev||r.at-prev.at>1500||r.ms<prev.ms)c.moveTo(X(r.at),Y(r[key]));else c.lineTo(X(r.at),Y(r[key]));prev=r;}c.stroke();}
  if(!data.length){c.textAlign='center';c.fillText('No recent hardware readings',w/2,h/2);}
 }
 const theme=()=>{const dark=document.documentElement.dataset.theme==='dark';$('themeToggle').textContent=dark?'Light mode':'Dark mode';$('themeToggle').setAttribute('aria-pressed',String(dark));};theme();
 $('themeToggle').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('smarthull-theme',document.documentElement.dataset.theme);}catch(e){}theme();render();};
 if(!('serial' in navigator)){$('support').textContent='USB connection requires a browser with Web Serial support. Open this page in desktop Chrome or Edge; the in-app browser may not support it.';message('Disconnected — this browser does not provide USB serial access.',true);}
 setInterval(()=>{if(port&&!closing&&!fresh()){if(capture)resetBaseline('Baseline capture interrupted by missing data. Try again after readings resume.');message(last?'Readings paused — no new valid firmware rows for at least two seconds. Check USB and firmware.':'Connected, waiting for six-column firmware readings at 115200 baud.',true);}render();},500);
 window.addEventListener('resize',render);window.addEventListener('beforeunload',e=>{if(port){e.preventDefault();e.returnValue='';}});render();
}

