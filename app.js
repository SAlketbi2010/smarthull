'use strict';
const $=id=>document.getElementById(id),M=SmartHull;
let mode='replay',kind='dual',stage='baseline',trial=M.dual[0],playTimer=null;
let yaw=-.62,pitch=.5,zoom=1,outlookProgress=0,shownDeflection=0;
const state={span:228.6,width:210};let ctx;
const fmt=(n,d=2)=>n==null?'Not recorded':n.toFixed(d);
const signed=(n,d=2)=>(n>=0?'+':'')+n.toFixed(d);
function stop(){clearInterval(playTimer);playTimer=null;$('run').textContent='Play this trial';}
function selectStage(s){stop();stage=s;update();}
function populate(){stop();kind=$('experimentType').value;const data=M[kind];$('trial').replaceChildren(...data.map(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.label;return o;}));trial=data[0];stage='baseline';update();}
function tableRows(){
 for(const key of ['dual','plate','fiber'])$(key+'Rows').innerHTML=M[key].map(t=>{
 const q=M.voltageDrop(t.bent,t.baseline),dual=key==='dual';
 const release=t.released==null?'Not recorded':dual?signed(100*(t.released/t.baseline-1))+'%':fmt(t.released,1);
 return `<tr data-trial="${t.id}"><td>${t.label}${t.flag?' *':''}</td><td>${fmt(t.baseline,dual?5:1)}</td><td>${fmt(t.bent,dual?5:1)}</td><td>${fmt(q)}%</td><td>${release}</td>${dual?`<td>≈${Math.round(t.strain).toLocaleString()}</td>`:''}</tr>`;
 }).join('');
}
function update(){
 const exploring=mode==='explore',f=M.fits[$('fitChoice').value];
 $('replayControls').hidden=exploring;$('exploreControls').hidden=!exploring;
 $('replayMode').setAttribute('aria-pressed',!exploring);$('exploreMode').setAttribute('aria-pressed',exploring);
 $('dataBanner').classList.toggle('model-mode',exploring);
 $('dataBanner').textContent=exploring?'Calculated approximation · sampled range 10–30 mm · no live hardware connection':'Recorded trial medians · stage replay · no live hardware connection';
 let deflection,value,drop,strain;
 if(exploring){
  const e=M.explore(Number($('deflectionControl').value),$('fitChoice').value);deflection=e.deflection;drop=e.drop;strain=e.mechanicalStrain;shownDeflection=deflection;
  $('deflectionValue').textContent=deflection.toFixed(1)+' mm';$('fitEquation').textContent=`q (%) ≈ ${f.slope.toFixed(5)} × δ (mm) + ${f.intercept.toFixed(5)} · R² ${f.r2.toFixed(3)} · RMSE ${f.rmse.toFixed(3)} pp`;
  $('voltageLabel').textContent='Predicted normalized decrease';$('voltage').textContent=drop.toFixed(2)+'%';$('voltageDetail').textContent='Equation output, not a measured reading';
  $('changeLabel').textContent='Fit selected';$('change').textContent=$('fitChoice').value==='all'?'All trials':'Filtered';$('changeDetail').textContent=`n = ${f.n} · in-sample descriptive fit`;
  $('phase').textContent='CALCULATED';$('guidedNarration').textContent='Move the slider to evaluate the selected straight-line approximation. Both fits remain visible in the graph.';$('scopeLine').textContent='The curved plate is an illustration. No new optical measurements, strain measurements or AI predictions are generated.';
 }else{
  value=trial[stage];drop=value==null?null:M.voltageDrop(value,trial.baseline);deflection=stage==='bent'?trial.deflection:0;strain=stage==='bent'?trial.strain:null;shownDeflection=stage==='bent'?(trial.deflection??(kind==='fiber'?38:32)):0;
  $('trialNote').textContent=trial.note;$('voltageLabel').textContent=kind==='dual'?'Recorded sensing/reference ratio':'Recorded receiver voltage';$('voltage').textContent=value==null?'Not recorded':fmt(value,kind==='dual'?5:1)+(kind==='dual'?'':' mV');$('voltageDetail').textContent=kind==='dual'?'R = sensing D35 / reference D34':'Historical single-channel median';
  $('changeLabel').textContent='Decrease from trial baseline';$('change').textContent=drop==null?'—':drop.toFixed(2)+'%';$('changeDetail').textContent=drop==null?'No paired summary available':drop<0?'Negative decrease = above baseline':kind==='dual'?'Normalized receiver-voltage decrease':'Receiver-voltage decrease';
  $('phase').textContent=stage==='baseline'?'UNLOADED':stage.toUpperCase();$('acquisition').textContent=kind==='dual'?'About eight seconds per acquisition; trial-stage medians shown.':kind==='fiber'?'Manual direct-fiber bends; radius and strain were not measured.':'Historical single-channel trials; acquisition windows differ. See report.';
  $('guidedNarration').textContent=stage==='baseline'?'Paired unloaded baseline for '+trial.label+'.':stage==='bent'?trial.note:'Release summary for '+trial.label+'. A shifted baseline can remain after a cycle.';$('scopeLine').textContent=kind==='dual'?'Separate sensing and reference analog taps. Each trial uses its own baseline; all recorded trials are retained.':'Historical dataset: kept separate from the newer ratio-based fits.';
 }
 $('deflection').textContent=deflection==null?(trial.range?'30–35 mm':'Not measured'):deflection.toFixed(1)+' mm';$('heightDetail').textContent=deflection==null?'No fixed centre height assigned':'Illustrated height: '+(60-deflection).toFixed(1)+' mm';
 if(!exploring&&kind==='fiber'){$('deflection').textContent='Not measured';$('heightDetail').textContent='Direct fiber bending; no plate';}
 $('strain').textContent=strain==null?'Not assigned':'≈'+Math.round(strain).toLocaleString()+' µε';$('strainDetail').textContent='Conditional centre bending estimate · not measured strain';
 $('sceneTitle').textContent=outlookProgress?'Future hull concept':!exploring&&kind==='fiber'?'Direct fiber bending':'Polycarbonate bending experiment';
 ['baseline','bent','released'].forEach(s=>$(s+'Stage').setAttribute('aria-pressed',s===stage));document.querySelectorAll('[data-trial]').forEach(row=>row.classList.toggle('selected',!exploring&&row.dataset.trial===trial.id));drawPlot();drawScene();
}
function drawPlot(){
 const canvas=$('plot'),c=canvas.getContext('2d'),[w,h]=size(canvas,c);c.clearRect(0,0,w,h);
 const left=57,right=25,top=22,bottom=48,pw=w-left-right,ph=h-top-bottom,X=x=>left+x/35*pw,Y=y=>top+ph-y/4.5*ph;
 c.font='11px system-ui';c.fillStyle='#526977';c.strokeStyle='#e2e8eb';
 for(let y=0;y<=4;y++){c.beginPath();c.moveTo(left,Y(y));c.lineTo(w-right,Y(y));c.stroke();c.textAlign='right';c.fillText(y,left-9,Y(y)+4);}
 c.strokeStyle='#71838b';c.beginPath();c.moveTo(left,top);c.lineTo(left,top+ph);c.lineTo(w-right,top+ph);c.stroke();c.textAlign='center';for(const x of [0,10,20,30])c.fillText(x,X(x),top+ph+19);c.fillText('Reported centre deflection (mm)',left+pw/2,h-7);
 c.save();c.translate(13,top+ph/2);c.rotate(-Math.PI/2);c.fillText('Normalized decrease (%)',0,0);c.restore();
 for(const [key,color,dash] of [['all','#80969f',[6,4]],['filtered','#896344',[]]]){const f=M.fits[key];c.strokeStyle=color;c.lineWidth=1.8;c.setLineDash(dash);c.beginPath();c.moveTo(X(10),Y(f.slope*10+f.intercept));c.lineTo(X(30),Y(f.slope*30+f.intercept));c.stroke();}c.setLineDash([]);
 M.dual.forEach((t,i)=>{const x=X(t.deflection),y=Y(t.drop);c.lineWidth=1.8;c.strokeStyle=t.flag?'#aa7138':'#315f70';c.fillStyle=t.flag?'#fff':'#315f70';c.beginPath();if(t.flag)c.rect(x-4,y-4,8,8);else c.arc(x,y,4,0,Math.PI*2);c.fill();c.stroke();c.font='10px system-ui';c.fillStyle='#385360';c.textAlign=i<3?'left':'right';c.fillText(`${t.deflection} mm T${i===1||i===3||i===0?1:2}`,x+(i<3?8:-8),y+(i===2?-10:16));});
 if(mode==='explore'){const e=M.explore(Number($('deflectionControl').value),$('fitChoice').value);c.strokeStyle='#183e50';c.lineWidth=2;c.beginPath();c.arc(X(e.deflection),Y(e.drop),7,0,Math.PI*2);c.stroke();}
}
function drawScene(){
 const canvas=$('scene');[W,H]=size(canvas,ctx);ctx.clearRect(0,0,W,H);faces=[];if(outlookProgress){drawBoatOutlook();return;}
 const fiberOnly=kind==='fiber'&&mode==='replay',d=shownDeflection;box(0,-5,0,290,8,235,['#d4dfe1','#dce5e6','#edf1f0']);
 if(!fiberOnly){for(const x of [-100,100])box(x,29,0,9,60,215,['#708994','#8fa4ad','#b0c0c5']);for(let i=0;i<32;i++){const x=-130+i*260/32,nx=-130+(i+1)*260/32,yy=u=>60-d*Math.max(0,1-(u/100)**2);face([[x,yy(x),-105],[nx,yy(nx),-105],[nx,yy(nx),105],[x,yy(x),105]],i%2?'#b9d5dc':'#b6d1da');}}
 faces.sort((a,b)=>b.depth-a.depth);for(const f of faces){ctx.beginPath();f.points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.closePath();ctx.fillStyle=f.color;ctx.fill();ctx.strokeStyle='rgba(64,96,108,.12)';ctx.stroke();}
 const path=[];for(let i=0;i<=80;i++){const x=-125+i*250/80;path.push([x,fiberOnly?65-d*Math.exp(-((x/48)**2)):62-d*Math.max(0,1-(x/100)**2),fiberOnly?15:0]);}line3(path,'#e09c4d',3,true);
 ctx.font='11px system-ui';ctx.fillStyle='#456370';ctx.textAlign='left';ctx.fillText(fiberOnly?'Fiber shape illustration · bend radius unmeasured':'Plate and fiber routing illustration · span ≈228.6 mm',16,25);
}
function initialize(){
 ctx=$('scene').getContext('2d');tableRows();populate();$('experimentType').addEventListener('change',populate);$('trial').addEventListener('change',()=>{stop();trial=M[kind].find(t=>t.id===$('trial').value);stage='baseline';update();});
 ['baseline','bent','released'].forEach(s=>$(s+'Stage').addEventListener('click',()=>selectStage(s)));
 for(const m of ['replay','explore'])$(m+'Mode').addEventListener('click',()=>{stop();mode=m;outlookProgress=0;$('outlookPanel').hidden=true;update();});for(const id of ['deflectionControl','fitChoice'])$(id).addEventListener('input',update);
 $('run').addEventListener('click',()=>{if(playTimer){stop();return;}stage='baseline';update();let i=0;$('run').textContent='Stop replay';playTimer=setInterval(()=>{stage=['baseline','bent','released'][++i];if(i===2)stop();update();},2200);});$('reset').addEventListener('click',()=>selectStage('baseline'));
 $('detailToggle').addEventListener('click',()=>{const open=$('scienceDetails').hidden;$('scienceDetails').hidden=!open;$('detailToggle').setAttribute('aria-expanded',open);$('detailToggle').textContent=open?'Hide equations':'Show equations';});
 $('showOutlook').addEventListener('click',()=>{outlookProgress=1;$('outlookPanel').hidden=false;update();});$('backToRig').addEventListener('click',()=>{outlookProgress=0;$('outlookPanel').hidden=true;update();});
 for(const [id,y,p] of [['iso',-.62,.5],['side',0,0],['top',0,1.52]])$(id).addEventListener('click',()=>{yaw=y;pitch=p;drawScene();});
 const canvas=$('scene');let drag=null;canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-drag[0])*.008;pitch=Math.max(-.4,Math.min(1.55,pitch+(e.clientY-drag[1])*.008));drag=[e.clientX,e.clientY];drawScene();});canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.6,Math.min(1.7,zoom-e.deltaY*.001));drawScene();},{passive:false});
 $('export').addEventListener('click',()=>{const rows=[['dataset','trial','deflection_mm','baseline','bent','released','unit','decrease_pct','calculated_microstrain','note']];for(const k of ['dual','plate','fiber'])M[k].forEach(t=>rows.push([k,t.label,t.deflection??'',t.baseline,t.bent,t.released??'',k==='dual'?'ratio':'mV',M.voltageDrop(t.bent,t.baseline),t.strain??'',t.note]));const csv=rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');const a=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='SmartHull-recorded-trials.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 window.addEventListener('resize',update);update();
}



