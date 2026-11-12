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
  // Home restore module must be between the upload panel and the creative tip.
  const archiveModule = page.locator('.studio-archive-import');
  await archiveModule.waitFor();
  const codeInput = page.getByRole('textbox', { name: '六位数字对接码' });
  const confirmCode = archiveModule.getByRole('button', { name: '确认', exact: true });
  assert.equal(await confirmCode.isDisabled(), true);
  await codeInput.fill('12');
  assert.equal(await confirmCode.isDisabled(), true);
  await codeInput.fill('05a98b64');
  assert.equal(await codeInput.inputValue(), '059864', 'leading zeroes must survive');
  assert.equal(await confirmCode.isEnabled(), true);
  await codeInput.fill('');
  const positions = await page.evaluate(() => {
    const upload = document.querySelector('.studio-upload-shell').getBoundingClientRect();
    const archive = document.querySelector('.studio-archive-import').getBoundingClientRect();
    const tip = document.querySelector('.studio-note').getBoundingClientRect();
    return { uploadBottom: upload.bottom, archiveTop: archive.top, archiveBottom: archive.bottom, tipTop: tip.top };
  });
  assert.ok(positions.uploadBottom < positions.archiveTop && positions.archiveBottom < positions.tipTop,
    label + ': archive module should sit between the upload panel and tip');
  console.log('PASS: six-digit import UI and landing position ' + label);

  // A visible, restrained install pill belongs inside the header rather than
  // floating in the lower-right corner.
  const installButton = page.getByRole('button', { name: '安装应用' });
  assert.equal(await installButton.count(), 1, label + ': expected exactly one install action');
  const installBox = await installButton.boundingBox();
  const navBox = await page.locator('.studio-nav').boundingBox();
  const tagline = page.locator('.studio-nav-tagline');
  const brand = await page.locator('.studio-brand').boundingBox();
  const taglineBox = await tagline.boundingBox();
  assert.ok(installBox && navBox && brand, label + ': header elements missing');
  assert.ok(installBox.y >= navBox.y && installBox.y + installBox.height <= navBox.y + navBox.height,
    label + ': install button is outside header bounds');
  assert.ok(installBox.x > brand.x + brand.width, label + ': install overlaps logo');
  if (viewport.width > 680) {
    assert.ok(taglineBox, label + ': desktop tagline missing');
    assert.ok(installBox.x + installBox.width <= taglineBox.x,
      label + ': install action must appear left of the tagline');
    assert.ok(Math.abs(installBox.height - taglineBox.height) <= 1,
      label + ': install pill and tagline should be the same height');
    const matchingStyles = await page.evaluate(() => {
      const button = getComputedStyle(document.querySelector('.studio-install-button'));
      const note = getComputedStyle(document.querySelector('.studio-nav-tagline'));
      return ['borderRadius', 'paddingTop', 'paddingBottom', 'borderColor', 'backgroundColor', 'fontSize']
        .map(prop => [prop, button[prop], note[prop]]);
    });
    assert.ok(matchingStyles.every(([, a, b]) => a === b),
      label + ': install pill style differs from tagline: ' + JSON.stringify(matchingStyles));
  } else {
    assert.equal(taglineBox, null, label + ': mobile tagline should be hidden');
    assert.ok(Math.abs(installBox.x + installBox.width - (navBox.x + navBox.width)) <= 2,
      label + ': install button must align to top right on mobile');
  }
  const installPlacement = await installButton.evaluate(node => {
    const style = getComputedStyle(node);
    return { position: style.position, background: style.backgroundColor, radius: style.borderRadius };
  });
  assert.notEqual(installPlacement.position, 'fixed', label + ': no floating install overlay');

  // Browsers without beforeinstallprompt still get useful manual instructions.
  await installButton.click();
  await page.getByText('添加到桌面').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '知道了' }).click();

  // On browsers with the PWA install event, clicking the header action
  // must actually invoke the native install prompt.
  await page.evaluate(() => {
    window.__installTestCalls = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperty(event, 'prompt', { value: async () => { window.__installTestCalls++; } });
    Object.defineProperty(event, 'userChoice', { value: Promise.resolve({ outcome: 'dismissed' }) });
    window.dispatchEvent(event);
  });
  await page.waitForTimeout(80);
  await installButton.click();
  const promptCalls = await page.evaluate(() => window.__installTestCalls);
  assert.equal(promptCalls, 1, label + ': install action did not invoke native prompt');
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
  await mobile.locator('input[type="file"][accept*="image/png"]').setInputFiles('public/icon-192x192.png');
  await mobile.getByRole('heading', { name: '裁剪图片' }).waitFor({ timeout: 20000 });
  await mobile.waitForTimeout(400);
  await mobile.getByRole('button', { name: '确认裁剪' }).click();
  await mobile.locator('.studio-edit-actions').waitFor({ timeout: 20000 });
  const mobileButtons = await mobile.locator('.studio-edit-actions > button').evaluateAll(items =>
    items.map(item => { const rect = item.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width }; })
  );
  assert.equal(mobileButtons.length, 3, 'mobile should show three editor actions');
  assert.ok(mobileButtons.every(item => Math.abs(item.y - mobileButtons[0].y) < 2), 'mobile actions must be side-by-side');
  await mobile.screenshot({ path: path.join(output, 'mobile-three-actions.png'), animations: 'disabled' });
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

  // Mock the archive API (zero real Blob quota). Save must serialize the
  // current visible bead grid, not the previously uploaded source image.
  let postedCsv = '';
  let archiveSaveCalls = 0;
  await desktop.route('**/api/archive*', async route => {
    const req = route.request();
    assert.equal(req.method(), 'POST');
    archiveSaveCalls++;
    const body = req.postDataJSON();
    assert.equal(typeof body.csv, 'string');
    assert.ok(body.csv.startsWith('#') || body.csv.startsWith('TRANSPARENT'));
    postedCsv = body.csv;
    await route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ code: '059864' }) });
  });
  const desktopActions = desktop.locator('.studio-edit-actions > button');
  assert.equal(await desktopActions.count(), 3, 'desktop should have exactly three editor buttons');
  const actionY = await desktopActions.evaluateAll(items => items.map(el => el.getBoundingClientRect().y));
  assert.ok(actionY.every(y => Math.abs(y - actionY[0]) < 2), 'desktop actions must be side by side');
  await desktop.getByRole('button', { name: '生成对接码' }).click();
  const archiveModal = desktop.getByRole('dialog', { name: '已生成对接码' });
  await archiveModal.waitFor({ timeout: 15000 });
  await archiveModal.getByText('059864', { exact: true }).waitFor();
  assert.equal(archiveSaveCalls, 1);
  assert.ok(postedCsv.length > 20, 'saved CSV should contain real grid data');
  await desktop.screenshot({ path: path.join(output, 'desktop-cloud-code.png'), animations: 'disabled' });
  await archiveModal.getByRole('button', { name: '知道了' }).click();
  console.log('PASS: latest-grid archive save & 6-digit modal');


  // Mock paid SiliconFlow provider: no real account or charges during CI.
  await desktop.getByRole('button', { name: '取消' }).last().click();
  const fakeGeneratedImage = await readFile('public/icon-192x192.png');
  let editApiCalls = 0;
  let lastAiPrompt = '';
  await desktop.route('**/api/ai-optimize', async route => {
    editApiCalls++;
    const request = route.request();
    const body = request.postDataJSON();
    assert.equal(request.method(), 'POST');
    assert.match(body.imageBase64, /^data:image\/(png|jpeg);base64,/);
    assert.ok(typeof body.prompt === 'string' && body.prompt.length > 0);
    lastAiPrompt = body.prompt;
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fakeGeneratedImage,
      headers: { 'Cache-Control': 'no-store' }
    });
  });

  await desktop.getByRole('button', { name: 'AI优化' }).click();
  await desktop.getByRole('heading', { name: 'AI 图片优化', exact: true }).waitFor();
  await desktop.getByText('正在使用 suda 的快捷 API 额度进行优化', { exact: false }).waitFor();

  // Copying uses the exact default prompt sent to the model, or the user's edits.
  // Stub clipboard permissions, not the copy button's real event/logic.
  await desktop.evaluate(() => {
    window.__copiedAiPrompt = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async value => { window.__copiedAiPrompt = value; } }
    });
  });
  const promptInput = desktop.locator('textarea[placeholder*="图片修改为：chibi"]');
  const defaultAiPrompt = await promptInput.getAttribute('placeholder');
  assert.match(defaultAiPrompt, /pixel art style, 16-bit, retro game aesthetic/);
  const copyPromptButton = desktop.getByRole('button', { name: '一键复制提示词' });
  await copyPromptButton.click();
  assert.equal(await desktop.evaluate(() => window.__copiedAiPrompt), defaultAiPrompt);
  await desktop.getByRole('status').getByText('提示词已复制到剪贴板').waitFor();

  const customAiPrompt = '图片修改为：水彩插画风格，保持主题清晰。';
  await promptInput.fill(customAiPrompt);
  await copyPromptButton.click();
  assert.equal(await desktop.evaluate(() => window.__copiedAiPrompt), customAiPrompt);
  await promptInput.fill('');
  await desktop.getByRole('button', { name: '开始优化' }).click();
  await desktop.getByRole('button', { name: '使用此图' }).waitFor({ timeout: 15000 });
  assert.equal(editApiCalls, 1);
  assert.equal(lastAiPrompt, defaultAiPrompt, 'copied default prompt must exactly match actual AI request');
  await desktop.screenshot({ path: path.join(output, 'desktop-ai-optimized-mock.png'), animations: 'disabled' });
  await desktop.getByRole('button', { name: '使用此图' }).click();
  await desktop.getByText('拼豆效果预览').waitFor({ timeout: 25000 });
  console.log('AI dialog / same-origin binary mock / use optimized image OK');

  // Test the browser-direct provider without making paid calls or sending real
  // credentials. The existing SiliconFlow path above must stay unchanged.
  let customEditCalls = 0;
  let imageLinkDownloads = 0;
  let returnImageLink = false;
  const fakeApiKey = 'sk-ci-only-never-real';
  const mockEditUrl = 'https://mock-provider.example/v1/images/edits';
  await desktop.route(mockEditUrl, async route => {
    const request = route.request();
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Authorization, Content-Type',
      'access-control-allow-methods': 'POST, OPTIONS'
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    customEditCalls++;
    assert.equal(request.method(), 'POST');
    assert.equal(request.headers().authorization, 'Bearer ' + fakeApiKey);
    assert.match(request.headers()['content-type'] || '', /multipart\/form-data; boundary=/);
    const multipart = request.postDataBuffer()?.toString('latin1') || '';
    assert.match(multipart, /name="model"\r\n\r\ngpt-image-2\.6/);
    assert.match(multipart, /name="prompt"\r\n\r\n/);
    assert.match(multipart, /filename="pindou\.(png|jpg)"/);
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ created: 1, data: [
        returnImageLink
          ? { url: 'https://mock-provider.example/generated.png' }
          : { b64_json: fakeGeneratedImage.toString('base64') }
      ] })
    });
  });
  await desktop.route('https://mock-provider.example/generated.png', async route => {
    imageLinkDownloads++;
    await route.fulfill({
      status: 200, contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: fakeGeneratedImage
    });
  });

  await desktop.getByRole('button', { name: 'AI优化' }).click();
  await desktop.getByRole('button', { name: '使用自定义供应商' }).click();
  const providerDialog = desktop.getByRole('dialog', { name: '自定义供应商' });
  await providerDialog.waitFor();
  await providerDialog.getByLabel('API 接入点').fill('https://mock-provider.example/v1');
  await providerDialog.getByLabel('API Key').fill(fakeApiKey);
  await providerDialog.getByLabel('模型名称').fill('gpt-image-2.6');
  assert.equal(await providerDialog.getByLabel('在本机记住 Key').isChecked(), false);
  await providerDialog.getByRole('button', { name: '确认' }).click();
  await providerDialog.waitFor({ state: 'hidden' });
  assert.match(await desktop.locator('body').innerText(), /当前使用自定义供应商：gpt-image-2.6/);
  const sessionConfig = await desktop.evaluate(() => ({
    session: sessionStorage.getItem('pindou.custom-ai-provider.v1'),
    local: localStorage.getItem('pindou.custom-ai-provider.v1')
  }));
  assert.ok(sessionConfig.session?.includes(fakeApiKey), 'session-only provider must use sessionStorage');
  assert.equal(sessionConfig.local, null, 'API key must not be persisted by default');

  await desktop.getByRole('button', { name: '开始优化' }).click();
  await desktop.getByRole('button', { name: '使用此图' }).waitFor({ timeout: 15000 });
  assert.equal(customEditCalls, 1, 'custom provider should be called exactly once');
  assert.equal(editApiCalls, 1, 'custom request must not consume the default API');
  console.log('PASS: custom provider image upload, session-only key and base64 image result');

  // The other supported result format is data[0].url (tken's previous result).
  returnImageLink = true;
  await desktop.getByRole('button', { name: '重新优化' }).click();
  await desktop.getByRole('button', { name: '开始优化' }).click();
  await desktop.getByRole('button', { name: '使用此图' }).waitFor({ timeout: 15000 });
  assert.equal(customEditCalls, 2);
  assert.equal(imageLinkDownloads, 1);
  console.log('PASS: custom provider remote image URL result');

  await desktop.getByRole('button', { name: '使用自定义供应商' }).click();
  await providerDialog.getByLabel('在本机记住 Key').check();
  await providerDialog.getByRole('button', { name: '确认' }).click();
  const persisted = await desktop.evaluate(() => ({
    session: sessionStorage.getItem('pindou.custom-ai-provider.v1'),
    local: localStorage.getItem('pindou.custom-ai-provider.v1')
  }));
  assert.equal(persisted.session, null, 'remembered key must not retain an extra session copy');
  assert.ok(persisted.local?.includes(fakeApiKey), 'opted-in key must be in localStorage');
  // browser.newPage() creates an owned context that forbids context.newPage().
  // Transfer only the browser storage snapshot into a genuinely new context,
  // as a fresh browser session would do for remembered localStorage entries.
  const rememberedContext = await browser.newContext({
    storageState: await desktop.context().storageState()
  });
  const rememberedTab = await rememberedContext.newPage();
  await rememberedTab.goto(url, { waitUntil: 'domcontentloaded' });
  assert.ok((await rememberedTab.evaluate(() => localStorage.getItem('pindou.custom-ai-provider.v1')))?.includes(fakeApiKey),
    'remembered key should survive a fresh browser context');
  await rememberedContext.close();

  await desktop.getByRole('button', { name: '使用自定义供应商' }).click();
  await providerDialog.getByRole('button', { name: '恢复默认' }).click();
  const cleared = await desktop.evaluate(() => ({
    session: sessionStorage.getItem('pindou.custom-ai-provider.v1'),
    local: localStorage.getItem('pindou.custom-ai-provider.v1')
  }));
  assert.deepEqual(cleared, { session: null, local: null }, 'reset should delete both key copies');
  await desktop.getByText('正在使用 suda 的快捷 API 额度进行优化', { exact: false }).waitFor();
  await desktop.getByRole('button', { name: '关闭 AI 优化' }).click();
  console.log('PASS: remember key opt-in and reset to default provider');


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
