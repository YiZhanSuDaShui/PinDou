// Visual and functional smoke test for the static-exported XinXinXin homepage.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const url = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173';
const output = path.resolve('artifacts/home-smoke');
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const pageErrors = [];
async function runCase(label, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, acceptDownloads: true });
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
  // The optional PWA manifest remains supported, but the floating install
  // promotion must never be rendered even after an install prompt event.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })));
  assert.equal(await page.getByRole('button', { name: '安装应用' }).count(), 0,
    label + ': floating install-app button must be removed');
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

  // At every viewport width, the badge should sit BELOW the hero portrait.
  const avatarBox = await page.locator('.studio-hero-portrait').boundingBox();
  const badgeBox = await page.locator('.studio-eyebrow').boundingBox();
  assert.ok(avatarBox && badgeBox && badgeBox.y >= avatarBox.y + avatarBox.height + 5,
    label + ': brand portrait and label overlap');

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
  await desktop.locator('.studio-noise-title').waitFor({ state: 'visible', timeout: 25000 });
  await desktop.locator('.studio-color-toggle').click();
  await desktop.locator('.studio-color-option:not(.is-active)').first().waitFor();
  // Check real CSS contrast on the light pink panels under BOTH OS theme preferences.
  for (const scheme of ['light', 'dark']) {
    await desktop.emulateMedia({ colorScheme: scheme });
    const contrast = await desktop.evaluate(() => {
      const selectors = ['.studio-color-toggle', '.studio-color-option:not(.is-active)',
        '.studio-color-option.is-active', '.studio-noise-title', '.studio-noise-description',
        '.studio-noise-key', '.studio-noise-count'];
      const components = [...selectors];
      const luminance = (rgb) => {
        const channels = rgb.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) || [0, 0, 0];
        const linear = channels.map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      return components.map(selector => {
        const el = document.querySelector(selector);
        if (!el) return { selector, ratio: 0, missing: true };
        const fg = getComputedStyle(el).color;
        const bg = selector.includes('color-option')
          ? getComputedStyle(el).backgroundColor
          : 'rgb(255, 253, 254)'; // near-white panel over the pink background
        const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
        return { selector, ratio: (hi + 0.05) / (lo + 0.05), fg, bg };
      });
    });
    assert.ok(contrast.every(item => item.ratio >= 4.5),
      `Insufficient ${scheme} mode contrast: ${JSON.stringify(contrast)}`);
    console.log(`PASS: ${scheme} mode editor text contrast ${JSON.stringify(contrast)}`);
  }
  await desktop.emulateMedia({ colorScheme: 'light' });
  await desktop.screenshot({ path: path.join(output, 'desktop-color-contrast.png'), fullPage: true, animations: 'disabled' });
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

  // Capture the actual exported PNG instead of only testing that the dialog opens.
  await desktop.evaluate(() => {
    window.__brandExportTrace = { text: [], images: [] };
    const ctxProto = CanvasRenderingContext2D.prototype;
    const originalText = ctxProto.fillText;
    ctxProto.fillText = function (value, ...args) {
      if (typeof value === 'string' && /LDB|小红书|扫码|XinXinXin|拼豆底稿生成器/.test(value)) {
        window.__brandExportTrace.text.push(value);
      }
      return originalText.call(this, value, ...args);
    };
    const originalDrawImage = ctxProto.drawImage;
    ctxProto.drawImage = function (source, ...args) {
      if (source instanceof HTMLImageElement && /xinxinxin-logo|website_qrcode/.test(source.src)) {
        window.__brandExportTrace.images.push(new URL(source.src).pathname);
      }
      return originalDrawImage.call(this, source, ...args);
    };
  });
  await desktop.getByRole('button', { name: '下载拼豆图纸' }).click();
  await desktop.getByRole('heading', { name: '下载图纸设置' }).waitFor();
  await desktop.screenshot({ path: path.join(output, 'desktop-download-settings.png'), animations: 'disabled' });
  const [download] = await Promise.all([
    desktop.waitForEvent('download', { timeout: 25000 }),
    desktop.getByRole('button', { name: '下载图纸', exact: true }).click()
  ]);
  assert.match(download.suggestedFilename(), /bead-grid-.*\.png$/);
  const bitmap = await sharp(await readFile(await download.path()))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.ok(bitmap.info.width >= 300 && bitmap.info.height >= 300, 'export PNG dimensions');
  const rgba = bitmap.data.subarray(0, 4); // Upper-left point of the new pink header
  assert.ok(rgba[0] >= 240 && rgba[1] >= 210 && rgba[2] >= 220 && rgba[2] > rgba[1],
    'Export header is not pale pink: ' + [...rgba].join(','));
  const trace = await desktop.evaluate(() => window.__brandExportTrace);
  assert.ok(trace.text.includes('XinXinXin'), 'new export title not painted');
  assert.ok(trace.text.includes('拼豆底稿生成器'), 'new export subtitle not painted');
  assert.ok(trace.images.includes('/xinxinxin-logo.webp'), 'portrait logo not painted in export');
  assert.ok(trace.text.every(value => !/LDB|小红书|扫码/.test(value)),
    'old brand or QR placeholder painted in export: ' + JSON.stringify(trace));
  assert.ok(!trace.images.some(value => value.includes('website_qrcode')), 'old QR embedded in export');
  console.log('PASS: actual PNG export uses pink header + portrait logo with no old branding or QR');
  await desktop.close();

  assert.deepEqual(pageErrors, [], 'Browser JavaScript errors: ' + pageErrors.join(' | '));
  console.log('PASS: all smoke tests');
} finally {
  await browser.close();
}
