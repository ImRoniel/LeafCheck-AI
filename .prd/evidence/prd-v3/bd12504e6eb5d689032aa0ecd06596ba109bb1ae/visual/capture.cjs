const {chromium}=require('/home/roniel_cuaresma/.npm/_npx/0cf6ff1fad43f633/node_modules/playwright');
const fs=require('node:fs');
const dir=process.env.VISUAL_OUTPUT_DIR || '/tmp/leafcheck-v3-fixed-visual';
fs.mkdirSync(dir,{recursive:true});
const userId='33333333-3333-4333-8333-333333333333';
const plantId='11111111-1111-4111-8111-111111111111';
const deviceId='22222222-2222-4222-8222-222222222222';
const date='2026-10-05T00:00:00Z';
const plant={id:plantId,name:'Fern',species:'Boston fern',location:'Living room',healthStatus:'healthy',createdAt:date,updatedAt:date};
const device={id:deviceId,userId,name:'Living room sensor',macAddress:'LC-A50528',status:'ONLINE',createdAt:date,updatedAt:date};
const telemetry={deviceId:device.macAddress,timestamp:date,environment:{temperatureCelsius:24,humidityPercentage:62},soilMoisture:{percentage:45,rawAnalogValue:2000,status:'optimal'},lightLevel:{lux:350,status:'optimal'}};
const observations=[];
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
 for(const scenario of ['loading','unpaired','waiting','metrics','error','claim-flow']) {
  const context=await browser.newContext({viewport:{width:430,height:932},reducedMotion:'reduce'});
  await context.addInitScript(({userId})=>localStorage.setItem('leafcheck.local-state.v1:account:'+userId,JSON.stringify({version:1,experience:null,spaces:[],guestPlants:[],schedules:{},careCompletions:[],connectedDevices:[],onboarding:{status:'skipped',step:'experience',spaceId:null,plantId:null,mode:null}})),{userId});
  let paired=false,conflict=true;
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'http://localhost:8087','access-control-allow-credentials':'true','access-control-allow-headers':'*'}});
   let status=200,body;
   if(path==='/api/auth/refresh') body={accessToken:'visual-fixture-only'};
   else if(path==='/api/users/me') body={id:userId,email:'visual@example.test',name:'Visual reviewer'};
   else if(path==='/api/plants') body=[{...plant,...(paired?{deviceId}:{})}];
   else if(path.endsWith('/telemetry')) {
    if(scenario==='loading') await new Promise(r=>setTimeout(r,15000));
    if(scenario==='error') {status=503;body={error:'Sensor service unavailable. Please retry.'};}
    else body=scenario==='unpaired'?{paired:false,device:null,telemetry:null}:{paired:true,device,telemetry:scenario==='metrics'?telemetry:null};
   } else if(path==='/api/devices/claim') {
    await new Promise(r=>setTimeout(r,1000));
    if(conflict) {status=409;body={error:'Device belongs to another account'};conflict=false;} else {status=201;body=device;}
   } else if(path.endsWith('/pair-device')) {await new Promise(r=>setTimeout(r,1500));paired=true;body={...plant,deviceId};}
   else if(path==='/api/scan/archives'||path==='/api/plants/care-tasks') body=[];
   else body=[];
   return route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'http://localhost:8087','access-control-allow-credentials':'true'},body:JSON.stringify(body)});
  });
  const page=await context.newPage();
  const duplicateKeys=[];
  page.on('console',msg=>{if(/Encountered two children with the same key/.test(msg.text()))duplicateKeys.push(msg.text());});
  const capture=async name=>{if(name==='editing-profile') await page.getByRole('button',{name:'Cancel editing',exact:true}).scrollIntoViewIfNeeded();else if(!name.includes('claim')&&!name.includes('assignment')&&!name.includes('pair-busy')&&name!=='success') await page.getByRole('heading',{name:'Growing conditions',exact:true}).scrollIntoViewIfNeeded();await page.waitForTimeout(250);await page.screenshot({path:dir+'/'+name+'.png',fullPage:true});observations.push({scenario:name,viewport:'430x932',fixture:true,text:(await page.locator('body').innerText()).slice(0,6000)});};
  if(scenario==='claim-flow') {
   await page.goto('http://localhost:8087/device-connection/scanner?targetType=plant&targetId='+plantId);
   await page.getByRole('textbox',{name:'Device MAC'}).waitFor();
   await page.getByRole('textbox',{name:'Device MAC'}).fill('LC-A50528');
   await page.getByRole('button',{name:'Claim device',exact:true}).click();
   await page.getByRole('button',{name:'Claiming…',exact:true}).waitFor(); await capture('claim-busy');
   await page.getByText('This device belongs to another account.',{exact:false}).waitFor();await capture('claim-conflict');
   await page.getByRole('button',{name:'Claim device',exact:true}).click();
   await page.getByRole('button',{name:'Connect to selected destination',exact:true}).waitFor();await capture('assignment-locked');
   await page.getByRole('button',{name:'Connect to selected destination',exact:true}).click();
   await page.getByText('Pairing your sensor…',{exact:true}).waitFor();await capture('pair-busy');
   await page.getByText('Sensor paired successfully',{exact:true}).waitFor();await capture('success');
   await page.getByRole('button',{name:'View paired plant',exact:true}).click();
   await page.getByText('Waiting for first sensor reading...',{exact:true}).waitFor(); await capture('contextual-profile');
  } else {
   await page.goto('http://localhost:8087/plant-profile?id='+plantId);
   const expected={loading:'Updating sensor readings...',unpaired:'No sensor paired',waiting:'Waiting for first sensor reading...',metrics:'Living room sensor',error:'Retry sensor readings'}[scenario];
   await page.getByText(expected,{exact:true}).first().waitFor();await capture(scenario);
   if(scenario==='metrics') {await page.getByRole('button',{name:'Edit plant details',exact:true}).click(); await page.getByRole('button',{name:'Cancel editing',exact:true}).waitFor();await capture('editing-profile');}
  }
  if(duplicateKeys.length) throw Error('Duplicate React keys observed in '+scenario);
  await context.close();
 }
 fs.writeFileSync(dir+'/observations.json',JSON.stringify(observations,null,2)+'\n');
 console.log('Captured '+observations.length+' fixture-driven UI states; no live backend mutations.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
