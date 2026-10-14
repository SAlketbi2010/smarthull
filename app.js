'use strict';
const $=id=>document.getElementById(id),scene=$('scene'),ctx=scene.getContext('2d'),plot=$('plot'),pc=plot.getContext('2d');
const state={mass:350,span:200,width:50,thickness:3,modulus:2.3,gauge:50,maxMass:1000,stepSize:100,cycles:3,repeats:5,coefficient:.00025,hyst:100,drift:0,noise:2,unload:false,cycle:0};
let scientific=false;
let outlookProgress=0,outlookAvailable=false,outlookFrame=null,outlookCamera=null;

let history=[],reading={},completed=[],running=false,timer=null,queue=[],position=0,seed=4571,yaw=-.65,pitch=.48,zoom=1,lastPointer=null,chartPoints=[],fit=null,runId=0;
const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
const normal=()=>Math.sqrt(-2*Math.log(Math.max(1e-10,rand())))*Math.cos(2*Math.PI*rand());
function calculate(s,n1=0,n2=0){const f=s.mass*.00981,L=s.span/1000,b=s.width/1000,h=s.thickness/1000,E=s.modulus*1e9;const strain=3*f*L/(2*E*b*h*h)*1e6,deflection=f*L**3/(4*E*b*h**3)*1000,gaugeStrain=strain*(1-s.gauge/(2*s.span));const hyst=s.unload?s.hyst*Math.sin(Math.PI*s.mass/s.maxMass):0;const rawSense=2*(1+s.drift/100)*Math.exp(-s.coefficient*(gaugeStrain+hyst))+s.noise/1000*n1,rawRef=2*(1+s.drift/100)+s.noise/1000*n2;const sense=Math.max(1e-6,rawSense),ref=Math.max(1e-6,rawRef);return{force:f,strain,gaugeStrain,deflection,sense,ref,ratio:sense/ref,raw:-Math.log(sense/2)/s.coefficient,estimate:-Math.log(sense/ref)/s.coefficient,clipped:rawSense<=0||rawRef<=0};}
const number=x=>Number.isFinite(x)?Math.round(x).toLocaleString():'—';
function preview(){reading=calculate(state);update();}
function capture(manual=false){reading=calculate(state,normal(),normal());history.push({...state,...reading,cycle:manual?0:state.cycle,sample:history.length+1});fit=null;update();}
function stop(){running=false;clearInterval(timer);timer=null;queue=[];$('run').textContent='Run acquisition';lock(false);}
function lock(on){for(const id of ['span','width','thickness','modulus','gauge','maxMass','stepSize','cycles','repeats','coefficient','hyst','noise','mass','sample'])$(id).disabled=on;}
function clearData(){returnToRig();outlookAvailable=false;stop();history=[];completed=[];state.cycle=0;runId=0;fit=null;$('fitResult').textContent='Run at least two complete cycles to fit a calibration.';$('pointDetail').textContent='No reading selected.';}
function update(){for(const id of ['mass','drift','noise'])$(id).value=state[id];$('massVal').textContent=state.mass+' g';$('driftVal').textContent=(state.drift>=0?'+':'')+state.drift+'%';$('noiseVal').textContent=state.noise+' mV';$('reference').innerHTML=number(reading.strain)+' <small>µε</small>';$('gaugeStrain').innerHTML=number(reading.gaugeStrain)+' <small>µε</small>';$('deflection').innerHTML=reading.deflection.toFixed(3)+' <small>mm</small>';$('raw').textContent=number(reading.raw)+' µε';$('ratio').textContent=number(reading.estimate)+' µε';$('rawError').textContent='Error vs εg: '+number(reading.raw-reading.gaugeStrain)+' µε';$('ratioError').textContent='Error vs εg: '+number(reading.estimate-reading.gaugeStrain)+' µε';$('senseV').textContent=reading.sense.toFixed(4)+' V';$('refV').textContent=reading.ref.toFixed(4)+' V';$('ratioV').textContent=reading.ratio.toFixed(4);$('senseBar').style.width=Math.min(100,reading.sense/3.3*100)+'%';$('refBar').style.width=Math.min(100,reading.ref/3.3*100)+'%';$('phase').textContent=(running?'CYCLE '+state.cycle+' / ':'')+(state.unload?'UNLOADING':'LOADING');$('geometryLabel').textContent='L = '+state.span+' mm · b = '+state.width+' mm · h = '+state.thickness+' mm';$('sampleCount').textContent=history.length+' samples · '+completed.length+' complete cycles';$('acquisition').textContent=running?'Acquiring '+(position+1)+' / '+queue.length+' load steps.':history.length?'Acquisition stopped. '+completed.length+' complete cycles retained.':'No experiment running.';let warnings=[];if(reading.deflection/state.span>.05)warnings.push('δ/L > 5%: small-deflection assumption questionable');if(state.span/state.thickness<20)warnings.push('L/h < 20: shear effects may matter');if(state.width/state.span>.3)warnings.push('b/L > 0.3: assess plate effects');if(reading.clipped)warnings.push('Nonpositive detector value floored for logarithm');$('validity').textContent=warnings.length?warnings.join(' · '):'Flat-beam approximation · δ/L = '+(100*reading.deflection/state.span).toFixed(2)+'% · model checks are indicative, not validation';$('validity').classList.toggle('warning',!!warnings.length);$('dataRows').innerHTML=history.slice(-8).reverse().map(r=>'<tr><td>'+r.sample+'</td><td>'+(r.cycle||'Manual')+' / '+(r.unload?'Unload':'Load')+'</td><td>'+r.mass+'</td><td>'+r.gaugeStrain.toFixed(1)+'</td><td>'+r.sense.toFixed(4)+'</td><td>'+r.ref.toFixed(4)+'</td><td>'+r.ratio.toFixed(4)+'</td></tr>').join('');if(!fit)$('fitResult').textContent=completed.length>=2?'Data ready. Fit a model to evaluate the final complete cycle.':'Run at least two complete cycles to fit a calibration.';updateWarning();$('run').textContent=running?'Stop demonstration':(scientific?'Run acquisition':'Run demonstration');if(!scientific)$('acquisition').textContent=running?'Loading and unloading the specimen…':(history.length?'Demonstration stopped. Adjust the weight to explore.':'Start with the weight slider, or run a demonstration.');drawScene();drawPlot();}
for(const id of ['span','width','thickness','modulus','gauge','maxMass','stepSize','cycles','repeats','coefficient','hyst','noise'])$(id).addEventListener('change',e=>{const v=+e.target.value;if(!e.target.checkValidity()||!Number.isFinite(v)){e.target.reportValidity();e.target.value=state[id];return;}clearData();state[id]=v;state.gauge=Math.min(state.gauge,state.span);$('gauge').value=state.gauge;state.mass=Math.min(state.mass,state.maxMass);$('mass').max=state.maxMass;state.unload=false;preview();});
$('mass').oninput=e=>{returnToRig();const m=+e.target.value;state.unload=m<state.mass;state.mass=m;preview();};$('drift').oninput=e=>{state.drift=+e.target.value;preview();};$('sample').onclick=()=>capture(true);$('reset').onclick=()=>{clearData();seed=4571;state.unload=false;preview();};
$('run').onclick=()=>{if(running){stop();update();return;}returnToRig();outlookAvailable=false;running=true;queue=[];position=0;lock(true);$('run').textContent='Stop acquisition';for(let c=0;c<state.cycles;c++){const cycle=++runId,loads=[0];for(let m=state.stepSize;m<state.maxMass;m+=state.stepSize)loads.push(m);loads.push(state.maxMass);loads.forEach(m=>queue.push({mass:m,unload:false,cycle}));loads.slice(0,-1).reverse().forEach(m=>queue.push({mass:m,unload:true,cycle}));queue[queue.length-1].end=true;}function tick(){const q=queue[position];Object.assign(state,{mass:q.mass,unload:q.unload,cycle:q.cycle});for(let j=0;j<state.repeats;j++)capture();if(q.end)completed.push(q.cycle);position++;const finished=position>=queue.length;if(finished)stop();update();if(finished){outlookAvailable=true;startOutlook();}}tick();if(running)timer=setInterval(tick,150);};
$('exaggerate').onchange=()=>drawScene();$('plotMode').onchange=drawPlot;
$('export').onclick=()=>{const keys=['sample','cycle','mass','unload','span','width','thickness','modulus','gauge','maxMass','stepSize','repeats','drift','noise','coefficient','hyst','force','strain','gaugeStrain','deflection','sense','ref','ratio','raw','estimate','clipped'];const labels=['sample','cycle_0_is_manual','mass_g','unloading','span_mm','width_mm','thickness_mm','E_GPa','gauge_length_mm','max_mass_g','step_g','readings_per_step','drift_percent','noise_mV_RMS','k_per_microstrain','Hmax_microstrain','force_N','center_microstrain','gauge_microstrain','deflection_mm','Vs_V','Vr_V','Vs_over_Vr','raw_microstrain','ratio_microstrain','log_floor_applied'];const rows=history.map(r=>['synthetic',completed.includes(r.cycle),...keys.map(k=>r[k])].join(','));const csv=['data_type,complete_cycle,'+labels.join(','),...rows].join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='smarthull-synthetic-experiment.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function solve(A,b){const n=b.length,a=A.map((r,i)=>[...r,b[i]]);for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[p][i]))p=j;[a[i],a[p]]=[a[p],a[i]];if(Math.abs(a[i][i])<1e-10)throw Error('Insufficient variation for this calibration.');const d=a[i][i];for(let k=i;k<=n;k++)a[i][k]/=d;for(let j=0;j<n;j++)if(j!==i){const m=a[j][i];for(let k=i;k<=n;k++)a[j][k]-=m*a[i][k];}}return a.map(r=>r[n]);}
function regress(train,test,degree,input){const xs=r=>input==='ratio'?1-r.ratio:1-r.sense/2,mu=train.reduce((a,r)=>a+xs(r),0)/train.length,scale=Math.sqrt(train.reduce((a,r)=>a+(xs(r)-mu)**2,0)/train.length);if(scale<1e-9)throw Error('Optical input has insufficient variation.');const p=degree+1,A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);for(const r of train){const z=(xs(r)-mu)/scale;for(let i=0;i<p;i++){b[i]+=z**i*r.gaugeStrain;for(let j=0;j<p;j++)A[i][j]+=z**(i+j);}}const beta=solve(A,b),predict=r=>beta.reduce((v,c,i)=>v+c*((xs(r)-mu)/scale)**i,0),mean=test.reduce((a,r)=>a+r.gaugeStrain,0)/test.length;let sse=0,abs=0,bias=0,sst=0;for(const r of test){const e=predict(r)-r.gaugeStrain;sse+=e*e;abs+=Math.abs(e);bias+=e;sst+=(r.gaugeStrain-mean)**2;}return{beta,mu,scale,rmse:Math.sqrt(sse/test.length),mae:abs/test.length,bias:bias/test.length,r2:sst?1-sse/sst:NaN};}
$('fit').onclick=()=>{if(running){$('fitResult').textContent='Stop acquisition or wait for completion before fitting.';return;}if(completed.length<2){$('fitResult').textContent='At least two complete cycles are required. Manual readings do not count.';return;}const held=completed.at(-1),train=history.filter(r=>completed.includes(r.cycle)&&r.cycle!==held),test=history.filter(r=>r.cycle===held);try{fit=regress(train,test,+$('model').value,$('inputMode').value);$('fitResult').innerHTML='<b>Train: '+(completed.length-1)+' cycles ('+train.length+' readings) · Test: cycle '+held+' ('+test.length+' readings)</b><div class="fit-metrics"><span>Test RMSE<strong>'+fit.rmse.toFixed(1)+' µε</strong></span><span>Test MAE<strong>'+fit.mae.toFixed(1)+' µε</strong></span><span>Test R²<strong>'+fit.r2.toFixed(4)+'</strong></span><span>Test bias<strong>'+fit.bias.toFixed(1)+' µε</strong></span></div><p><code>εg = '+fit.beta.map((c,i)=>c.toFixed(3)+(i?'z'+(i>1?'²':''):'')).join(' + ')+'; z = (x − '+fit.mu.toFixed(5)+') / '+fit.scale.toFixed(5)+'</code></p><small>x = '+($('inputMode').value==='ratio'?'1 − Vs/Vr':'1 − Vs/2 V')+'. Metrics describe held-out synthetic observations only.</small>';}catch(e){$('fitResult').textContent=e.message;}};
for(const id of ['model','inputMode'])$(id).onchange=()=>{fit=null;$('fitResult').textContent='Model selection changed. Fit calibration to update results.';};
function size(canvas,c){const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);c.setTransform(dpr,0,0,dpr,0,0);return[rect.width,rect.height];}
let W=0,H=0,faces=[];
function transform(p){const x=p[0]*state.span/200,y=p[1],z=p[2]*state.width/50,xx=x*Math.cos(yaw)+z*Math.sin(yaw),zz=-x*Math.sin(yaw)+z*Math.cos(yaw);return[xx,y*Math.cos(pitch)-zz*Math.sin(pitch),y*Math.sin(pitch)+zz*Math.cos(pitch)];}
function project(p){const [x,y,z]=transform(p),scale=Math.min(W/360,H/245)*zoom*(1-.72*outlookProgress),depth=650/(650+z);return[W*.5+x*scale*depth,H*.65-y*scale*depth,z];}
function face(points,color){faces.push({points,color,depth:points.reduce((a,p)=>a+transform(p)[2],0)/points.length});}
function box(x,y,z,w,h,d,colors=['#929ea5','#a8b4ba','#c0cbd0']){const a=[x-w/2,y-h/2,z-d/2],b=[x+w/2,y-h/2,z-d/2],c=[x+w/2,y-h/2,z+d/2],e=[x-w/2,y-h/2,z+d/2];const tops=[a,b,c,e].map(p=>[p[0],p[1]+h,p[2]]);face([a,b,tops[1],tops[0]],colors[0]);face([b,c,tops[2],tops[1]],colors[1]);face([c,e,tops[3],tops[2]],colors[0]);face([e,a,tops[0],tops[3]],colors[1]);face(tops,colors[2]);}
function cylinder(x,y,z,r,h){const n=28,top=[],bottom=[];for(let i=0;i<n;i++){const t=i/n*Math.PI*2;top.push([x+r*Math.cos(t),y+h/2,z+r*Math.sin(t)]);bottom.push([x+r*Math.cos(t),y-h/2,z+r*Math.sin(t)]);}for(let i=0;i<n;i++)face([bottom[i],bottom[(i+1)%n],top[(i+1)%n],top[i]],i%4===0?'#8091a4':'#64788e');face(top,'#abb9c6');}
function line3(points,color,width=1,glow=false){ctx.beginPath();points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.strokeStyle=color;ctx.lineWidth=width;if(glow){ctx.shadowColor=color;ctx.shadowBlur=8;}ctx.stroke();ctx.shadowBlur=0;}
function beamY(x){const q=(100-Math.abs(x))/200;return 60-reading.deflection*($('exaggerate').checked?6:1)*q*(3-4*q*q);}
function drawRigScene(){[W,H]=size(scene,ctx);ctx.clearRect(0,0,W,H);ctx.globalAlpha=Math.max(0,1-outlookProgress*1.5);faces=[];
for(let x=-180;x<=180;x+=20)line3([[x,-14,-120],[x,-14,120]],'#d8dfe2',.6);for(let z=-120;z<=120;z+=20)line3([[-180,-14,z],[180,-14,z]],'#d8dfe2',.6);
box(0,-5,0,270,12,130,['#b4bcc0','#c3cace','#d5dbde']);for(const x of [-99,99]){box(x,(53-state.thickness)/2,0,16,51-state.thickness,65);box(x,56-state.thickness,0,26,8,60,['#62778a','#465d72','#92a5b5']);}
for(let i=0;i<40;i++){const x=-100+i*5,n=x+5,a=beamY(x),b=beamY(n);face([[x,a,-24],[n,b,-24],[n,b,24],[x,a,24]],'#d8e5eacc');face([[x,a-state.thickness,24],[n,b-state.thickness,24],[n,b,24],[x,a,24]],'#9baeb8');face([[x,a-state.thickness,-24],[n,b-state.thickness,-24],[n,b,-24],[x,a,-24]],'#b8c8cf');}
const center=beamY(0);box(0,center+6,0,13,12,47,['#435b70','#698298','#93a8b7']);box(0,center+23,0,7,30,7,['#73899c','#879fb3','#b9c5cd']);const count=Math.ceil(state.mass/100);for(let i=0;i<count;i++){const dh=4*Math.min(1,(state.mass-i*100)/100);cylinder(0,center+38+i*4+dh/2,0,18,dh);}
box(-100,2,78,34,10,25,['#b8c2bd','#c3cfca','#d2dad4']);box(96,2,78,36,10,28,['#9ba9b0','#b1bec5','#ccd4d9']);
faces.sort((a,b)=>b.depth-a.depth);for(const f of faces){ctx.beginPath();f.points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.closePath();ctx.fillStyle=f.color;ctx.fill();ctx.strokeStyle=f.color;ctx.lineWidth=.5;ctx.stroke();}
const fiber=[[-100,10,78],[-126,12,70],[-130,45,20],[-101,beamY(-100)-state.thickness,15]];for(let i=0;i<=80;i++){const x=-100+i*2.5;fiber.push([x,beamY(x)-state.thickness,15]);}fiber.push([125,43,20],[128,12,68],[96,10,78]);ctx.setLineDash([3,3]);line3(fiber,'#326e8b',1.3);ctx.setLineDash([]);const gauge=[];for(let j=0;j<=30;j++){const x=(-state.gauge/2+state.gauge*j/30)*200/state.span;gauge.push([x,beamY(x)-state.thickness,15]);}line3(gauge,'#244f63',2.6);line3([[-100,10,78],[-55,12,96],[55,12,96],[96,10,78]],'#a97a47',1.5);
for(const [p,color] of [[[-100,11,78],'#3f6f77'],[[96,11,78],'#ac854f']]){const q=project(p);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=0;ctx.beginPath();ctx.arc(q[0],q[1],3,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
line3([[-100,-12,-45],[100,-12,-45]],'#7d8b93',1);const dim=project([0,-12,-45]);ctx.fillStyle='#536773';ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillText('Support span '+state.span+' mm',dim[0],dim[1]+14);if(W>470){const labels=[{p:[-115,47,-26],t:'ROLLER SUPPORT',dx:-35,dy:-24},{p:[45,beamY(45),24],t:'GAUGE '+state.gauge+' mm',dx:35,dy:18},{p:[0,center+45+count*5,0],t:state.mass+' g',dx:30,dy:-12}];ctx.font='10px system-ui';for(const l of labels){const p=project(l.p),x=p[0]+l.dx,y=p[1]+l.dy;ctx.strokeStyle='#7c909f';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(x,y);ctx.stroke();ctx.fillStyle='#41515e';ctx.textAlign=l.dx<0?'right':'left';ctx.fillText(l.t,x+(l.dx<0?-4:4),y);}}
}
function drawScene(){
 if(outlookProgress<1){drawRigScene();ctx.globalAlpha=1;}else{[W,H]=size(scene,ctx);ctx.clearRect(0,0,W,H);}
 if(outlookProgress>0)drawBoatOutlook();
 syncOutlookUI();
}
scene.onpointerdown=e=>{lastPointer=[e.clientX,e.clientY];scene.setPointerCapture(e.pointerId);};scene.onpointermove=e=>{if(!lastPointer)return;yaw+=(e.clientX-lastPointer[0])*.008;pitch=Math.max(-.4,Math.min(1.4,pitch+(e.clientY-lastPointer[1])*.006));lastPointer=[e.clientX,e.clientY];drawScene();};scene.onpointerup=scene.onpointercancel=()=>lastPointer=null;scene.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.65,Math.min(1.5,zoom-e.deltaY*.001));drawScene();},{passive:false});
$('iso').onclick=()=>{yaw=-.65;pitch=.48;zoom=1;drawScene();};$('side').onclick=()=>{yaw=0;pitch=.12;zoom=1;drawScene();};$('top').onclick=()=>{yaw=0;pitch=1.38;zoom=1;drawScene();};
function drawPlot(){const[w,h]=size(plot,pc);pc.clearRect(0,0,w,h);chartPoints=[];const mode=$('plotMode').value,data=history.slice(-500),left=64,right=w-24,top=30,bottom=h-45;let series,xLabel,yLabel;if(mode==='response'){series=[{name:'Loading',color:'#326b87',rows:data.filter(r=>!r.unload),x:r=>r.gaugeStrain,y:r=>r.ratio},{name:'Unloading',color:'#aa7138',rows:data.filter(r=>r.unload),x:r=>r.gaugeStrain,y:r=>r.ratio}];xLabel='Gauge-average reference strain (µε)';yLabel='Vs / Vr';}else{series=[{name:'Sensing only',color:'#aa7138',rows:data,x:r=>mode==='history'?r.sample:r.gaugeStrain,y:r=>mode==='history'?r.raw:r.raw-r.gaugeStrain},{name:'Ratio inversion',color:'#326b87',rows:data,x:r=>mode==='history'?r.sample:r.gaugeStrain,y:r=>mode==='history'?r.estimate:r.estimate-r.gaugeStrain}];if(mode==='history')series.unshift({name:'Mechanical εg',color:'#79878e',rows:data,x:r=>r.sample,y:r=>r.gaugeStrain});xLabel=mode==='history'?'Sample index':'Gauge-average reference strain (µε)';yLabel=mode==='history'?'Strain (µε)':'Error (µε)';}$('legend').innerHTML=series.map(s=>'<span><i style="background:'+s.color+'"></i>'+s.name+'</span>').join('');const xs=series.flatMap(s=>s.rows.map(s.x)),ys=series.flatMap(s=>s.rows.map(s.y));let xmin=xs.length?Math.min(...xs):0,xmax=xs.length?Math.max(...xs):1,ymin=ys.length?Math.min(...ys):0,ymax=ys.length?Math.max(...ys):1;if(mode==='residual'){ymin=Math.min(0,ymin);ymax=Math.max(0,ymax);}const dx=(xmax-xmin)||1,dy=(ymax-ymin)||.1;xmin-=dx*.05;xmax+=dx*.05;ymin-=dy*.1;ymax+=dy*.1;const X=v=>left+(v-xmin)/(xmax-xmin)*(right-left),Y=v=>bottom-(v-ymin)/(ymax-ymin)*(bottom-top);pc.font='11px system-ui';pc.lineWidth=1;for(let i=0;i<=3;i++){const y=ymin+(ymax-ymin)*i/3,py=Y(y);pc.strokeStyle='#e4e8eb';pc.beginPath();pc.moveTo(left,py);pc.lineTo(right,py);pc.stroke();pc.fillStyle='#64747d';pc.textAlign='right';pc.fillText(mode==='response'?y.toFixed(3):number(y),left-8,py+4);const x=xmin+(xmax-xmin)*i/3;pc.textAlign='center';pc.fillText(number(x),X(x),bottom+18);}pc.strokeStyle='#c2cdd3';pc.strokeRect(left,top,right-left,bottom-top);pc.fillStyle='#52616b';pc.textAlign='left';pc.fillText(yLabel,left,15);pc.textAlign='center';pc.fillText(xLabel,(left+right)/2,h-7);if(!data.length){pc.fillStyle='#7d8b93';pc.fillText('Capture a reading or run an acquisition.',(left+right)/2,(top+bottom)/2);return;}pc.save();pc.beginPath();pc.rect(left,top,right-left,bottom-top);pc.clip();for(const s of series){if(mode==='history'){pc.beginPath();s.rows.forEach((r,i)=>i?pc.lineTo(X(s.x(r)),Y(s.y(r))):pc.moveTo(X(s.x(r)),Y(s.y(r))));pc.strokeStyle=s.color;pc.lineWidth=1.3;pc.stroke();}for(const r of s.rows){const x=X(s.x(r)),y=Y(s.y(r));pc.beginPath();if(r.unload)pc.rect(x-2,y-2,4,4);else pc.arc(x,y,2.2,0,Math.PI*2);pc.fillStyle=s.color;pc.globalAlpha=.75;pc.fill();pc.globalAlpha=1;chartPoints.push({x,y,r});}}pc.restore();}
plot.addEventListener('pointermove',e=>{if(!chartPoints.length)return;const rect=plot.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;let best=null,d=Infinity;for(const p of chartPoints){const nd=(p.x-x)**2+(p.y-y)**2;if(nd<d){d=nd;best=p;}}if(best){const r=best.r;$('pointDetail').textContent='Sample '+r.sample+' · '+(r.cycle?'Cycle '+r.cycle:'Manual')+' · '+(r.unload?'Unload':'Load')+' · '+r.mass+' g · εg '+r.gaugeStrain.toFixed(1)+' µε · Vs/Vr '+r.ratio.toFixed(4);}});
new ResizeObserver(()=>{if(reading.strain!==undefined)drawScene();}).observe(scene.parentElement);new ResizeObserver(()=>drawPlot()).observe(plot.parentElement);

