// One-off: turns us-atlas (pre-projected Albers USA, 975×610) into a small SVG
// fragment at src/us-map.svg. Rerun only to change the map's detail level.
// Dots are placed by build-site.mjs with the matching d3-geo projection.

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { feature, mesh } from 'topojson-client';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { geoPath } from 'd3-geo';

const require = createRequire(import.meta.url);
const topo = JSON.parse(await readFile(require.resolve('us-atlas/states-albers-10m.json'), 'utf8'));
const detail = Number(process.argv[2] || 0.1);
const simple = simplify(presimplify(topo), quantile(presimplify(topo), detail));
const round = (d) => d.replace(/(\d+\.\d)\d+/g, '$1');
const path = geoPath();
const nation = round(path(feature(simple, simple.objects.nation)));
const borders = round(path(mesh(simple, simple.objects.states, (a, b) => a !== b)));
const svg = `<path class="land" d="${nation}"/><path class="borders" d="${borders}"/>`;
await writeFile(new URL('../src/us-map.svg', import.meta.url), svg + '\n');
console.log(`src/us-map.svg: ${(svg.length / 1024).toFixed(1)} KB at detail ${detail}`);
