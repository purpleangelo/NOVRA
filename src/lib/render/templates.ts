import type { LayoutId } from "./layouts";

/** Everything a layout needs. Text is the exact approved copy; the image model never draws text or logos. */
export type LayoutInput = {
  layout: LayoutId;
  width: number;
  height: number;
  headline: string;
  subtext?: string;
  textPlacement: "top" | "center" | "bottom";
  /** For list_tips: points; for carousel inner slides: heading/body */
  points?: string[];
  slide?: { index: number; total: number; heading: string; body: string };
  backgroundUrl?: string | null;
  logoUrl?: string | null;
  brandName: string;
  colours: { primary: string; secondary: string; accent: string };
  fonts: { heading: string; body: string; faces: { family: string; url: string }[] };
  /** Small "TEST" ribbon on synthetic brands */
  testLabel?: boolean;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const textOn = (hex: string) => (luminance(hex) > 0.45 ? "#111111" : "#FFFFFF");
const alpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

const GOOGLE_SAFE = /^[A-Za-z0-9 ]{2,40}$/;
function fontLinks(input: LayoutInput) {
  const uploaded = new Set(input.fonts.faces.map((f) => f.family.toLowerCase()));
  const google = [...new Set([input.fonts.heading, input.fonts.body])].filter((f) => f && GOOGLE_SAFE.test(f) && !uploaded.has(f.toLowerCase()));
  const faces = input.fonts.faces.map((f) => `@font-face{font-family:"${esc(f.family)}";src:url(${f.url});font-display:block}`).join("");
  const link = google.length ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${google.map((g) => `family=${encodeURIComponent(g).replace(/%20/g, "+")}:wght@400;600;700;800`).join("&")}&display=block">` : "";
  return { link, faces };
}

/** Full HTML page for one image (or one carousel slide). Rendered to PNG by Playwright at width×height. */
export function layoutHtml(input: LayoutInput) {
  const { width: W, height: H, colours: c } = input;
  const s = Math.min(W, H) / 1080; // scale unit
  const onPrimary = textOn(c.primary);
  const { link, faces } = fontLinks(input);
  const bg = input.backgroundUrl ? `url(${input.backgroundUrl})` : "none";
  const place = input.textPlacement === "top" ? "flex-start" : input.textPlacement === "center" ? "center" : "flex-end";
  const grad =
    input.textPlacement === "top"
      ? `linear-gradient(180deg, ${alpha(c.primary, 0.85)} 0%, ${alpha(c.primary, 0)} 60%)`
      : input.textPlacement === "center"
        ? `linear-gradient(180deg, ${alpha(c.primary, 0.25)} 0%, ${alpha(c.primary, 0.55)} 50%, ${alpha(c.primary, 0.25)} 100%)`
        : `linear-gradient(0deg, ${alpha(c.primary, 0.9)} 0%, ${alpha(c.primary, 0)} 62%)`;
  const logo = input.logoUrl ? `<img class="logo" src="${input.logoUrl}" alt="">` : `<div class="logo-text">${esc(input.brandName)}</div>`;
  const test = input.testLabel ? `<div class="test">TEST</div>` : "";
  const body = renderBody(input, onPrimary);

  return `<!doctype html><html><head><meta charset="utf-8">${link}<style>
${faces}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{font-family:"${esc(input.fonts.body)}",Inter,Arial,sans-serif;color:${onPrimary};background:${input.backgroundUrl ? c.primary : `radial-gradient(circle at 85% 15%, ${alpha(c.accent, 0.28)} 0%, ${alpha(c.accent, 0)} 45%), radial-gradient(circle at 10% 95%, ${alpha(c.secondary, 0.18)} 0%, ${alpha(c.secondary, 0)} 40%), ${c.primary}`}}
.bg{position:absolute;inset:0;background-image:${bg};background-size:cover;background-position:center}
.shade{position:absolute;inset:0;background:${input.backgroundUrl ? grad : "none"}}
.frame{position:absolute;inset:${64 * s}px;display:flex;flex-direction:column;justify-content:${place};gap:${24 * s}px}
h1,h2,.q{font-family:"${esc(input.fonts.heading)}",Georgia,serif;font-weight:800;line-height:1.05;letter-spacing:-0.01em}
h1{font-size:${110 * s}px}
h2{font-size:${72 * s}px}
p{font-size:${40 * s}px;line-height:1.3;opacity:.95}
.band{background:${c.accent};color:${textOn(c.accent)};padding:${18 * s}px ${28 * s}px;display:inline-block;align-self:flex-start;font-weight:700;font-size:${34 * s}px;border-radius:${8 * s}px}
.logo{position:absolute;right:${48 * s}px;top:${44 * s}px;max-height:${90 * s}px;max-width:${260 * s}px;object-fit:contain}
.logo-text{position:absolute;right:${48 * s}px;top:${44 * s}px;font-weight:700;font-size:${30 * s}px;opacity:.9}
.test{position:absolute;left:${24 * s}px;top:${24 * s}px;background:#FFD400;color:#111;font:700 ${22 * s}px Arial;padding:${6 * s}px ${12 * s}px;border-radius:${6 * s}px}
.panel{background:${alpha(c.primary, 0.88)};padding:${44 * s}px;border-radius:${24 * s}px}
.q{font-size:${92 * s}px;font-style:italic}
.qm{font-size:${200 * s}px;line-height:.6;color:${c.accent};font-family:Georgia,serif}
ul{list-style:none;display:flex;flex-direction:column;gap:${20 * s}px}
li{font-size:${44 * s}px;line-height:1.2;display:flex;gap:${20 * s}px;align-items:flex-start}
li b{background:${c.accent};color:${textOn(c.accent)};min-width:${60 * s}px;height:${60 * s}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${32 * s}px}
.split{position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr}
.split div{position:relative;display:flex;align-items:flex-start;justify-content:center;padding-top:${150 * s}px}
.split .before{filter:grayscale(1) brightness(.85)}
.tag{background:${c.secondary};color:${textOn(c.secondary)};font-weight:800;font-size:${36 * s}px;padding:${12 * s}px ${26 * s}px;border-radius:${40 * s}px;position:relative;z-index:2}
.divider{position:absolute;left:50%;top:0;bottom:0;width:${6 * s}px;background:${c.accent};transform:translateX(-50%)}
.showcase{background:${c.secondary};color:${textOn(c.secondary)};padding:${36 * s}px ${44 * s}px;border-radius:${20 * s}px;border-left:${14 * s}px solid ${c.accent}}
.dots{display:flex;gap:${10 * s}px}
.dots span{width:${14 * s}px;height:${14 * s}px;border-radius:50%;background:${onPrimary};opacity:.35}
.dots span.on{opacity:1;background:${c.accent}}
.num{font-size:${150 * s}px;font-weight:800;color:${c.accent};line-height:1;font-family:"${esc(input.fonts.heading)}",Georgia,serif}
.fit{overflow:hidden}
</style></head><body>${body}${logo}${test}
<script>
// shrink text until each .fit block fits its box
document.fonts.ready.then(()=>{for(const el of document.querySelectorAll('[data-fit]')){let size=parseFloat(getComputedStyle(el).fontSize);const box=el.closest('.frame');let guard=60;while(guard-->0&&(box.scrollHeight>box.clientHeight+1||el.scrollWidth>el.clientWidth+1)&&size>14){size*=0.93;el.style.fontSize=size+'px'}}document.body.dataset.ready='1'});
</script></body></html>`;
}

function renderBody(i: LayoutInput, onPrimary: string) {
  const sub = i.subtext ? `<p data-fit>${esc(i.subtext)}</p>` : "";
  const bgLayers = `<div class="bg"></div><div class="shade"></div>`;
  switch (i.layout) {
    case "quote":
      return `${bgLayers}<div class="frame" style="justify-content:center"><div class="panel"><div class="qm">“</div><div class="q" data-fit>${esc(i.headline)}</div>${sub}</div></div>`;
    case "product_showcase":
      return `${bgLayers}<div class="frame"><div class="showcase"><h2 data-fit>${esc(i.headline)}</h2>${i.subtext ? `<p data-fit>${esc(i.subtext)}</p>` : ""}</div></div>`;
    case "list_tips": {
      const pts = (i.points?.length ? i.points : [i.subtext ?? ""]).filter(Boolean).slice(0, 5);
      return `${bgLayers}<div class="frame" style="justify-content:center"><div class="panel"><h2 data-fit>${esc(i.headline)}</h2><ul style="margin-top:${24}px">${pts.map((p, n) => `<li><b>${n + 1}</b><span data-fit>${esc(p)}</span></li>`).join("")}</ul></div></div>`;
    }
    case "before_after":
      return `<div class="split"><div class="before" style="background-image:${i.backgroundUrl ? `url(${i.backgroundUrl})` : "none"};background-size:200% 100%;background-position:left"><span class="tag">BEFORE</span></div><div style="background-image:${i.backgroundUrl ? `url(${i.backgroundUrl})` : "none"};background-size:200% 100%;background-position:right"><span class="tag">AFTER</span></div></div><div class="divider"></div><div class="shade" style="background:linear-gradient(0deg, ${i.colours.primary}ee 0%, ${i.colours.primary}00 45%)"></div><div class="frame" style="justify-content:flex-end"><h2 data-fit>${esc(i.headline)}</h2>${sub}</div>`;
    case "carousel": {
      const sl = i.slide!;
      const dots = `<div class="dots">${Array.from({ length: sl.total }, (_, n) => `<span class="${n === sl.index ? "on" : ""}"></span>`).join("")}</div>`;
      if (sl.index === 0)
        return `${bgLayers}<div class="frame"><span class="band">${sl.total - 1} slides →</span><h1 data-fit>${esc(sl.heading || i.headline)}</h1>${sl.body ? `<p data-fit>${esc(sl.body)}</p>` : sub}${dots}</div>`;
      return `<div class="frame" style="justify-content:center;color:${onPrimary}"><div class="num">${String(sl.index).padStart(2, "0")}</div><h2 data-fit>${esc(sl.heading)}</h2><p data-fit>${esc(sl.body)}</p>${dots}</div>`;
    }
    case "bold_headline":
    default:
      return `${bgLayers}<div class="frame"><h1 data-fit>${esc(i.headline)}</h1>${sub}<span class="band">${esc(i.brandName)}</span></div>`;
  }
}
