// GeoJSON (EPSG:4326) to compact SVG paths, at build time. No dependencies.
// Projection: equirectangular with cos(52.15°) x-scaling, which is close enough for the Netherlands.

const LAT0 = 52.15, COS = Math.cos(LAT0 * Math.PI / 180);

export function makeProjection(bbox, height = 800, pad = 6) {
  const [minX, minY, maxX, maxY] = bbox;
  const k = (height - 2 * pad) / (maxY - minY);
  const width = Math.ceil((maxX - minX) * COS * k + 2 * pad);
  const p = ([lon, lat]) => [pad + (lon - minX) * COS * k, pad + (maxY - lat) * k];
  return { p, width, height, k };
}

function sqSegDist(p, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) { const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } }
  dx = p[0] - x; dy = p[1] - y; return dx * dx + dy * dy;
}

/** Douglas-Peucker simplification (iterative). */
export function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]], t2 = tol * tol;
  while (stack.length) {
    const [s, e] = stack.pop(); let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const d = sqSegDist(pts[i], pts[s], pts[e]); if (d > max) { max = d; idx = i; } }
    if (max > t2) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export const ringArea = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); };

/** Polygons of a Polygon/MultiPolygon geometry as arrays of rings. */
export const polygons = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];

/** SVG path data for a geometry, projected and simplified. Rings below minArea (px²) are dropped. */
export function pathData(geometry, proj, { tol = 0.35, minArea = 0.6, offset = [0, 0] } = {}) {
  let d = '';
  for (const poly of polygons(geometry)) for (const ring of poly) {
    const pts = simplify(ring.map(proj.p), tol);
    if (pts.length < 4 || ringArea(pts) < minArea) continue;
    let [px, py] = [Math.round((pts[0][0] - offset[0]) * 10), Math.round((pts[0][1] - offset[1]) * 10)];
    d += `M${px / 10} ${py / 10}l`;
    const parts = [];
    for (let i = 1; i < pts.length - 1; i++) {
      const x = Math.round((pts[i][0] - offset[0]) * 10), y = Math.round((pts[i][1] - offset[1]) * 10);
      if (x === px && y === py) continue;
      parts.push(`${(x - px) / 10} ${(y - py) / 10}`); px = x; py = y;
    }
    d += parts.join(' ').replace(/ -/g, '-') + 'z';
  }
  return d;
}

/** Area-weighted centroid of the largest polygon ring (lon/lat). */
export function centroid(geometry) {
  let best = null, bestA = -1;
  for (const poly of polygons(geometry)) { const a = ringArea(poly[0]); if (a > bestA) { bestA = a; best = poly[0]; } }
  let x = 0, y = 0, A = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const f = best[j][0] * best[i][1] - best[i][0] * best[j][1]; A += f; x += (best[j][0] + best[i][0]) * f; y += (best[j][1] + best[i][1]) * f;
  }
  return A ? [x / (3 * A), y / (3 * A)] : best[0];
}

function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const inGeometry = (pt, g) => polygons(g).some(poly => inRing(pt, poly[0]) && !poly.slice(1).some(h => inRing(pt, h)));

/** Distance in km between two lon/lat points (equirectangular approximation). */
export const distanceKm = (a, b) => Math.hypot((a[0] - b[0]) * COS * 111.32, (a[1] - b[1]) * 110.57);

/** A point inside the largest ring: the midpoint of the widest span on the horizontal line through the centroid. */
export function interiorPoint(geometry) {
  const ring = polygons(geometry).sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0][0];
  const y = centroid(geometry)[1], xs = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  return best ? [(best[0] + best[1]) / 2, y] : ring[0];
}

/** Province of each municipality: the province that contains an interior point of the municipality. */
export function assignParents(children, parents) {
  const out = {};
  for (const c of children) { const pt = interiorPoint(c.geometry); out[c.properties.code] = parents.find(pv => inGeometry(pt, pv.geometry))?.properties.code ?? null; }
  return out;
}

/** Projected bounding box of a geometry. */
export function projBBox(geometry, proj) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polygons(geometry)) for (const [lon, lat] of poly[0]) { const [x, y] = proj.p([lon, lat]); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

/** Neighbours: features that share at least two boundary vertices (the CBS generalised boundaries share vertices). */
export function adjacency(features) {
  const at = new Map();
  for (const f of features) for (const poly of polygons(f.geometry)) for (const ring of poly) for (const pt of ring) {
    const k = pt[0] + ',' + pt[1]; let s = at.get(k); if (!s) at.set(k, s = new Set()); s.add(f.properties.code);
  }
  const count = {};
  for (const s of at.values()) if (s.size > 1) for (const a of s) for (const b of s) if (a !== b) { (count[a] ??= {})[b] = (count[a][b] || 0) + 1; }
  return Object.fromEntries(features.map(f => [f.properties.code, Object.entries(count[f.properties.code] || {}).filter(([, n]) => n >= 2).map(([c]) => c)]));
}
