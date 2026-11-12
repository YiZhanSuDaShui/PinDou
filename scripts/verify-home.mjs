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
  // Avoid a previous click leaving the cursor hovering over just one button.
  await mobile.mouse.move(1, 1);
  await mobile.waitForTimeout(250);
  const mobileButtonStyles = await mobile.locator('.studio-edit-actions > button').evaluateAll(items =>
    items.map(item => {
      const style = getComputedStyle(item);
      return {
        background: style.backgroundColor,
        border: style.borderColor,
        color: style.color,
        shadow: style.boxShadow,
        radius: style.borderRadius
      };
    })
  );
  assert.deepEqual(mobileButtonStyles[1], mobileButtonStyles[0],
    'mobile: focus mode button must match manual edit button styling');
  assert.deepEqual(mobileButtonStyles[2], mobileButtonStyles[0],
    'mobile: archive button must match manual edit button styling');
  assert.equal(mobileButtonStyles[0].background, 'rgb(255, 255, 255)',
    'mobile: all three editor buttons should share white backgrounds');

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
  // Close download settings before clicking cloud archive actions.
  await desktop.getByRole('heading', { name: '下载图纸设置' }).waitFor();
  await desktop.getByRole('button', { name: '取消' }).last().click();

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
  // Compare the same idle state for all three buttons, not one hovered button.
  await desktop.mouse.move(1, 1);
  await desktop.waitForTimeout(250);
  const desktopButtonStyles = await desktop.locator('.studio-edit-actions > button').evaluateAll(items =>
    items.map(item => {
      const style = getComputedStyle(item);
      return {
        background: style.backgroundColor,
        border: style.borderColor,
        color: style.color,
        shadow: style.boxShadow,
        radius: style.borderRadius
      };
    })
  );
  assert.deepEqual(desktopButtonStyles[1], desktopButtonStyles[0],
    'desktop: focus mode button must match manual edit button styling');
  assert.deepEqual(desktopButtonStyles[2], desktopButtonStyles[0],
    'desktop: archive button must match manual edit button styling');
  assert.equal(desktopButtonStyles[0].background, 'rgb(255, 255, 255)',
    'desktop: all three editor buttons should share white backgrounds');

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

  // New browser session: enter the leading-zero code, fetch the CSV and
  // restore it through the existing import parser. A second save must return
  // the exact same CSV, including TRANSPARENT cells, without re-pixelation.
  const restorePage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  restorePage.on('pageerror', error => pageErrors.push('archive restore: ' + error.message));
  let loadedCodes = 0;
  let resaved = false;
  await restorePage.route('**/api/archive*', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      assert.equal(new URL(req.url()).searchParams.get('code'), '059864');
      loadedCodes++;
      await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: postedCsv });
    } else {
      const body = req.postDataJSON();
      assert.equal(body.csv, postedCsv, 'a restored CSV must survive save without losing any cells');
      resaved = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '123456' }) });
    }
  });
  await restorePage.goto(url, { waitUntil: 'domcontentloaded' });
  await restorePage.locator('.studio-dropzone[aria-disabled="false"]').waitFor();
  await restorePage.getByRole('textbox', { name: '六位数字对接码' }).fill('059864');
  await restorePage.locator('.studio-archive-import').getByRole('button', { name: '确认', exact: true }).click();
  await restorePage.getByText('拼豆效果预览').waitFor({ timeout: 25000 });
  await restorePage.waitForTimeout(450);
  await restorePage.getByRole('button', { name: '生成对接码' }).click();
  await restorePage.getByRole('dialog', { name: '已生成对接码' }).getByText('123456').waitFor();
  assert.equal(loadedCodes, 1);
  assert.equal(resaved, true);
  await restorePage.screenshot({ path: path.join(output, 'desktop-csv-restored.png'), animations: 'disabled' });
  await restorePage.close();
  console.log('PASS: cloud six-digit code restores the exact source CSV without remapping');


  // Regression: previously a portrait CSV was drawn onto HTML canvas's default
  // 300x150 bitmap, turning a tall person into a wide/squashed figure. The
  // stored 36x84 grid must keep square beads when restored by code or local CSV.
  const portraitColumns = 36;
  const portraitRows = 84;
  const portraitCsv = Array.from({ length: portraitRows }, (_, row) =>
    Array.from({ length: portraitColumns }, (_, col) => {
      if (col < 3 || col > 32 || row < 3 || row > 80) return 'TRANSPARENT';
      return (row + col) % 11 === 0 ? '#B85F86' : '#FFF0F5';
    }).join(',')
  ).join('\n');

  const checkPortraitCanvas = async (page, label) => {
    await page.getByText('拼豆效果预览').waitFor({ timeout: 25000 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.studio-preview-stage canvas');
      return canvas && canvas.height > canvas.width * 2;
    }, { timeout: 15000 });
    const metrics = await page.locator('.studio-preview-stage canvas').first().evaluate(canvas => {
      const box = canvas.getBoundingClientRect();
      return {
        width: canvas.width, height: canvas.height,
        cssWidth: box.width, cssHeight: box.height
      };
    });
    const gridRatio = portraitColumns / portraitRows;
    assert.ok(Math.abs(metrics.width / metrics.height - gridRatio) < .01,
      label + ': intrinsic canvas ratio must match portrait grid ' + JSON.stringify(metrics));
    assert.ok(Math.abs(metrics.cssWidth / metrics.cssHeight - gridRatio) < .02,
      label + ': displayed canvas ratio must preserve portrait image ' + JSON.stringify(metrics));
    assert.ok(Math.abs((metrics.width / portraitColumns) / (metrics.height / portraitRows) - 1) < .01,
      label + ': rendered beads must have approximately square cells');
    await page.screenshot({
      path: path.join(output, label + '-portrait-csv.png'),
      animations: 'disabled'
    });
    return metrics;
  };

  const portraitPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  portraitPage.on('pageerror', error => pageErrors.push('portrait code restore: ' + error.message));
  let portraitResaved = false;
  await portraitPage.route('**/api/archive*', async route => {
    if (route.request().method() === 'GET') {
      assert.equal(new URL(route.request().url()).searchParams.get('code'), '002718');
      await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8',
        body: portraitCsv });
    } else {
      const body = route.request().postDataJSON();
      assert.equal(body.csv, portraitCsv,
        'portrait cloud restore must preserve cell order and transparent markers');
      portraitResaved = true;
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '001009' }) });
    }
  });
  await portraitPage.goto(url, { waitUntil: 'domcontentloaded' });
  await portraitPage.locator('.studio-dropzone[aria-disabled="false"]').waitFor();
  await portraitPage.getByRole('textbox', { name: '六位数字对接码' }).fill('002718');
  await portraitPage.locator('.studio-archive-import')
    .getByRole('button', { name: '确认', exact: true }).click();
  const codeMetrics = await checkPortraitCanvas(portraitPage, 'code-restored');
  await portraitPage.getByRole('button', { name: '生成对接码' }).click();
  await portraitPage.getByRole('dialog', { name: '已生成对接码' })
    .getByText('001009').waitFor();
  assert.equal(portraitResaved, true);
  await portraitPage.close();

  const filePage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  filePage.on('pageerror', error => pageErrors.push('portrait CSV file import: ' + error.message));
  await filePage.goto(url, { waitUntil: 'domcontentloaded' });
  await filePage.locator('.studio-dropzone[aria-disabled="false"]').waitFor();
  filePage.on('dialog', dialog => dialog.accept());
  await filePage.locator('input[type="file"][accept*="image/png"]').setInputFiles({
    name: 'portrait-grid.csv', mimeType: 'text/csv', buffer: Buffer.from(portraitCsv)
  });
  const fileMetrics = await checkPortraitCanvas(filePage, 'file-restored');
  assert.equal(fileMetrics.width, codeMetrics.width);
  assert.equal(fileMetrics.height, codeMetrics.height);
  await filePage.close();
  console.log('PASS: portrait CSV code/file imports preserve aspect ratio, square cells and exact grid');


  // Golden beam regression: target colors are deliberately confined to far
  // left and far right. The right-hand color must light up promptly without
  // waiting for a beam to cross empty image columns.
  const flowCols = 40;
  const flowRows = 12;
  const flowCsv = Array.from({ length: flowRows }, (_, y) =>
    Array.from({ length: flowCols }, (_, x) => {
      if (y >= 2 && y <= 9 && x >= 4 && x <= 10) return '#B85F86';
      if (y >= 2 && y <= 9 && x >= 29 && x <= 35) return '#2C5B89';
      return 'TRANSPARENT';
    }).join(',')
  ).join('\n');

  const goldPage = await browser.newPage({ viewport: { width: 1250, height: 800 } });
  goldPage.on('pageerror', e => pageErrors.push('gold preview: ' + e.message));
  await goldPage.route('**/api/archive*', async route => {
    assert.equal(route.request().method(), 'GET', 'gold tests should never save to cloud');
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: flowCsv });
  });
  await goldPage.goto(url, { waitUntil: 'domcontentloaded' });
  await goldPage.locator('.studio-dropzone[aria-disabled="false"]').waitFor();
  await goldPage.getByRole('textbox', { name: '六位数字对接码' }).fill('090808');
  await goldPage.locator('.studio-archive-import').getByRole('button', { name: '确认', exact: true }).click();
  await goldPage.getByText('拼豆效果预览').waitFor({ timeout: 25000 });

  const leftRow = goldPage.locator('.studio-noise-row[data-color-hex="#B85F86"]');
  const rightRow = goldPage.locator('.studio-noise-row[data-color-hex="#2C5B89"]');
  assert.equal(await leftRow.count(), 1);
  assert.equal(await rightRow.count(), 1);
  const gridBefore = await goldPage.locator('.studio-preview-stage canvas').first()
    .evaluate(canvas => canvas.toDataURL());
  const sampleSweep = () => {
    const layer = document.querySelector('canvas[data-golden-flow="true"]');
    if (!layer || !layer.width || !layer.height) return { left: 0, right: 0 };
    const ctx = layer.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { left: 0, right: 0 };
    const data = ctx.getImageData(0, 0, layer.width, layer.height).data;
    const count = (colStart, colEnd) => {
      let total = 0;
      for (let col = colStart; col <= colEnd; col++) {
        for (let row = 3; row <= 8; row++) {
          const x = Math.floor((col + .5) * layer.width / 40);
          const y = Math.floor((row + .5) * layer.height / 12);
          if (data[(y * layer.width + x) * 4 + 3] >= 22) total++;
        }
      }
      return total;
    };
    return { left: count(4, 10), right: count(29, 35) };
  };


  const sampleSweepCondition = () => {
    const layer = document.querySelector('canvas[data-golden-flow="true"]');
    if (!layer || !layer.width || !layer.height) return false;
    const ctx = layer.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, layer.width, layer.height).data;
    for (let col = 4; col <= 10; col++) for (let row = 3; row <= 8; row++) {
      const x = Math.floor((col + .5) * layer.width / 40);
      const y = Math.floor((row + .5) * layer.height / 12);
      if (data[(y * layer.width + x) * 4 + 3] >= 22) return true;
    }
    return false;
  };
  const sampleRightGoldAndNoLeft = () => {
    const layer = document.querySelector('canvas[data-golden-flow="true"]');
    if (!layer || !layer.width || !layer.height) return false;
    const ctx = layer.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, layer.width, layer.height).data;
    const hasGold = (from, to) => {
      for (let col = from; col <= to; col++) for (let row = 3; row <= 8; row++) {
        const x = Math.floor((col + .5) * layer.width / 40);
        const y = Math.floor((row + .5) * layer.height / 12);
        if (data[(y * layer.width + x) * 4 + 3] >= 22) return true;
      }
      return false;
    };
    return hasGold(29, 35) && !hasGold(4, 10);
  };

  await leftRow.hover();
  await goldPage.waitForFunction(sampleSweepCondition, null, { timeout: 2000 }).catch(async () => {
    throw new Error('A color never displayed a golden sweep: ' + JSON.stringify(await goldPage.evaluate(sampleSweep)));
  });
  const firstGold = await goldPage.evaluate(sampleSweep);
  assert.ok(firstGold.left > 0 && firstGold.right === 0,
    'left color must light up without touching right color: ' + JSON.stringify(firstGold));

  // A -> B during the active sweep: old light fades within ~160ms while B
  // starts near its own leftmost bead, despite being at the far image right.
  await rightRow.hover();
  await goldPage.waitForFunction(sampleRightGoldAndNoLeft, null, { timeout: 1800 });
  const switched = await goldPage.evaluate(sampleSweep);
  assert.ok(switched.right > 0 && switched.left === 0,
    'new color must replace old glow promptly: ' + JSON.stringify(switched));

  // Eye mode is different from gold: a full neutral mask immediately hides
  // all non-target beads, holds for 3000ms, then fades out over ~400ms.
  const readOverlay = () => {
    const layer = document.querySelector('canvas[data-golden-flow="true"]');
    if (!layer || !layer.width || !layer.height) return { left: 0, right: 0, empty: 0 };
    const ctx = layer.getContext('2d', { willReadFrequently: true });
    const alpha = (col, row) => {
      const x = Math.floor((col + .5) * layer.width / 40);
      const y = Math.floor((row + .5) * layer.height / 12);
      return ctx.getImageData(x, y, 1, 1).data[3];
    };
    return { left: alpha(7, 5), right: alpha(32, 5), empty: alpha(20, 5) };
  };

  const countBeforeEye = await rightRow.locator('.studio-noise-count').innerText();
  await rightRow.getByRole('button', { name: /预览.*颜色的位置/ }).click();
  await goldPage.waitForTimeout(240); // interrupted gold is fully faded by now
  let isolated = await goldPage.evaluate(readOverlay);
  assert.ok(isolated.left >= 248 && isolated.empty >= 248 && isolated.right <= 8,
    'eye preview must hide every other color, not paint selected beads gold: ' + JSON.stringify(isolated));
  assert.equal(await rightRow.locator('.studio-noise-count').innerText(), countBeforeEye);
  assert.equal(await rightRow.count(), 1);

  await goldPage.waitForTimeout(2420);
  isolated = await goldPage.evaluate(readOverlay);
  assert.ok(isolated.left >= 248 && isolated.empty >= 248 && isolated.right <= 8,
    'all non-target colors must still be hidden before 3 seconds: ' + JSON.stringify(isolated));

  await goldPage.waitForFunction(() => {
    const layer = document.querySelector('canvas[data-golden-flow="true"]');
    const ctx = layer?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    const x = Math.floor(7.5 * layer.width / 40);
    const y = Math.floor(5.5 * layer.height / 12);
    const alpha = ctx.getImageData(x, y, 1, 1).data[3];
    return alpha > 8 && alpha < 245;
  }, null, { timeout: 1500 });
  await goldPage.waitForFunction(() => {
    const layer = document.querySelector('canvas[data-golden-flow="true"]');
    const ctx = layer?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    const x = Math.floor(7.5 * layer.width / 40);
    const y = Math.floor(5.5 * layer.height / 12);
    return ctx.getImageData(x, y, 1, 1).data[3] <= 8;
  }, null, { timeout: 1700 });
  assert.equal(
    await goldPage.locator('.studio-preview-stage canvas').first().evaluate(c => c.toDataURL()),
    gridBefore, 'single-color isolation must not rewrite the underlying bead grid'
  );
  console.log('PASS: eye isolation holds exactly one true bead color for 3 seconds and fades');

  // Manual palette gold mode: once the left-to-right beam has passed, ALL
  // matching beads remain illuminated for another 2 seconds, then fade.
  await goldPage.getByRole('button', { name: '进入手动编辑模式' }).click();
  await goldPage.locator('button[title*="#B85F86"]').click();
  await goldPage.waitForFunction(sampleSweepCondition, null, { timeout: 2000 });
  await goldPage.waitForTimeout(1050);
  let manualGold = await goldPage.evaluate(readOverlay);
  assert.ok(manualGold.left > 30 && manualGold.right === 0,
    'target color must remain gold after the sweep finished: ' + JSON.stringify(manualGold));
  await goldPage.waitForTimeout(950);
  manualGold = await goldPage.evaluate(readOverlay);
  assert.ok(manualGold.left > 30 && manualGold.right === 0,
    'gold illumination should still remain during the 2s hold: ' + JSON.stringify(manualGold));

  // Even during the prolonged hold, choosing B instantly interrupts A;
  // the previously lit beads fade quickly, with no waiting for its timer.
  await goldPage.locator('button[title*="#2C5B89"]').click();
  // The moving light reaches B's LEFTMOST beads before its center. Inspect
  // the same center pixels that the final assertion uses, after the old
  // hold's 160ms crossfade has completely finished.
  await goldPage.waitForFunction(() => {
    const layer = document.querySelector('canvas[data-golden-flow="true"]');
    const ctx = layer?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    const alpha = (col, row) => {
      const x = Math.floor((col + .5) * layer.width / 40);
      const y = Math.floor((row + .5) * layer.height / 12);
      return ctx.getImageData(x, y, 1, 1).data[3];
    };
    return alpha(7, 5) <= 8 && alpha(32, 5) > 20;
  }, null, { timeout: 1800 });
  const interruptedHold = await goldPage.evaluate(readOverlay);
  assert.ok(interruptedHold.left <= 8 && interruptedHold.right > 20,
    'switching palette colors must interrupt the old held beam: ' + JSON.stringify(interruptedHold));
  await goldPage.waitForTimeout(1150);
  manualGold = await goldPage.evaluate(readOverlay);
  assert.ok(manualGold.right > 30 && manualGold.left <= 8,
    'new color should retain its own gold highlight: ' + JSON.stringify(manualGold));
  await goldPage.waitForFunction(() => {
    const layer = document.querySelector('canvas[data-golden-flow="true"]');
    const ctx = layer?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    const x = Math.floor(32.5 * layer.width / 40);
    const y = Math.floor(5.5 * layer.height / 12);
    return ctx.getImageData(x, y, 1, 1).data[3] <= 8;
  }, null, { timeout: 2800 });

  assert.equal(
    await goldPage.locator('.studio-preview-stage canvas').first().evaluate(c => c.toDataURL()),
    gridBefore, 'manual palette selection should not paint until the canvas is clicked'
  );
  await goldPage.screenshot({ path: path.join(output, 'golden-flow-manual.png'), animations: 'disabled' });

  // Reversible manual painting on the exact restored 40x12 grid.
  const beadCanvas = goldPage.locator('.studio-preview-stage canvas').first();
  const brushToggle = goldPage.getByRole('button', { name: '连续画笔' });
  const undoButton = goldPage.getByRole('button', { name: '撤销', exact: true });
  const redoButton = goldPage.getByRole('button', { name: '重做', exact: true });
  assert.equal(await goldPage.getByText('橡皮擦', { exact: true }).count(), 0,
    'single eraser button should no longer exist');
  assert.equal(await undoButton.isDisabled(), true);
  assert.equal(await redoButton.isDisabled(), true);
  const paintedCell = async (col, row) => beadCanvas.evaluate((canvas, loc) => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return Array.from(ctx.getImageData(
      Math.floor((loc.col + .5) * canvas.width / 40),
      Math.floor((loc.row + .5) * canvas.height / 12), 1, 1).data).slice(0, 3);
  }, { col, row });
  const pinkCell = await paintedCell(5, 4);
  const blueCell = await paintedCell(32, 4);
  const box = await beadCanvas.boundingBox();
  assert.ok(box, 'paint canvas must be visible');
  const gridPoint = (col, row) => ({
    x: box.x + (col + .5) * box.width / 40,
    y: box.y + (row + .5) * box.height / 12
  });
  await brushToggle.click();
  assert.equal(await brushToggle.getAttribute('aria-pressed'), 'true');
  await goldPage.mouse.move(gridPoint(5, 4).x, gridPoint(5, 4).y);
  await goldPage.mouse.down();
  await goldPage.mouse.move(gridPoint(9, 4).x, gridPoint(9, 4).y, { steps: 7 });
  await goldPage.mouse.up();
  assert.deepEqual(await paintedCell(5, 4), blueCell);
  assert.deepEqual(await paintedCell(9, 5), blueCell, 'stroke must paint second row and intermediate cells');
  assert.equal(await undoButton.isEnabled(), true);
  await undoButton.click();
  assert.deepEqual(await paintedCell(5, 4), pinkCell, 'one undo should restore entire continuous stroke');
  assert.deepEqual(await paintedCell(9, 5), pinkCell);
  await redoButton.click();
  assert.deepEqual(await paintedCell(9, 5), blueCell, 'redo should restore entire stroke');
  await undoButton.click();
  await brushToggle.click();
  assert.equal(await brushToggle.getAttribute('aria-pressed'), 'false');

  // Six individual edits retain only the newest five. A fresh edit after undo
  // must clear redo, while the oldest action remains in the picture.
  for (let col = 4; col < 10; col++) {
    const point = gridPoint(col, 4);
    await goldPage.mouse.click(point.x, point.y);
  }
  assert.equal(await undoButton.isEnabled(), true);
  assert.equal(await redoButton.isDisabled(), true);
  for (let step = 0; step < 5; step++) await undoButton.click();
  assert.equal(await undoButton.isDisabled(), true, 'history is limited to five completed actions');
  assert.deepEqual(await paintedCell(4, 4), blueCell, 'sixth action evicts oldest undo');
  assert.deepEqual(await paintedCell(9, 4), pinkCell, 'most recent action must be undone');
  for (let step = 0; step < 5; step++) await redoButton.click();
  assert.equal(await redoButton.isDisabled(), true);
  assert.deepEqual(await paintedCell(9, 4), blueCell);
  console.log('PASS: 2x2 pointer brush, single-stroke undo/redo, five-step cap and no eraser button');
  await goldPage.close();
  console.log('PASS: left-to-right sweep, gold 2s hold/fade, A/B interruption, eye isolate and manual palette');

  // A touch viewport can preview without long-press, and without invoking
  // the destructive row action.
  const eyePage = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
  });
  eyePage.on('pageerror', e => pageErrors.push('touch eye preview: ' + e.message));
  await eyePage.route('**/api/archive*', async route => {
    await route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: flowCsv });
  });
  await eyePage.goto(url, { waitUntil: 'domcontentloaded' });
  await eyePage.locator('.studio-dropzone[aria-disabled="false"]').waitFor();
  await eyePage.getByRole('textbox', { name: '六位数字对接码' }).fill('090808');
  await eyePage.locator('.studio-archive-import').getByRole('button', { name: '确认', exact: true }).click();
  await eyePage.getByText('拼豆效果预览').waitFor({ timeout: 25000 });
  const touchRow = eyePage.locator('.studio-noise-row[data-color-hex="#B85F86"]');
  const beforeTouchCount = await touchRow.locator('.studio-noise-count').innerText();
  const eyeButton = touchRow.getByRole('button', { name: /预览.*颜色的位置/ });
  assert.ok(await eyeButton.isVisible(), 'eye preview must be visible on touch screens');
  await eyeButton.tap();
  assert.equal(await touchRow.locator('.studio-noise-count').innerText(), beforeTouchCount);
  assert.equal(await touchRow.count(), 1, 'eye tap must not delete a color');
  await eyePage.close();
  console.log('PASS: touch eye preview does not remove colors');

  await desktop.close();

  assert.deepEqual(pageErrors, [], 'Browser JavaScript errors: ' + pageErrors.join(' | '));
  console.log('PASS: all smoke tests');
} finally {
  await browser.close();
}