function updateWarning(){
 const limit=+$('warningLimit').value||2000,ratio=reading.estimate/limit;
 const level=ratio>=1?'high':ratio>=.8?'caution':'below';
 $('limitValue').textContent=number(limit)+' µε';
 $('strainWarning').classList.toggle('high',level==='high');
 $('strainWarning').classList.toggle('caution',level==='caution');
 const title=level==='high'?'High strain — demonstration alert':level==='caution'?'Approaching the demonstration limit':'Below the demonstration limit';
 const text=level==='high'?'The sensor estimate has crossed the chosen limit. Reduce the weight to see the warning clear.':level==='caution'?'The estimate is within 20% of the chosen limit. Adding more weight may trigger the alert.':'Add weight to increase the strain. This status does not certify structural safety.';
 if($('warningTitle').textContent!==title)$('warningTitle').textContent=title;
 if($('warningText').textContent!==text)$('warningText').textContent=text;
 $('warningReading').textContent=number(reading.estimate)+' / '+number(limit)+' µε';
}
$('warningLimit').oninput=updateWarning;
$('detailToggle').onclick=()=>{scientific=!scientific;document.body.classList.toggle('simple-mode',!scientific);$('detailToggle').setAttribute('aria-pressed',String(scientific));$('detailToggle').textContent=scientific?'Hide scientific detail':'Show scientific detail';update();};

