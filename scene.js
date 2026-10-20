function size(canvas,c){const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);c.setTransform(dpr,0,0,dpr,0,0);return[rect.width,rect.height];}
let W=0,H=0,faces=[];
function transform(p){const x=p[0]*state.span/200,y=p[1],z=p[2]*state.width/210,xx=x*Math.cos(yaw)+z*Math.sin(yaw),zz=-x*Math.sin(yaw)+z*Math.cos(yaw);return[xx,y*Math.cos(pitch)+zz*Math.sin(pitch),-y*Math.sin(pitch)+zz*Math.cos(pitch)];}
function project(p){const [x,y,z]=transform(p),scale=Math.min(W/420,H/280)*zoom*(1-.72*outlookProgress),depth=650/(650+z);return[W*.5+x*scale*depth,H*.65-y*scale*depth,z];}
function face(points,color){faces.push({points,color,depth:points.reduce((a,p)=>a+transform(p)[2],0)/points.length});}
function box(x,y,z,w,h,d,colors=['#929ea5','#a8b4ba','#c0cbd0']){const a=[x-w/2,y-h/2,z-d/2],b=[x+w/2,y-h/2,z-d/2],c=[x+w/2,y-h/2,z+d/2],e=[x-w/2,y-h/2,z+d/2];const tops=[a,b,c,e].map(p=>[p[0],p[1]+h,p[2]]);face([a,b,tops[1],tops[0]],colors[0]);face([b,c,tops[2],tops[1]],colors[1]);face([c,e,tops[3],tops[2]],colors[0]);face([e,a,tops[0],tops[3]],colors[1]);face(tops,colors[2]);}
function cylinder(x,y,z,r,h){const n=28,top=[],bottom=[];for(let i=0;i<n;i++){const t=i/n*Math.PI*2;top.push([x+r*Math.cos(t),y+h/2,z+r*Math.sin(t)]);bottom.push([x+r*Math.cos(t),y-h/2,z+r*Math.sin(t)]);}for(let i=0;i<n;i++)face([bottom[i],bottom[(i+1)%n],top[(i+1)%n],top[i]],i%4===0?'#8091a4':'#64788e');face(top,'#abb9c6');}
function line3(points,color,width=1,glow=false){ctx.beginPath();points.forEach((p,i)=>{const q=project(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.strokeStyle=color;ctx.lineWidth=width;if(glow){ctx.shadowColor=color;ctx.shadowBlur=8;}ctx.stroke();ctx.shadowBlur=0;}

function drawBoatOutlook(){
 const t=outlookProgress,opacity=Math.min(1,Math.max(0,(t-.12)/.65));
 if(opacity<=0)return;
 const scale=Math.min(W/440,H/260)*zoom*(1.65-.65*t),cy=H*.53;
 const tr=p=>{const[x,y,z]=p,xx=x*Math.cos(yaw)+z*Math.sin(yaw),zz=-x*Math.sin(yaw)+z*Math.cos(yaw);return[xx,y*Math.cos(pitch)+zz*Math.sin(pitch),-y*Math.sin(pitch)+zz*Math.cos(pitch)];};
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


