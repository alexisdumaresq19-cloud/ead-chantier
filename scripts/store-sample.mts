/**
 * More sample content for the App Store screenshots, on top of what
 * scripts/seed-dev.mts leaves: site photos over the last days (drawn here,
 * each marked "EXEMPLE"), the photos of yesterday's report, three earlier
 * reports and the documents of a project under way. Everything is fictional
 * and says so. It goes through the API as the foreman, the way her phone would.
 *
 *   BASE=http://localhost:3265 npm run seed
 *   BASE=http://localhost:3265 npx tsx scripts/store-sample.mts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON in a dev script */
import { mkdirSync, readFileSync } from "node:fs";

import sharp from "sharp";

import { siteTimeToDate } from "../src/shared/photos";

const BASE = process.env.BASE ?? "http://localhost:3265";
const SEED = process.env.SEED_OUT ?? ".data/dev";

// --- Days ---------------------------------------------------------------------

const siteDay = (daysAgo: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    Date.now() - daysAgo * 86_400_000,
  );
/** The weekdays before the two days the seed already wrote reports for. */
const earlierWorkdays = (count: number) => {
  const days: string[] = [];
  for (let back = 3; days.length < count; back++) {
    const day = siteDay(back);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(day);
  }
  return days;
};
/** A moment of a past day, on the site's clock. */
const at = (day: string, hour: number, minute: number) =>
  siteTimeToDate(
    Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`),
  ).toISOString();

// --- Drawn site photos ----------------------------------------------------------
// Plain shapes with light, shade and grain, so that a thumbnail reads as a
// photo of a street under work. Each one says "EXEMPLE".

type Scene = "trench" | "pipe" | "manhole" | "compaction" | "street" | "loading" | "paving";

const n = (value: number) => value.toFixed(1);

function excavator(x: number, y: number, s: number, flip = false) {
  // Drawn facing right, its tracks' bottom at (x, y), s = 1 for 600 px long.
  const t = `translate(${n(x)} ${n(y)}) scale(${flip ? -s : s} ${s})`;
  return `<g transform="${t}">
    <ellipse cx="180" cy="4" rx="300" ry="22" fill="#000" opacity="0.28" filter="url(#soft)"/>
    <rect x="0" y="-70" width="380" height="70" rx="35" fill="#26282b"/>
    <rect x="12" y="-60" width="356" height="50" rx="25" fill="#3a3d41"/>
    ${[40, 100, 160, 220, 280, 340].map((cx) => `<circle cx="${cx}" cy="-35" r="17" fill="#1b1c1e"/><circle cx="${cx}" cy="-35" r="6" fill="#55595e"/>`).join("")}
    <rect x="120" y="-100" width="140" height="34" fill="#2c2e31"/>
    <path d="M30 -100 L330 -100 L330 -190 L250 -190 L250 -215 L30 -215 Z" fill="url(#yellow)"/>
    <rect x="-10" y="-205" width="70" height="105" rx="10" fill="#d99f00"/>
    <path d="M250 -190 L330 -190 L330 -330 L262 -330 Q250 -330 250 -318 Z" fill="url(#yellow)"/>
    <path d="M262 -318 L318 -318 L318 -205 L262 -205 Z" fill="url(#glass)"/>
    <path d="M268 -312 L300 -312 L272 -240 L268 -240 Z" fill="#fff" opacity="0.35"/>
    <path d="M300 -150 L345 -170 L560 -360 L590 -330 L380 -120 Z" fill="url(#yellow)"/>
    <path d="M560 -360 L590 -330 L640 -120 L605 -110 Z" fill="#e6a900"/>
    <path d="M595 -125 L660 -110 L650 -40 Q620 -20 585 -40 Z" fill="#2d2f33"/>
    <path d="M590 -42 L600 -22 L610 -42 L620 -22 L630 -42 L640 -24 L650 -42" stroke="#1a1b1d" stroke-width="6" fill="none"/>
    <rect x="45" y="-160" width="180" height="10" fill="#1d1e20" opacity="0.6"/>
  </g>`;
}

function roller(x: number, y: number, s: number) {
  const t = `translate(${n(x)} ${n(y)}) scale(${s})`;
  return `<g transform="${t}">
    <ellipse cx="170" cy="4" rx="260" ry="20" fill="#000" opacity="0.28" filter="url(#soft)"/>
    <circle cx="350" cy="-95" r="95" fill="url(#steel)"/>
    <circle cx="350" cy="-95" r="40" fill="#e6a900"/>
    <rect x="250" y="-205" width="40" height="120" fill="#d99f00"/>
    <path d="M-30 -60 L260 -60 L260 -190 L110 -190 L80 -150 L-30 -150 Z" fill="url(#yellow)"/>
    <rect x="70" y="-330" width="150" height="140" rx="10" fill="none" stroke="#26282b" stroke-width="12"/>
    <rect x="60" y="-342" width="170" height="20" rx="6" fill="#26282b"/>
    <circle cx="40" cy="-55" r="60" fill="#1b1c1e"/>
    <circle cx="40" cy="-55" r="25" fill="#55595e"/>
    <circle cx="170" cy="-55" r="60" fill="#1b1c1e"/>
    <circle cx="170" cy="-55" r="25" fill="#55595e"/>
  </g>`;
}

function truck(x: number, y: number, s: number) {
  const t = `translate(${n(x)} ${n(y)}) scale(${s})`;
  return `<g transform="${t}">
    <ellipse cx="300" cy="4" rx="360" ry="22" fill="#000" opacity="0.28" filter="url(#soft)"/>
    <path d="M0 -90 L470 -90 L500 -300 L20 -300 Z" fill="#6b7076"/>
    <path d="M20 -300 L500 -300 L495 -270 L24 -270 Z" fill="#8a9097"/>
    <rect x="480" y="-260" width="170" height="170" rx="16" fill="#c0392b"/>
    <path d="M560 -250 L640 -250 L640 -170 L560 -170 Z" fill="url(#glass)"/>
    <rect x="470" y="-95" width="190" height="20" fill="#2c2e31"/>
    <rect x="0" y="-100" width="480" height="18" fill="#2c2e31"/>
    ${[90, 200, 560].map((cx) => `<circle cx="${cx}" cy="-45" r="48" fill="#1b1c1e"/><circle cx="${cx}" cy="-45" r="20" fill="#7d8288"/>`).join("")}
  </g>`;
}

function cone(x: number, y: number, s: number) {
  const t = `translate(${n(x)} ${n(y)}) scale(${s})`;
  return `<g transform="${t}">
    <ellipse cx="0" cy="2" rx="46" ry="8" fill="#000" opacity="0.3" filter="url(#soft)"/>
    <rect x="-45" y="-12" width="90" height="12" rx="3" fill="#1d1e20"/>
    <path d="M-30 -12 L-8 -120 L8 -120 L30 -12 Z" fill="#f05a1a"/>
    <path d="M-23 -45 L23 -45 L18 -70 L-18 -70 Z" fill="#f4f4f4"/>
    <path d="M-14 -88 L14 -88 L11 -102 L-11 -102 Z" fill="#f4f4f4"/>
  </g>`;
}

function houses(y: number, w: number, seedHue: number) {
  const colours = ["#c8553d", "#f2d0a4", "#5b8e7d", "#e9e4d8", "#3e6990", "#e3b23c"];
  let x = -60 + ((seedHue * 41) % 80);
  let out = "";
  let i = seedHue;
  while (x < w) {
    const width = 150 + ((i * 53) % 90);
    const height = 90 + ((i * 37) % 50);
    const c = colours[i % colours.length];
    const top = y - height;
    out += `<g>
      <rect x="${x}" y="${top}" width="${width}" height="${height}" fill="${c}"/>
      <rect x="${x}" y="${top}" width="${width}" height="${height}" fill="url(#haze)"/>
      <rect x="${x + width * 0.7}" y="${top}" width="${width * 0.3}" height="${height}" fill="#000" opacity="0.12"/>
      <path d="M${x - 8} ${top} L${x + width / 2} ${top - 46 - (i % 3) * 8} L${x + width + 8} ${top} Z" fill="${i % 2 ? "#3b3f45" : "#5a4a42"}"/>
      ${[0.18, 0.6]
        .map(
          (f) =>
            `<rect x="${x + width * f}" y="${top + height * 0.28}" width="${width * 0.2}" height="${height * 0.3}" fill="#cfe0ee" stroke="#fff" stroke-width="4"/>`,
        )
        .join("")}
      <rect x="${x + width * 0.42}" y="${y - height * 0.42}" width="${width * 0.14}" height="${height * 0.42}" fill="#4a3b33"/>
    </g>`;
    // A lot between two houses, where the trees behind show.
    x += width + 90 + ((i * 29) % 120);
    i++;
  }
  return out;
}

function treeLine(y: number, w: number, colour: string, height: number, step: number) {
  let path = `M0 ${y} `;
  for (let x = 0, i = 0; x <= w + step; x += step, i++) {
    const h = height * (0.6 + ((i * 37) % 10) / 20);
    path += `L${x + step / 2} ${y - h} L${x + step} ${y - h * 0.3} `;
  }
  path += `L${w} ${y + 40} L0 ${y + 40} Z`;
  return `<path d="${path}" fill="${colour}"/>`;
}

function defs(w: number, h: number, overcast: boolean) {
  return `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${overcast ? "#9fb0bf" : "#5f9fd8"}"/>
      <stop offset="1" stop-color="${overcast ? "#dfe4e8" : "#dcebf6"}"/>
    </linearGradient>
    <linearGradient id="yellow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffc928"/><stop offset="1" stop-color="#e3a400"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9fc3dc"/><stop offset="1" stop-color="#2e4a60"/>
    </linearGradient>
    <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b9bec4"/><stop offset="0.5" stop-color="#7c8289"/><stop offset="1" stop-color="#4b5056"/>
    </linearGradient>
    <linearGradient id="pvc" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#174a85"/><stop offset="0.35" stop-color="#4d92dc"/><stop offset="1" stop-color="#123a69"/>
    </linearGradient>
    <linearGradient id="pvcLong" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#123a69"/><stop offset="0.4" stop-color="#4d92dc"/><stop offset="1" stop-color="#174a85"/>
    </linearGradient>
    <linearGradient id="concrete" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8e9296"/><stop offset="0.4" stop-color="#c9cccf"/><stop offset="1" stop-color="#7a7e82"/>
    </linearGradient>
    <linearGradient id="earth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a6a4a"/><stop offset="1" stop-color="#5a4330"/>
    </linearGradient>
    <linearGradient id="pit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a3626"/><stop offset="1" stop-color="#2a1e15"/>
    </linearGradient>
    <linearGradient id="asphalt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5d6166"/><stop offset="1" stop-color="#3a3d41"/>
    </linearGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dfe7ee" stop-opacity="0.35"/><stop offset="1" stop-color="#dfe7ee" stop-opacity="0.1"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="cloud" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="${w + h}"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 -0.35"/>
      <feComposite in2="SourceAlpha" operator="in"/>
    </filter>
    <filter id="gravel" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.05 0.12" numOctaves="4" seed="7"/>
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.8 -0.3"/>
      <feComposite in2="SourceAlpha" operator="in"/>
    </filter>
  </defs>`;
}

function sky(w: number, horizon: number, overcast: boolean) {
  return `<rect width="${w}" height="${horizon + 60}" fill="url(#sky)"/>
    <g filter="url(#cloud)" fill="#fff" opacity="${overcast ? 0.55 : 0.8}">
      <ellipse cx="${w * 0.22}" cy="${horizon * 0.3}" rx="${w * 0.16}" ry="50"/>
      <ellipse cx="${w * 0.7}" cy="${horizon * 0.18}" rx="${w * 0.2}" ry="60"/>
      <ellipse cx="${w * 0.85}" cy="${horizon * 0.5}" rx="${w * 0.12}" ry="35"/>
    </g>`;
}

function drawScene(scene: Scene, w: number, h: number) {
  const overcast = scene === "compaction" || scene === "loading";
  const horizon = h * (h > w ? 0.38 : 0.42);
  const parts: string[] = [defs(w, h, overcast), sky(w, horizon, overcast)];
  parts.push(treeLine(horizon, w, "#6f8a7c", 120, 46));
  parts.push(treeLine(horizon + 20, w, "#3f5a4a", 90, 34));
  if (scene !== "pipe") parts.push(houses(horizon + 30, w, scene.length));
  // The ground, then the street.
  parts.push(`<rect y="${horizon + 20}" width="${w}" height="${h - horizon}" fill="url(#earth)"/>`);
  if (scene !== "pipe")
    parts.push(
      `<path d="M${w * 0.32} ${horizon + 30} L${w * 0.62} ${horizon + 30} L${w * 1.25} ${h} L${-w * 0.2} ${h} Z" fill="url(#asphalt)"/>`,
    );
  if (scene === "paving" || scene === "street")
    parts.push(
      `<path d="M${w * 0.47} ${horizon + 34} L${w * 0.48} ${horizon + 34} L${w * 0.53} ${h} L${w * 0.49} ${h} Z" fill="#e8c547" stroke-dasharray="40 30"/>`,
      `<path d="M${w * 0.47} ${horizon + 34} L${w * 0.47} ${horizon + 34} L${w * 0.08} ${h} L${w * 0.0} ${h} Z" fill="#f2f2f2" opacity="0.85"/>`,
    );
  if (scene === "trench" || scene === "loading" || scene === "manhole" || scene === "compaction") {
    // A trench along the street, open or backfilled.
    const fill = scene === "compaction" ? "#7d6a55" : "url(#pit)";
    parts.push(
      `<path d="M${w * 0.44} ${horizon + 30} L${w * 0.5} ${horizon + 30} L${w * 0.78} ${h} L${w * 0.2} ${h} Z" fill="${fill}"/>`,
      `<path d="M${w * 0.44} ${horizon + 30} L${w * 0.2} ${h} L${w * 0.14} ${h} L${w * 0.42} ${horizon + 30} Z" fill="#9b7a58"/>`,
    );
    if (scene !== "compaction")
      parts.push(
        `<path d="M${w * 0.468} ${horizon + 34} L${w * 0.474} ${horizon + 34} L${w * 0.53} ${h} L${w * 0.46} ${h} Z" fill="url(#pvcLong)" opacity="0.9"/>`,
      );
    if (scene === "compaction")
      parts.push(
        `<path d="M${w * 0.44} ${horizon + 30} L${w * 0.5} ${horizon + 30} L${w * 0.78} ${h} L${w * 0.2} ${h} Z" fill="#fff" filter="url(#gravel)" opacity="0.5"/>`,
      );
  }
  if (scene === "pipe") {
    // Close to the bottom of the trench: its walls, the stone bed, the pipe.
    parts.push(
      `<rect y="0" width="${w}" height="${h}" fill="url(#pit)"/>`,
      `<path d="M0 0 L${w * 0.28} 0 L${w * 0.18} ${h * 0.62} L0 ${h * 0.7} Z" fill="#6e5440"/>`,
      `<path d="M${w} 0 L${w * 0.74} 0 L${w * 0.84} ${h * 0.6} L${w} ${h * 0.66} Z" fill="#6e5440"/>`,
      `<path d="M${w * 0.18} ${h * 0.62} L${w * 0.84} ${h * 0.6} L${w} ${h * 0.66} L${w} ${h} L0 ${h} L0 ${h * 0.7} Z" fill="#8f8a83"/>`,
      `<path d="M${w * 0.18} ${h * 0.62} L${w * 0.84} ${h * 0.6} L${w} ${h * 0.66} L${w} ${h} L0 ${h} L0 ${h * 0.7} Z" fill="#fff" filter="url(#gravel)" opacity="0.7"/>`,
      `<g transform="rotate(-8 ${w / 2} ${h * 0.7})">
        <rect x="${-w * 0.1}" y="${h * 0.6}" width="${w * 1.2}" height="${h * 0.16}" fill="url(#pvc)"/>
        <rect x="${w * 0.42}" y="${h * 0.59}" width="${w * 0.07}" height="${h * 0.18}" rx="8" fill="url(#pvc)"/>
        <rect x="${-w * 0.1}" y="${h * 0.63}" width="${w * 1.2}" height="6" fill="#fff" opacity="0.35"/>
        <text x="${w * 0.15}" y="${h * 0.7}" font-family="sans-serif" font-weight="700" font-size="${h * 0.03}" fill="#fff" opacity="0.75">PVC DR18 200 mm</text>
      </g>`,
      `<rect x="${w * 0.03}" y="${h * 0.05}" width="${w * 0.94}" height="${h * 0.04}" fill="#6b5039" opacity="0.4"/>`,
    );
  }
  if (scene === "manhole")
    parts.push(
      `<g transform="translate(${w * 0.47} ${h * 0.86})">
        <rect x="-150" y="-330" width="300" height="330" fill="url(#concrete)"/>
        <rect x="-150" y="-330" width="300" height="330" fill="#fff" filter="url(#grain)" opacity="0.5"/>
        <path d="M-150 -220 L150 -220 M-150 -110 L150 -110" stroke="#6d7175" stroke-width="5"/>
        <ellipse cx="0" cy="-330" rx="150" ry="40" fill="#b9bcbf"/>
        <ellipse cx="0" cy="-330" rx="95" ry="25" fill="#1e1f21"/>
        <ellipse cx="0" cy="0" rx="150" ry="40" fill="#000" opacity="0.25" filter="url(#soft)"/>
      </g>`,
    );
  if (scene === "trench") {
    parts.push(excavator(w * 0.56, h * 0.82, (w / 1600) * 1.05));
    parts.push(cone(w * 0.12, h * 0.9, w / 1600), cone(w * 0.24, h * 0.75, (w / 1600) * 0.7));
  }
  if (scene === "loading") {
    parts.push(truck(w * 0.02, h * 0.8, (w / 1600) * 0.95));
    parts.push(excavator(w * 1.0, h * 0.9, (w / 1600) * 0.95, true));
  }
  if (scene === "compaction") {
    parts.push(roller(w * 0.3, h * 0.88, (w / 1600) * 1.15));
    parts.push(cone(w * 0.88, h * 0.92, w / 1600), cone(w * 0.75, h * 0.72, (w / 1600) * 0.65));
  }
  if (scene === "street") {
    parts.push(truck(w * 0.5, h * 0.72, (w / 1600) * 0.55));
    for (const [fx, fy, fs] of [
      [0.12, 0.95, 1.1],
      [0.27, 0.78, 0.8],
      [0.36, 0.67, 0.6],
      [0.42, 0.6, 0.45],
    ])
      parts.push(cone(w * fx, h * fy, (w / 1600) * fs));
    parts.push(
      `<g transform="translate(${w * 0.8} ${h * 0.94})">
        <rect x="-8" y="-420" width="16" height="420" fill="#8a8f95"/>
        <path d="M0 -560 L120 -440 L0 -320 L-120 -440 Z" fill="#f28c18" stroke="#1d1e20" stroke-width="10"/>
        <path d="M-40 -400 L40 -400 L0 -480 Z" fill="#1d1e20"/>
      </g>`,
    );
  }
  if (scene === "paving") {
    parts.push(
      `<path d="M${w * 0.32} ${horizon + 30} L${w * 0.62} ${horizon + 30} L${w * 1.25} ${h} L${-w * 0.2} ${h} Z" fill="#26282b"/>`,
      `<path d="M${w * 0.32} ${horizon + 30} L${w * 0.62} ${horizon + 30} L${w * 1.25} ${h} L${-w * 0.2} ${h} Z" fill="#fff" filter="url(#grain)" opacity="0.35"/>`,
      `<path d="M${w * 0.62} ${horizon + 30} L${w * 0.66} ${horizon + 30} L${w * 1.4} ${h} L${w * 1.25} ${h} Z" fill="#b8b3aa"/>`,
      `<path d="M${w * 0.28} ${horizon + 30} L${w * 0.32} ${horizon + 30} L${-w * 0.2} ${h} L${-w * 0.4} ${h} Z" fill="#b8b3aa"/>`,
      `<g transform="translate(${w * 0.5} ${h * 0.88})">
        <ellipse cx="0" cy="0" rx="${w * 0.08}" ry="${h * 0.025}" fill="#55595e"/>
        <ellipse cx="0" cy="0" rx="${w * 0.065}" ry="${h * 0.019}" fill="#3a3d41" stroke="#6d7175" stroke-width="6"/>
      </g>`,
    );
    parts.push(roller(w * 0.46, h * 0.7, (w / 1600) * 0.9));
    parts.push(
      cone(w * 0.12, h * 0.93, (w / 1600) * 1.2),
      cone(w * 0.3, h * 0.66, (w / 1600) * 0.6),
    );
  }
  // The light of a real camera: grain over everything, darker corners.
  parts.push(
    `<rect width="${w}" height="${h}" fill="#fff" filter="url(#grain)" opacity="0.25"/>`,
    `<rect width="${w}" height="${h}" fill="url(#vignette)"/>`,
  );
  const tag = Math.round(Math.min(w, h) * 0.045);
  parts.push(
    `<g transform="translate(${w / 2} ${h * 0.12})">
      <rect x="${-tag * 3.2}" y="${-tag * 0.95}" width="${tag * 6.4}" height="${tag * 1.5}" rx="${tag * 0.75}" fill="#000" opacity="0.45"/>
      <text x="0" y="${tag * 0.25}" font-family="sans-serif" font-weight="700" font-size="${tag}" letter-spacing="${tag * 0.12}" fill="#fff" text-anchor="middle">EXEMPLE</text>
    </g>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("\n")}</svg>`;
}

// "--preview <folder>": only draws the photos there, to look at them.
if (process.argv[2] === "--preview") {
  const folder = process.argv[3] ?? "/tmp/store-sample";
  mkdirSync(folder, { recursive: true });
  const scenes: Scene[] = [
    "trench",
    "pipe",
    "manhole",
    "compaction",
    "street",
    "loading",
    "paving",
  ];
  for (const scene of scenes)
    await sharp(
      Buffer.from(
        drawScene(scene, scene === "paving" ? 1200 : 1600, scene === "paving" ? 1600 : 1200),
      ),
    )
      .jpeg({ quality: 84 })
      .toFile(`${folder}/${scene}.jpg`);
  console.log(`Photos dessinées dans ${folder}`);
  process.exit(0);
}

// --- The API, as the foreman ----------------------------------------------------

const seed = JSON.parse(readFileSync(`${SEED}/seed.json`, "utf8"));
const projectId: string = seed.projectId;
const session = JSON.parse(readFileSync(`${SEED}/foreman.json`, "utf8")).cookies[0].value;

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie: `ead_session=${session}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as any;
}

