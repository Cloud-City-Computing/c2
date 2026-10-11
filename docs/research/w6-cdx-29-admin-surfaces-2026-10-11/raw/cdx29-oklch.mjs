const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export function oklch(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const C = Math.hypot(A, Bb);
  let H = Math.atan2(Bb, A) * 180 / Math.PI; if (H < 0) H += 360;
  return { L: +L.toFixed(3), C: +C.toFixed(3), H: +H.toFixed(1) };
}
for (const c of [[44,167,219],[76,175,80],[229,69,69],[148,163,184],[136,136,136],[96,165,250],[251,191,36],[167,139,250]]) console.log(c.join(','), JSON.stringify(oklch(...c)));
