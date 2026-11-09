/**
 * Build every browser/PWA icon from the user's supplied couple illustration.
 * Runs before Next.js static export so EdgeOne and GitHub Actions ship matching icons.
 */
const sharp = require('sharp');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const sourcePath = path.join(publicDir, 'xinxinxin-logo.webp');

const icons = [
  { size: 32, name: 'favicon-32x32.png', inset: 1 },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192x192.png' },
  { size: 256, name: 'icon-256x256.png' },
  { size: 384, name: 'icon-384x384.png' },
  { size: 512, name: 'icon-512x512.png' }
];

async function generateIcon({ size, name, inset }) {
  // Keep the faces in the safe zone for rounded homescreen icon masks.
  const padding = inset ?? Math.round(size * 0.1);
  const photoSize = size - 2 * padding;
  const radius = Math.round(photoSize * 0.17);
  const photo = await sharp(sourcePath)
    .resize(photoSize, photoSize, { fit: 'cover' })
    .png()
    .toBuffer();

  const clipMask = Buffer.from(
    `<svg width="${photoSize}" height="${photoSize}" xmlns="http://www.w3.org/2000/svg">
       <rect width="${photoSize}" height="${photoSize}" rx="${radius}" ry="${radius}" fill="#ffffff" />
     </svg>`
  );
  const roundedPhoto = await sharp(photo)
    .composite([{ input: clipMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: '#fff0f5' }
  })
    .composite([{ input: roundedPhoto, left: padding, top: padding }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDir, name));

  console.log(`Generated XinXinXin portrait icon: ${name}`);
}

async function main() {
  for (const icon of icons) await generateIcon(icon);
}

main().catch((error) => {
  console.error('Failed to generate portrait icons:', error);
  process.exitCode = 1;
});