/** Announced, sent, confirmed: the way a phone sends a file. Returns the upload's id. */
async function upload(kind: "photo" | "document", filename: string, type: string, bytes: Buffer) {
  const ticket = await call("POST", "/api/uploads", {
    projectId,
    kind,
    filename,
    contentType: type,
    size: bytes.length,
  });
  const sent = await fetch(new URL(ticket.target.url, BASE), {
    method: "PUT",
    headers: ticket.target.headers,
    body: new Uint8Array(bytes),
  });
  if (!sent.ok) throw new Error(`Envoi refusé\u00a0: ${sent.status}`);
  await call("POST", `/api/uploads/${ticket.uploadId}/complete`);
  return ticket.uploadId as string;
}

const project = await call("GET", `/api/projects/${projectId}`);
if (project.photoCount > 4) {
  console.error(
    "Le contenu d'exemple est déjà là. Repartez de zéro\u00a0: npm run db:fresh, puis le seed.",
  );
  process.exit(1);
}

type SamplePhoto = {
  scene: Scene;
  day: string;
  hour: number;
  minute: number;
  caption: string | null;
  portrait?: boolean;
};

async function addPhoto(sample: SamplePhoto, index: number): Promise<string> {
  const [w, h] = sample.portrait ? [1200, 1600] : [1600, 1200];
  const jpeg = await sharp(Buffer.from(drawScene(sample.scene, w, h)))
    .jpeg({ quality: 84 })
    .toBuffer();
  const uploadId = await upload("photo", `IMG_${4810 + index}.jpg`, "image/jpeg", jpeg);
  const added = await call("POST", `/api/projects/${projectId}/photos`, {
    uploadId,
    takenAt: at(sample.day, sample.hour, sample.minute),
    ...(sample.caption ? { caption: sample.caption } : {}),
  });
  return added.id;
}

