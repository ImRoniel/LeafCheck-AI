import fs from 'node:fs';
const env=fs.readFileSync('/home/roniel_cuaresma/Leaf-Check-AI/frontend/.env','utf8');
const match=env.match(/^EXPO_PUBLIC_API_URL\s*=\s*(.+)$/m);
if(!match) throw Error('API URL unavailable');
const base=match[1].trim().replace(/^"|"$/g,'').replace(/\/$/,'');
const observations=[];
for(const body of ['{}',JSON.stringify({padding:'x'.repeat(20000)})]){
 const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(15000)});
 const text=await response.text();
 observations.push({input:body.length>100?'oversized JSON':'empty JSON',status:response.status,body:text,clean4xx:response.status>=400&&response.status<500&&!/stack|at .*\(|\/home\/|node_modules/.test(text)});
}
fs.writeFileSync('/tmp/leafcheck-v3-final-http.json',JSON.stringify({timestamp:new Date().toISOString(),observations},null,2)+'\n');
console.log(JSON.stringify(observations,null,2));
