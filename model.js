(function(root){'use strict';
const plate=[
 {id:'plate20',label:'20 mm held bend',deflection:20,height:40,baseline:431.925,bent:423.015,released:431.06,strain:4446.562974189688,confirmed:true,note:'First 5 seconds excluded; the next 20 seconds summarized. Released reading returned within 0.20% of baseline.'},
 {id:'plate30',label:'30 mm reported held bend',deflection:30,height:30,baseline:440.485,bent:424.5,released:null,strain:6414.225579830796,confirmed:true,note:'Reported centre height: about 3 cm. Loaded value is the final 10-second median. No paired release reading was recorded.'},
 {id:'plate10',label:'10 mm target trial',deflection:10,height:null,baseline:443.205,bent:448.825,released:452.34,strain:null,confirmed:false,note:'Target height: 5 cm; exact held height was not confirmed. Voltage increased by 1.27%, and released above the initial baseline. Reported separately from the fit.'},
 {id:'plateVariable',label:'30–35 mm varying bend',deflection:null,range:[30,35],height:null,baseline:445.705,bent:411.25,released:443.19,strain:null,confirmed:false,note:'Deflection varied from 30 to 35 mm. Bent value is the final 5-second median; the later released check is shown. No single fixed deflection or strain is assigned.'}
];
const fiber=[
 {id:'fiber1',label:'Steep bend 1',baseline:486.795,bent:434.94,released:487.205,deflection:null,strain:null,note:'Direct fiber bending without the polycarbonate plate. Release returned within 0.08% of baseline.'},
 {id:'fiber2',label:'Steep bend 2',baseline:486.795,bent:445.61,released:510.175,deflection:null,strain:null,note:'Direct fiber bending. Overall shape changed on release; the released reading was 4.80% above baseline.'},
 {id:'fiber3',label:'Steep bend 3',baseline:512.045,bent:461.86,released:512.64,deflection:null,strain:null,note:'Direct fiber bending. Release returned within 0.12% of baseline.'}
];

const dual=[{"id": "dual10", "label": "10 mm - Trial 1", "deflection": 10, "baseline": 0.7998662870398526, "bent": 0.7903695819893848, "released": 0.8003618256368256, "note": "Released ratio returned 0.06% above baseline.", "flag": false, "strain": 2277.616428955587, "drop": 1.187286575811719, "unit": "ratio", "height": 50}, {"id": "dual20a", "label": "20 mm - Trial 1", "deflection": 20, "baseline": 0.7812250191103239, "bent": 0.7673251599112174, "released": 0.7870225759511436, "note": "Movement reported. Retained in the full dataset; omitted from the supplementary filtered fit.", "flag": true, "strain": 4446.562974189687, "drop": 1.7792388696071137, "unit": "ratio", "height": 40}, {"id": "dual20b", "label": "20 mm - Trial 2", "deflection": 20, "baseline": 0.7896658388492364, "bent": 0.767211157660096, "released": 0.7873929205681571, "note": "Repeated 20 mm cycle; released ratio returned 0.29% below baseline.", "flag": false, "strain": 4446.562974189687, "drop": 2.8435675046882047, "unit": "ratio", "height": 40}, {"id": "dual30a", "label": "30 mm - Trial 1", "deflection": 30, "baseline": 0.7895381000141715, "bent": 0.7663324850800879, "released": 0.7827812761406763, "note": "Reference voltage changed +0.03% during bending; sensing voltage decreased 2.89%.", "flag": false, "strain": 6414.225579830796, "drop": 2.93913807752495, "unit": "ratio", "height": 30}, {"id": "dual30b", "label": "30 mm - Trial 2", "deflection": 30, "baseline": 0.7866787165279692, "bent": 0.7551815646486906, "released": 0.7972990956836485, "note": "Possible table shaking reported. Planned 40 mm was corrected to actual 30 mm. Later recovery check shown. Omitted only from the filtered fit.", "flag": true, "strain": 6414.225579830796, "drop": 4.003813909990117, "unit": "ratio", "height": 30}];
function integrals(phi,n=256){
 let ix=0,iy=0;
 for(let j=0;j<=n;j++){
  const u=j/n,weight=j===0||j===n?1:j%2?4:2;
  const f=u===0?2*Math.sqrt(phi):2*phi*u/Math.sqrt(Math.sin(phi*u*u));
  const angle=phi*(1-u*u); ix+=weight*f*Math.cos(angle);iy+=weight*f*Math.sin(angle);
 }
 return [ix/(3*n),iy/(3*n)];
}
function strainAt(deflection){
 if(!Number.isFinite(deflection)||deflection<0||deflection>35)return null;
 if(deflection===0)return 0;
 let lo=1e-9,hi=1.3;
 for(let i=0;i<40;i++){const a=(lo+hi)/2,[ix,iy]=integrals(a);if(iy/ix<2*deflection/228.6)lo=a;else hi=a;}
 const phi=(lo+hi)/2,[ix]=integrals(phi);return 2/228.6*ix*Math.sqrt(Math.sin(phi))*1e6;
}

const voltageDrop=(v,v0)=>100*(1-v/v0);
const fits={all:{slope:0.11446630086353313,intercept:0.03235036852669193,r2:0.7639573431283447,rmse:0.4761374635504381,n:5},filtered:{slope:0.08759257508566154,intercept:0.5714792176283936,r2:0.7907871355723601,rmse:0.36786295874125713,n:3}};
function explore(deflection,which='all'){
 if(!Number.isFinite(deflection)||deflection<10||deflection>30)throw new RangeError('Use the sampled range of 10-30 mm.');
 const f=fits[which];if(!f)throw new RangeError('Unknown fit');
 return {deflection,drop:f.slope*deflection+f.intercept,mechanicalStrain:strainAt(deflection)};
}
const api={dual,plate,fiber,fits,voltageDrop,strainAt,explore};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SmartHull=api;
})(typeof globalThis!=='undefined'?globalThis:this);