const today = siteDay(0);
const yesterday = siteDay(1);
const earlier = earlierWorkdays(3);
// Today's photos are taken before now, whatever the hour the script runs.
const hourNow = Number(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date()),
);
const todayHours = [Math.max(0, Math.min(10, hourNow - 2)), Math.max(0, Math.min(11, hourNow - 1))];

const yesterdayPhotos: SamplePhoto[] = [
  {
    scene: "trench",
    day: yesterday,
    hour: 8,
    minute: 12,
    caption: "Excavation de la tranchée au chaînage 0+240 (exemple)",
  },
  {
    scene: "pipe",
    day: yesterday,
    hour: 10,
    minute: 4,
    caption: "Conduite d'aqueduc 200 mm sur son lit de pierre (exemple)",
  },
  {
    scene: "manhole",
    day: yesterday,
    hour: 13,
    minute: 37,
    caption: "Regard R-5 en place (exemple)",
  },
  {
    scene: "loading",
    day: yesterday,
    hour: 15,
    minute: 20,
    caption: "Déblais chargés pour le site de dépôt (exemple)",
  },
];
const otherPhotos: SamplePhoto[] = [
  {
    scene: "street",
    day: today,
    hour: todayHours[0],
    minute: 5,
    caption: "Signalisation en place, rue Principale (exemple)",
  },
  {
    scene: "compaction",
    day: today,
    hour: todayHours[1],
    minute: 15,
    caption: "Compaction du remblai par couches de 300 mm (exemple)",
  },
  {
    scene: "paving",
    day: earlier[0],
    hour: 14,
    minute: 50,
    caption: "Couche de base pavée entre R-2 et R-3 (exemple)",
    portrait: true,
  },
  {
    scene: "loading",
    day: earlier[1],
    hour: 9,
    minute: 25,
    caption: "Chargement des déblais (exemple)",
  },
  {
    scene: "trench",
    day: earlier[2],
    hour: 11,
    minute: 2,
    caption: "Début de l'excavation au chaînage 0+120 (exemple)",
  },
];

