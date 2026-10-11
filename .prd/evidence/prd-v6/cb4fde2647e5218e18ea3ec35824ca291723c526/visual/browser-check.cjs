const { chromium } = require('/home/roniel_cuaresma/.npm/_npx/0cf6ff1fad43f633/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/home/roniel_cuaresma/.cache/ms-playwright/chromium-1161/chrome-linux/chrome', args: ['--no-sandbox'] });
  const observations = [];
  for (const scenario of [
    { name: 'fresh-anonymous', flag: null, authenticated: false },
    { name: 'fresh-restored', flag: null, authenticated: true },
    { name: 'false-restored', flag: 'false', authenticated: true },
    { name: 'completed-anonymous', flag: 'true', authenticated: false },
    { name: 'completed-restored', flag: 'true', authenticated: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
    await context.addInitScript(flag => {
      if (!sessionStorage.getItem('evaluation-seeded')) {
        if (flag === null) localStorage.removeItem('@leafcheck_onboarding_complete');
        else localStorage.setItem('@leafcheck_onboarding_complete', flag);
        sessionStorage.setItem('evaluation-seeded', 'true');
      }
    }, scenario.flag);
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let status = 200, body = [];
      if (path === '/api/auth/refresh') {
        status = scenario.authenticated ? 200 : 401;
        body = scenario.authenticated ? { accessToken: 'evaluation-fixture-access' } : { error: 'Sign in required' };
      } else if (path === '/api/users/me') body = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.test', name: 'Fixture' };
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8097/');
    await page.locator('img').first().waitFor({ state: 'visible' });
    const firstImage = await page.locator('img').first().getAttribute('src');
    assert.match(firstImage, /leafcheck-logo/);
    await page.screenshot({ path: `/tmp/leafcheck-v6-${scenario.name}-splash.png` });
    const splashSeenAt = Date.now();
    if (scenario.flag !== 'true') {
      await page.getByRole('heading', { name: 'Meet your plants', exact: true }).waitFor();
      assert.ok(Date.now() - splashSeenAt > 1000, 'Splash should remain briefly visible');
      await page.screenshot({ path: `/tmp/leafcheck-v6-${scenario.name}-intro.png` });
      await page.getByRole('button', { name: /Next/ }).click();
      await page.getByRole('heading', { name: 'Understand every leaf', exact: true }).waitFor();
      await page.getByRole('button', { name: /Next/ }).click();
      await page.getByRole('heading', { name: 'Help your plants thrive', exact: true }).waitFor();
      await page.getByRole('button').filter({ hasText: /get growing/i }).click();
    }
    const destination = scenario.authenticated ? '/' : '/login';
    if (scenario.authenticated) await page.getByRole('button', { name: 'Scan Plant', exact: true }).first().waitFor();
    else await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, destination);
    const marker = await page.evaluate(() => localStorage.getItem('@leafcheck_onboarding_complete'));
    assert.equal(marker, 'true');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `/tmp/leafcheck-v6-${scenario.name}-after.png` });
    await page.reload();
    await page.locator('img').first().waitFor({ state: 'visible' });
    assert.match(await page.locator('img').first().getAttribute('src'), /leafcheck-logo/);
    if (scenario.authenticated) await page.getByRole('button', { name: 'Scan Plant', exact: true }).first().waitFor();
    else await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Meet your plants', exact: true }).count(), 0);
    observations.push({ scenario: scenario.name, viewport: '430x932', initialFlag: scenario.flag, splashObserved: true, finalPath: new URL(page.url()).pathname, marker, introSkippedOnReload: true, errors });
    await context.close();
  }
  await browser.close();
  fs.writeFileSync('/tmp/leafcheck-v6-browser-observations.json', JSON.stringify(observations, null, 2));
  console.log(JSON.stringify(observations));
})().catch(error => { console.error(error.message); process.exit(1); });
