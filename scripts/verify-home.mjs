// Visual and functional smoke test for the static-exported XinXinXin homepage.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const url = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';
const output = path.resolve('artifacts/home-smoke');
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const pageErrors = [];
async function runCase(label, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', error => pageErrors.push(label + ': ' + error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('.studio-dropzone').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.studio-dropzone')?.getAttribute('aria-disabled') === 'false');
  await page.locator('h1.studio-title').getByText('XinXinXin的').waitFor();
  await page.getByRole('heading', { name: '拼豆AI生成' }).waitFor();
  assert.match(await page.locator('body').innerText(), /么么么么叽/);
  assert.match(await page.locator('footer').innerText(), /XinXinXin拼豆底稿生成器/);
  assert.equal(await page.getByRole('button', { name: '请作者喝一杯奶茶' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '帮助教程' }).count(), 0);
  assert.equal((await page.locator('body').innerText()).includes('乐高积木拼豆'), false);

  // A real photo asset, not the previous 9-dot decorative mark.
  const portraits = await page.locator('.studio-brand-portrait img, .studio-hero-portrait img').evaluateAll(
    (images) => images.map(img => ({
      src: new URL(img.currentSrc || img.src, location.href).pathname,
      loaded: img.complete && img.naturalWidth >= 192 && img.naturalHeight >= 192
    }))
  );
  assert.equal(portraits.length, 2, label + ': expected portrait in nav and hero');
  assert.ok(portraits.every(image => image.src === '/xinxinxin-logo.webp' && image.loaded),
    label + ': logo image failed to load: ' + JSON.stringify(portraits));

  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    width: document.documentElement.scrollWidth,
    background: getComputedStyle(document.querySelector('.studio-home')).backgroundImage,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    dropColor: getComputedStyle(document.querySelector('.studio-dropzone')).borderColor
  }));
  assert.ok(overflow.width <= overflow.viewport + 1,
    label + ': horizontal overflow ' + JSON.stringify(overflow));
  assert.ok(overflow.background.includes('gradient'), label + ': studio CSS not loaded');
  assert.equal(overflow.bodyBackground, 'rgb(255, 240, 245)', label + ': pink base background missing');
  assert.match(overflow.background, /rgb\(255, 242, 247\)/, label + ': rose gradient missing');

  const faviconResponse = await page.request.get(url + '/favicon-32x32.png');
  assert.equal(faviconResponse.status(), 200, label + ': missing generated favicon');
  assert.match(faviconResponse.headers()['content-type'] || '', /^image\/png/);

  const manifestResponse = await page.request.get(url + '/manifest.json');
  const manifest = await manifestResponse.json();
  assert.equal(manifest.theme_color, '#fff0f5', label + ': PWA theme color differs from page');
  await page.screenshot({ path: path.join(output, label + '.png'), fullPage: true, animations: 'disabled' });
  console.log(label + ' landing page OK: ' + JSON.stringify(overflow));
  return page;
}

try {
  const desktop = await runCase('desktop-1440', { width: 1440, height: 900 });
  const mobile = await runCase('mobile-390', { width: 390, height: 844 });
  await mobile.close();

  // Actual file upload -> crop -> pixel preview -> download dialog.
  await desktop.locator('input[type="file"][accept*="image/png"]').setInputFiles('public/icon-192x192.png');
  await desktop.getByRole('heading', { name: '裁剪图片' }).waitFor({ timeout: 20000 });
  await desktop.waitForTimeout(500);
  await desktop.getByRole('button', { name: '确认裁剪' }).click();
  await desktop.getByText('调整你的创作').waitFor({ timeout: 25000 });
  await desktop.getByText('拼豆效果预览').waitFor({ timeout: 25000 });
  await desktop.getByRole('button', { name: '下载拼豆图纸' }).waitFor({ timeout: 30000 });
  await desktop.getByRole('button', { name: '下载拼豆图纸' }).click();
  await desktop.screenshot({ path: path.join(output, 'desktop-after-upload.png'), fullPage: true, animations: 'disabled' });
  console.log('upload / crop / canvas preview / download button OK');

  // Mock paid SiliconFlow provider: no real account or charges during CI.
  await desktop.getByRole('button', { name: '取消' }).last().click();
  const fakeGeneratedImage = await readFile('public/icon-192x192.png');
  let editApiCalls = 0;
  await desktop.route('**/api/ai-optimize', async route => {
    editApiCalls++;
    const request = route.request();
    const body = request.postDataJSON();
    assert.equal(request.method(), 'POST');
    assert.match(body.imageBase64, /^data:image\/(png|jpeg);base64,/);
    assert.ok(typeof body.prompt === 'string' && body.prompt.length > 0);
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fakeGeneratedImage,
      headers: { 'Cache-Control': 'no-store' }
    });
  });

  await desktop.getByRole('button', { name: 'AI优化' }).click();
  await desktop.getByRole('heading', { name: 'AI 图片优化 · 硅基流动' }).waitFor();
  await desktop.getByRole('button', { name: '开始优化' }).click();
  await desktop.getByRole('button', { name: '使用此图' }).waitFor({ timeout: 15000 });
  assert.equal(editApiCalls, 1);
  await desktop.screenshot({ path: path.join(output, 'desktop-ai-optimized-mock.png'), animations: 'disabled' });
  await desktop.getByRole('button', { name: '使用此图' }).click();
  await desktop.getByText('拼豆效果预览').waitFor({ timeout: 25000 });
  console.log('AI dialog / same-origin binary mock / use optimized image OK');
  await desktop.close();

  assert.deepEqual(pageErrors, [], 'Browser JavaScript errors: ' + pageErrors.join(' | '));
  console.log('PASS: all smoke tests');
} finally {
  await browser.close();
}