const yesterdayIds: string[] = [];
for (const [index, sample] of yesterdayPhotos.entries())
  yesterdayIds.push(await addPhoto(sample, index));
for (const [index, sample] of otherPhotos.entries())
  await addPhoto(sample, yesterdayPhotos.length + index);

// --- Reports ----------------------------------------------------------------------

// Yesterday's report (the seed's, without photos) gets the day's photos.
const reports = await call("GET", `/api/projects/${projectId}/reports`);
const yesterdays = reports.find((report: any) => report.day === yesterday);
if (yesterdays) {
  const full = await call("GET", `/api/reports/${yesterdays.id}`);
  await call("PATCH", `/api/reports/${yesterdays.id}`, {
    baseUpdatedAt: full.updatedAt,
    photoIds: [...full.photoIds, ...yesterdayIds],
  });
}

const crew = [
  { name: "Julie Cyr", hours: 10, userId: null },
  { name: "Marc Lévesque", hours: 10, userId: null },
  { name: "Simon Arsenault", hours: 9.5, userId: null },
];
const earlierReports = [
  {
    weather: { condition: "soleil", temperatureC: 4, note: "" },
    equipment: "Finisseuse, rouleau compacteur, deux camions 10 roues",
    workDone: "Pavage de la couche de base entre les regards R-2 et R-3, sur 85 m.",
    notes: "Circulation en alternance toute la journée.",
  },
  {
    weather: { condition: "nuageux", temperatureC: 2, note: "" },
    equipment: "Pelle 320, camion 10 roues",
    workDone: "Excavation et chargement des déblais entre R-3 et R-4. 14 voyages.",
    notes: "",
  },
  {
    weather: { condition: "vent", temperatureC: 5, note: "Vent fort en matinée" },
    equipment: "Pelle 320, rouleau compacteur",
    workDone: "Début de l'excavation au chaînage 0+120. Installation de la signalisation.",
    notes: "Rencontre de chantier avec l'ingénieur de la Ville à 7 h.",
  },
];
for (const [index, content] of earlierReports.entries())
  await call("POST", `/api/projects/${projectId}/reports`, {
    day: earlier[index],
    crew,
    ...content,
  });