function syncOutlookUI(){
 const active=outlookProgress>0;
 $('outlookPanel').hidden=!active;
 $('outlookReturn').hidden=active||!outlookAvailable;
 $('sceneTitle').textContent=active?'From a sensing region to the whole boat':'The test rig';
 $('sceneCaption').textContent=active?'Future concept · illustrative sensor locations':'Drag to rotate · wheel to zoom · dashed fiber: underside';
 $('scene').closest('.apparatus').classList.toggle('outlook-active',active);
 if(active){$('phase').textContent='FUTURE APPLICATION';$('acquisition').textContent='Acquisition complete. Your bench data is retained below.';}
}
function returnToRig(){
 if(outlookFrame!==null){cancelAnimationFrame(outlookFrame);outlookFrame=null;}
 outlookProgress=0;
 if(outlookCamera){({yaw,pitch,zoom}=outlookCamera);outlookCamera=null;}
 syncOutlookUI();
}
function startOutlook(){
 if(!outlookAvailable||running)return;
 if(outlookFrame!==null)cancelAnimationFrame(outlookFrame);
 if(!outlookCamera)outlookCamera={yaw,pitch,zoom};
 yaw=-.58;pitch=.46;zoom=1;outlookProgress=0;
 if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){outlookProgress=1;drawScene();return;}
 let began=null;
 const frame=now=>{if(began===null)began=now;const t=Math.min(1,(now-began)/2600);outlookProgress=t*t*(3-2*t);drawScene();if(t<1)outlookFrame=requestAnimationFrame(frame);else outlookFrame=null;};
 outlookFrame=requestAnimationFrame(frame);
}
function drawBoatOutlook(){
 const t=outlookProgress,opacity=Math.min(1,Math.max(0,(t-.12)/.65));
 if(opacity<=0)return;
 const scale=Math.min(W/440,H/260)*zoom*(1.65-.65*t),cy=H*.53;
 const tr=p=>{const[x,y,z]=p,xx=x*Math.cos(yaw)+z*Math.sin(yaw),zz=-x*Math.sin(yaw)+z*Math.cos(yaw);return[xx,y*Math.cos(pitch)-zz*Math.sin(pitch),y*Math.sin(pitch)+zz*Math.cos(pitch)];};
 const pr=p=>{const[x,y,z]=tr(p),depth=850/(850+z);return[W/2+x*scale*depth,cy-y*scale*depth];};
 const hullFaces=[];
 const add=(pts,color)=>hullFaces.push({pts,color,z:pts.reduce((a,p)=>a+tr(p)[2],0)/pts.length});
 const cube=(x,y,z,w,h,d,colors)=>{const a=[x-w/2,y,z-d/2],b=[x+w/2,y,z-d/2],c=[x+w/2,y,z+d/2],d0=[x-w/2,y,z+d/2],top=[a,b,c,d0].map(p=>[p[0],p[1]+h,p[2]]);for(let j=0;j<4;j++)add([[a,b,c,d0][j],[a,b,c,d0][(j+1)%4],top[(j+1)%4],top[j]],colors[j%2]);add(top,colors[2]);};
 // A conceptual hull, independent of the bench specimen's dimensions or strain data.
 const stations=[[-160,29],[-140,40],[-105,44],[-60,46],[0,46],[60,42],[110,31],[145,16],[170,0]];
 const deck=[];
 for(let i=0;i<stations.length-1;i++){
  const[x,w]=stations[i],[nx,nw]=stations[i+1];
  for(const side of [-1,1]){
   add([[x,17,side*w],[nx,17,side*nw],[nx,-12,side*nw*.78],[x,-12,side*w*.78]],side===-1?'#a9c2cc':'#93afbc');
   add([[x,-12,side*w*.78],[nx,-12,side*nw*.78],[nx,-35,0],[x,-35,0]],side===-1?'#567e91':'#476f83');
  }
 }
 for(const[x,w]of stations)deck.push([x,17,-w]);
 for(const[x,w]of [...stations].reverse())deck.push([x,17,w]);
 add(deck,'#e3eaeb');add([[-160,17,-29],[-160,17,29],[-160,-12,23],[-160,-35,0],[-160,-12,-23]],'#90aab7');
 cube(-95,18,0,62,34,56,['#d1dbdf','#bdccd3','#edf1f2']);
 cube(-91,52,0,70,5,62,['#97abb7','#8199a7','#c7d6dc']);
 cube(-95,31,-28.5,45,13,1,['#476b7d','#476b7d','#476b7d']);
 cube(-62.5,31,0,1,13,39,['#567e91','#567e91','#567e91']);
 cube(-103,57,0,3,30,3,['#829aa5','#829aa5','#829aa5']);
 // A highlighted local region ties the enlarged boat to the bench sensing principle.
 add([[-28,11,-46.5],[32,11,-44.5],[32,-8,-36.9],[-28,-8,-37.8]],'#cfaa63');
 ctx.save();ctx.globalAlpha=opacity;
 // Quiet water-plane lines provide context without implying an ocean physics model.
 ctx.strokeStyle='#cbdce1';ctx.lineWidth=1;
 for(let z=-100;z<=100;z+=25){const a=pr([-190,-29,z]),b=pr([195,-29,z]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
 hullFaces.sort((a,b)=>b.z-a.z);
 for(const f of hullFaces){ctx.beginPath();f.pts.forEach((p,i)=>{const q=pr(p);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.closePath();ctx.fillStyle=f.color;ctx.fill();ctx.strokeStyle=f.color;ctx.lineWidth=.7;ctx.stroke();}
 const path=(pts,color,width=1,dash=[])=>{ctx.beginPath();pts.forEach((p,i)=>{const q=pr(p);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);};
 // Candidate sensor sites, not measured values or a real installation specification.
 const sensors=[[-115,4,-42],[-60,4,-45],[4,4,-46],[68,4,-40],[117,4,-26]];
 path(sensors,'#315d70',1.5,[4,3]);
 for(let i=0;i<sensors.length;i++){const q=pr(sensors[i]);ctx.beginPath();ctx.arc(q[0],q[1],i===2?5:3.4,0,Math.PI*2);ctx.fillStyle=i===2?'#8b631e':'#315d70';ctx.fill();ctx.strokeStyle='#f7fafb';ctx.lineWidth=1.5;ctx.stroke();}
 path([[-140,19,-40],[-105,19,-44],[-60,19,-46],[0,19,-46],[60,19,-42],[110,19,-31],[145,19,-16],[170,19,0]],'#839ba7',1);
 ctx.restore();
 if(t>.68){
  const labelAlpha=Math.min(1,(t-.68)/.2);ctx.save();ctx.globalAlpha=labelAlpha;ctx.font='11px system-ui';
  const pin=pr([4,4,-46]),x=Math.max(18,Math.min(W-220,pin[0]-40)),y=Math.min(H-65,Math.max(pin[1]+45,H*.74));
  ctx.strokeStyle='#9a7b45';ctx.beginPath();ctx.moveTo(...pin);ctx.lineTo(x+12,y-13);ctx.stroke();
  ctx.fillStyle='#725722';ctx.textAlign='left';ctx.fillText('Representative sensing region',x,y);
  if(W>490){const monitor=pr([-95,56,-20]);ctx.strokeStyle='#829ca9';ctx.beginPath();ctx.moveTo(...monitor);ctx.lineTo(monitor[0]-25,monitor[1]-35);ctx.stroke();ctx.fillStyle='#4b6573';ctx.textAlign='center';ctx.fillText('Future onboard monitor',Math.max(95,monitor[0]-25),monitor[1]-43);}
  ctx.restore();
 }
}
$('backToRig').onclick=()=>{returnToRig();update();};
$('showOutlook').onclick=startOutlook;
$('replayOutlook').onclick=()=>{returnToRig();startOutlook();};
preview();
