// Gamut check of the contract steps: each oklch(L C H) before and after clipping to sRGB, for every hue and theme.
const steps = {
  dark: { text: [0.68, 0.13], hover: [0.78, 0.1], fill: [0.68, 0.13], wash: [0.21, 0.055], dark: [0.45, 0.13] },
  daylight: { text: [0.47, 0.12], hover: [0.41, 0.1], fill: [0.68, 0.13], wash: [0.97, 0.025], dark: [0.45, 0.13] },
};
const hues = { blue: 232, cyan: 200, pink: 325, lime: 131, nova: 355, solar: 50, aurora: 175, nebula: 275 };
function oklchToLinear(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const out = { perStep: [], outOfGamut: 0, total: 0, byHue: {} };
for (const [theme, table] of Object.entries(steps)) {
  for (const [hname, H] of Object.entries(hues)) {
    for (const [step, [L, C]] of Object.entries(table)) {
      const lin = oklchToLinear(L, C, H);
      const outside = lin.some((c) => c < -1e-6 || c > 1 + 1e-6);
      out.total += 1;
      if (outside) {
        out.outOfGamut += 1;
        (out.byHue[hname] ??= []).push(`${theme}:${step}`);
      }
    }
  }
}
console.log(JSON.stringify({ total: out.total, outOfGamut: out.outOfGamut, byHue: out.byHue }, null, 1));
