// North America map for /places/, drawn at build time and fitted to the places.
// It always shows at least the lower 48 and grows to take in Canada and Alaska
// places. Hawaii, if it has places, gets a boxed inset in the lower left.
// Geometry comes from world-atlas (countries) and us-atlas (states); everything
// outside the frame is clipped away so the SVG stays small.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { feature, mesh } from 'topojson-client';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { geoConicConformal, geoConicEqualArea, geoPath } from 'd3-geo';

const require = createRequire(import.meta.url);
const load = async (p) => {
  const topo = JSON.parse(await readFile(require.resolve(p), 'utf8'));
  const pre = presimplify(topo);
  return simplify(pre, quantile(pre, 0.12));
};
const world = await load('world-atlas/countries-50m.json');
const us = await load('us-atlas/states-10m.json');

const round = (d) => (d || '').replace(/(\d+\.\d)\d+/g, '$1');
const isHawaii = ([lon, lat]) => lon < -154 && lat < 23;
const LOWER48 = (g) => +g.id <= 56 && !['02', '15'].includes(g.id);
const W = 975;
const PAD = 28;

export function northAmericaMap(points) {
  const states = feature(us, us.objects.states);
  const lower48 = { type: 'FeatureCollection', features: states.features.filter(LOWER48) };
  const main = points.filter((p) => !isHawaii(p));
  const hawaii = points.filter(isHawaii);

  // Fit the width to the lower 48 plus a little land around every place, then
  // size the height to match.
  const around = ([lon, lat]) => [[lon - 4, lat - 1.5], [lon + 4, lat - 1.5], [lon - 4, lat + 1.5], [lon + 4, lat + 1.5]];
  const target = { type: 'FeatureCollection', features: [...lower48.features, { type: 'Feature', geometry: { type: 'MultiPoint', coordinates: main.flatMap(around) } }] };
  const proj = geoConicConformal().parallels([38, 58]).rotate([102, 0]).fitWidth(W - 2 * PAD, target);
  const [[x0, y0], [x1, y1]] = geoPath(proj).bounds(target);
  const H = Math.round(y1 - y0 + 2 * PAD);
  proj.translate([proj.translate()[0] + PAD - x0, proj.translate()[1] + PAD - y0]).clipExtent([[0, 0], [W, H]]);

  const path = geoPath(proj);
  const land = round(path(feature(world, world.objects.land)));
  const countries = round(path(mesh(world, world.objects.countries, (a, b) => a !== b)));
  const stateLines = round(path(mesh(us, us.objects.states, (a, b) => a !== b && a.id !== '02' && b.id !== '02')));
  let svg = `<path class="land" d="${land}"/><path class="borders" d="${stateLines}"/><path class="borders nation" d="${countries}"/>`;

  let hiProj = null;
  if (hawaii.length) {
    const hi = states.features.find((g) => g.id === '15');
    const box = [[12, H - 132], [192, H - 12]];
    hiProj = geoConicEqualArea().rotate([157, 0]).center([-3, 19.9]).parallels([8, 18]).fitExtent([[box[0][0] + 10, box[0][1] + 10], [box[1][0] - 10, box[1][1] - 10]], hi);
    svg += `<rect class="inset" x="${box[0][0]}" y="${box[0][1]}" width="${box[1][0] - box[0][0]}" height="${box[1][1] - box[0][1]}"/><path class="land" d="${round(geoPath(hiProj)(hi))}"/>`;
  }

  const project = (c) => (isHawaii(c) ? hiProj?.(c) : proj(c)) || null;
  return { svg, width: W, height: H, project };
}
