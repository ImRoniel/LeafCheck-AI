const { chromium }=require('/home/roniel_cuaresma/.npm/_npx/0cf6ff1fad43f633/node_modules/playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/home/roniel_cuaresma/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',args:['--no-sandbox']});
 const observations=[];
 for(const authenticated of [false,true]){
  const context=await browser.newContext({viewport:{width:430,height:932}});
  await context.route('**/api/**', async route=>{
   const pathname=new URL(route.request().url()).pathname;
   let status=200,body=[];
   if(pathname==='/api/auth/refresh'){status=authenticated?200:401;body=authenticated?{accessToken:'evaluation-fixture-access'}:{error:'Sign in required'};}
   else if(pathname==='/api/users/me')body={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.test',name:'Fixture'};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const label=authenticated?'restored':'anonymous';
  await page.goto('http://127.0.0.1:8094/login');
  await page.waitForURL('**/splash',{timeout:15000});
  await page.screenshot({path:`/tmp/leafcheck-v4-${label}-splash.png`});
  await page.getByRole('heading',{name:'Meet your plants'}).waitFor();
  await page.screenshot({path:`/tmp/leafcheck-v4-${label}-intro1.png`});
  await page.getByRole('button',{name:'Next'}).click();
  await page.getByRole('heading',{name:'Understand every leaf'}).waitFor();
  await page.getByRole('button',{name:'Next'}).click();
  await page.getByRole('heading',{name:'Help your plants thrive'}).waitFor();
  await page.screenshot({path:`/tmp/leafcheck-v4-${label}-intro3.png`});
  await page.getByRole('button').filter({hasText:/get growing/}).click();
  if(authenticated)await page.getByText('How would you describe yourself?',{exact:true}).waitFor();
  else await page.waitForURL('**/login');
  await page.screenshot({path:`/tmp/leafcheck-v4-${label}-after.png`});
  const marker=await page.evaluate(()=>localStorage.getItem('leafcheck.install-intro.v1'));
  observations.push({scenario:label,slidesSeen:3,finalPath:new URL(page.url()).pathname,marker,errors});
  await page.reload();
  if(authenticated)await page.getByText('How would you describe yourself?',{exact:true}).waitFor();else await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
  observations.push({scenario:label+' reload',path:new URL(page.url()).pathname,introSkipped:true});
  await context.close();
 }
 await browser.close();fs.writeFileSync('/tmp/leafcheck-v4-browser.json',JSON.stringify(observations,null,2));console.log(JSON.stringify(observations));
})().catch(e=>{console.error(e.message);process.exit(1);});
