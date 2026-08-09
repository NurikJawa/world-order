const fs = require('node:fs');
const topojson = require('topojson-client');

const topology = JSON.parse(fs.readFileSync(require.resolve('world-atlas/countries-110m.json'), 'utf8'));
const land = topojson.feature(topology, topology.objects.countries);
const project = ([lon, lat]) => [((lon + 180) / 360) * 1200, ((90 - lat) / 180) * 600];

function ringPath(ring) {
  if (ring.length < 3) return '';
  const points = [];
  for (const raw of ring) {
    let lon = raw[0]; const lat = raw[1];
    if (points.length) {
      const previous = points.at(-1)[0];
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
    }
    points.push([lon, lat]);
  }
  if (points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) points.pop();
  const clipAt = (polygon, boundary, keepGreater) => {
    const output = []; if (!polygon.length) return output;
    const inside = (point) => keepGreater ? point[0] >= boundary : point[0] <= boundary;
    const intersection = (start, end) => { const ratio = (boundary - start[0]) / (end[0] - start[0]); return [boundary, start[1] + (end[1] - start[1]) * ratio]; };
    let start = polygon.at(-1);
    for (const end of polygon) {
      const a = inside(start); const b = inside(end);
      if (b) { if (!a && end[0] !== start[0]) output.push(intersection(start, end)); output.push(end); }
      else if (a && end[0] !== start[0]) output.push(intersection(start, end));
      start = end;
    }
    return output;
  };
  let path = '';
  for (let shift = -2; shift <= 2; shift += 1) {
    let polygon = points.map(([lon, lat]) => [lon + shift * 360, lat]);
    if (Math.max(...polygon.map((p) => p[0])) < -180 || Math.min(...polygon.map((p) => p[0])) > 180) continue;
    polygon = clipAt(clipAt(polygon, -180, true), 180, false);
    if (polygon.length < 3) continue;
    path += polygon.map((point, index) => { const [x, y] = project(point); return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`; }).join('') + 'Z';
  }
  return path;
}

function geometryPath(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates.map(ringPath).join('');
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flatMap((polygon) => polygon.map(ringPath)).join('');
  return '';
}

const pathElements = land.type === 'FeatureCollection'
  ? land.features.map((feature) => `<path d="${geometryPath(feature.geometry)}" fill="white"/>`).join('')
  : `<path d="${geometryPath(land.geometry)}" fill="white"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="black"/>${pathElements}</svg>`;
fs.writeFileSync('/tmp/world-order-land-mask.svg', svg);
