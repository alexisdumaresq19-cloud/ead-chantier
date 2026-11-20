// Draws the iPhone app's images from the logos in public/brand: the app icon
// and the logo of the launch screen, into ios/App/App/Assets.xcassets.
// The results are committed; run again only when a logo changes:
//   node scripts/ios-assets.mjs
//
// Both are flattened on the app's black: Apple refuses an icon with an alpha
// channel, and the logo is drawn for a black background only.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const brand = join(root, "public", "brand");
const assets = join(root, "ios", "App", "App", "Assets.xcassets");
const black = "#0b0d10";

/** The icon: the EAD emblem alone, centred, with room around it. Its width
 * is close to the drawing's own (625 px), so it is never enlarged. */
const ICON = 1024;
const ICON_MARK_WIDTH = 620;

/** The launch screen shows the full logo at this width, in points. */
const LAUNCH_WIDTH = 200;

async function emptyFolder(folder) {
  await mkdir(folder, { recursive: true });
  for (const name of await readdir(folder)) await rm(join(folder, name));
}

async function contents(folder, images) {
  const json = { images, info: { author: "xcode", version: 1 } };
  await writeFile(join(folder, "Contents.json"), JSON.stringify(json, null, 2) + "\n");
}

async function icon() {
  const folder = join(assets, "AppIcon.appiconset");
  await emptyFolder(folder);
  const mark = await sharp(join(brand, "ead-mark.png"))
    .resize({ width: ICON_MARK_WIDTH })
    .toBuffer({ resolveWithObject: true });
  // A shade above the centre: the emblem's weight is in its lower half.
  const top = Math.round((ICON - mark.info.height) / 2 - ICON * 0.02);
  await sharp({ create: { width: ICON, height: ICON, channels: 3, background: black } })
    .composite([{ input: mark.data, left: Math.round((ICON - mark.info.width) / 2), top }])
    .removeAlpha()
    .png()
    .toFile(join(folder, "AppIcon-1024.png"));
  await contents(folder, [
    { filename: "AppIcon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" },
  ]);
}

async function launchLogo() {
  const folder = join(assets, "Splash.imageset");
  await emptyFolder(folder);
  const images = [];
  for (const scale of [1, 2, 3]) {
    const filename = `splash@${scale}x.png`;
    await sharp(join(brand, "ead-logo.png"))
      .resize({ width: LAUNCH_WIDTH * scale })
      .flatten({ background: black })
      .png()
      .toFile(join(folder, filename));
    images.push({ filename, idiom: "universal", scale: `${scale}x` });
  }
  await contents(folder, images);
}

await icon();
await launchLogo();
console.log("Images de l'app iPhone écrites dans ios/App/App/Assets.xcassets.");