// --- Documents --------------------------------------------------------------------

const { PDFDocument, StandardFonts } = await import("pdf-lib");
async function samplePdf(title: string, pages: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let page = 0; page < pages; page++) {
    const sheet = pdf.addPage([612, 792]);
    sheet.drawText("EXEMPLE - DOCUMENT FICTIF", { x: 72, y: 700, size: 20, font });
    sheet.drawText(title, { x: 72, y: 660, size: 14, font });
    // Some weight, so the list shows believable sizes.
    for (let line = 0; line < 30; line++)
      sheet.drawText("Texte d'exemple sans valeur. ".repeat(3), {
        x: 72,
        y: 620 - line * 16,
        size: 9,
        font,
      });
  }
  return Buffer.from(await pdf.save());
}

const documents = [
  {
    title: "Devis technique — section 02 (exemple)",
    file: "Devis section 02.pdf",
    category: "contrat",
    pages: 24,
  },
  {
    title: "Bordereau des quantités (exemple)",
    file: "Bordereau.pdf",
    category: "contrat",
    pages: 6,
  },
  {
    title: "Permis d'intervention de la Ville (exemple)",
    file: "Permis intervention.pdf",
    category: "permis",
    pages: 2,
  },
  {
    title: "Plan de signalisation (exemple)",
    file: "Plan de signalisation.pdf",
    category: "permis",
    pages: 3,
  },
  {
    title: "Fiche technique — conduite PVC DR18 (exemple)",
    file: "Fiche conduite PVC.pdf",
    category: "fiches",
    pages: 4,
  },
  {
    title: "Échéancier des travaux (exemple)",
    file: "Echeancier.csv",
    category: "echeancier",
    pages: 0,
  },
  {
    title: "Essais de compaction, semaine 46 (exemple)",
    file: "Essais compaction S46.pdf",
    category: "essais",
    pages: 5,
  },
];
for (const doc of documents) {
  const csv = doc.file.endsWith(".csv");
  const bytes = csv
    ? Buffer.from(
        "Tâche;Début;Fin\nEXEMPLE - DOCUMENT FICTIF;;\nExcavation R-2 à R-5;2026-11-02;2026-11-20\nPavage couche de base;2026-11-16;2026-11-27\n",
      )
    : await samplePdf(doc.title, doc.pages);
  const uploadId = await upload("document", doc.file, csv ? "text/csv" : "application/pdf", bytes);
  await call("POST", `/api/projects/${projectId}/documents`, {
    uploadId,
    title: doc.title,
    category: doc.category,
  });
}

console.log(
  `Ajouté\u00a0: ${yesterdayPhotos.length + otherPhotos.length} photos, ${earlierReports.length} rapports, ${documents.length} documents (exemples).`,
);
