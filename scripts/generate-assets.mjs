// Generates locally-hosted illustrated product images (SVG). These are illustrations, not photography:
// replace them with real product photography via Admin → Products → Images.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("../prisma/catalog.json", import.meta.url), "utf8"));
mkdirSync(new URL("../public/products/", import.meta.url), { recursive: true });

const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return "#" + [c(n >> 16), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
};
const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

const SHAPES = {
  tee: { body: "M200 120 L120 160 L60 300 L130 330 L170 270 L170 640 L430 640 L430 270 L470 330 L540 300 L480 160 L400 120 Q300 178 200 120 Z", extra: (s) => `<path d="M200 120 Q300 178 400 120" fill="none" stroke="${s}" stroke-width="10" stroke-linecap="round"/>` },
  sweat: { body: "M200 120 L110 170 L70 540 L145 552 L175 300 L175 640 L425 640 L425 300 L455 552 L530 540 L490 170 L400 120 Q300 175 200 120 Z", extra: (s) => `<path d="M200 120 Q300 175 400 120" fill="none" stroke="${s}" stroke-width="14" stroke-linecap="round"/><path d="M175 618 H425" stroke="${s}" stroke-width="14"/>` },
  hoodie: { body: "M200 125 L110 175 L70 540 L145 552 L175 305 L175 640 L425 640 L425 305 L455 552 L530 540 L490 175 L400 125 Q300 190 200 125 Z", extra: (s) => `<path d="M205 128 Q300 20 395 128 Q300 200 205 128 Z" fill="none" stroke="${s}" stroke-width="10"/><path d="M300 190 V640" stroke="${s}" stroke-width="8"/><path d="M215 480 H385 L405 580 H195 Z" fill="none" stroke="${s}" stroke-width="8"/><path d="M270 190 V260 M330 190 V260" stroke="${s}" stroke-width="6" stroke-linecap="round"/>` },
  shirt: { body: "M205 118 L115 165 L75 560 L148 572 L178 300 L178 640 L422 640 L422 300 L452 572 L525 560 L485 165 L395 118 L300 190 Z", extra: (s) => `<path d="M205 118 L300 190 L395 118 L350 100 L300 140 L250 100 Z" fill="none" stroke="${s}" stroke-width="9" stroke-linejoin="round"/><path d="M300 190 V640" stroke="${s}" stroke-width="7"/>${[250, 330, 410, 490, 570].map((y) => `<circle cx="300" cy="${y}" r="7" fill="${s}"/>`).join("")}<path d="M215 300 H265 V350 H215 Z M335 300 H385 V350 H335 Z" fill="none" stroke="${s}" stroke-width="6"/>` },
  trouser: { body: "M190 100 H410 L445 655 H332 L300 270 L268 655 H155 Z", extra: (s) => `<path d="M190 130 H410 M300 130 V270" stroke="${s}" stroke-width="8"/><path d="M215 130 Q230 190 215 215 M385 130 Q370 190 385 215" fill="none" stroke="${s}" stroke-width="6"/>` },
  jacket: { body: "M200 115 L108 168 L68 560 L145 574 L176 300 L176 640 L424 640 L424 300 L455 574 L532 560 L492 168 L400 115 Q300 165 200 115 Z", extra: (s) => `<path d="M200 115 L255 175 L300 150 L345 175 L400 115" fill="none" stroke="${s}" stroke-width="12" stroke-linejoin="round"/><path d="M300 150 V640" stroke="${s}" stroke-width="8"/><path d="M200 380 H270 V450 H200 Z M330 380 H400 V450 H330 Z M200 500 H270 V570 H200 Z M330 500 H400 V570 H330 Z" fill="none" stroke="${s}" stroke-width="7"/>` },
};

for (const p of catalog.products) {
  const shape = SHAPES[p.shape];
  for (const c of p.colors) {
    const dark = luminance(c.hex) < 0.45;
    const stroke = shade(c.hex, dark ? 28 : -34);
    const stitch = dark ? "#E8B931" : "#1E2B5C"; // stitched-thread motif
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 720" role="img" aria-label="${p.name} in ${c.name}">
<rect width="600" height="720" fill="#E9E9E4"/>
<rect x="24" y="24" width="552" height="672" fill="none" stroke="#1E2B5C" stroke-opacity=".35" stroke-width="2" stroke-dasharray="10 8"/>
<ellipse cx="300" cy="672" rx="190" ry="14" fill="#1E2B5C" fill-opacity=".10"/>
<path d="${shape.body}" fill="${c.hex}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/>
<path d="${shape.body}" fill="none" stroke="${stitch}" stroke-opacity=".75" stroke-width="2.5" stroke-dasharray="7 6" transform="translate(300 380) scale(.955) translate(-300 -380)"/>
<g>${shape.extra(stroke)}</g>
</svg>`;
    writeFileSync(new URL(`../public/products/${p.slug}-${c.name.toLowerCase()}.svg`, import.meta.url), svg);
  }
}
console.log("Generated product illustrations");
