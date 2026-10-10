#!/usr/bin/env node
// Runs the whole pipeline across a spread of North American sites and prints what
// the model concludes, next to what the standard colour table prescribes.
//
//   node tools/report.js            most recent full season
//   node tools/report.js --hottest  hottest of the last ten seasons
//
// This is the evidence document. If the table and the simulation agree
// everywhere, the tool is a curiosity. Where they disagree is the whole point.

'use strict';

const fs = require('fs');
const path = require('path');
const Thermal = require('../src/thermal.js');
const P = require('../src/presets.js');

const CACHE = path.join(__dirname, '..', '.cache');
if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });

const HOURLY = ['temperature_2m', 'relative_humidity_2m', 'shortwave_radiation',
  'direct_normal_irradiance', 'diffuse_radiation', 'wind_speed_10m', 'cloud_cover'].join(',');

async function getJSON(url, tag) {
  const file = path.join(CACHE, tag + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${tag}`);
  const j = await r.json();
  fs.writeFileSync(file, JSON.stringify(j));
  return j;
}

async function season(lat, lon, year) {
  const j = await getJSON(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${year}-05-01&end_date=${year}-08-31&hourly=${HOURLY}&timezone=auto`,
    `s_${lat.toFixed(2)}_${lon.toFixed(2)}_${year}`);
  const out = {
    site: { latitude: j.latitude, longitude: j.longitude, elevation: j.elevation,
            timezone: j.timezone, utcOffsetSeconds: j.utc_offset_seconds },
    time: j.hourly.time
  };
  for (const k of HOURLY.split(',')) out[k] = j.hourly[k];
  return out;
}

async function julyMeanMax(lat, lon, y0, y1) {
  const j = await getJSON(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${y0}-07-01&end_date=${y1}-07-31&daily=temperature_2m_max&timezone=auto`,
    `j_${lat.toFixed(2)}_${lon.toFixed(2)}_${y0}_${y1}`);
  let sum = 0, n = 0;
  j.daily.time.forEach((t, i) => {
    if (t.slice(5, 7) !== '07') return;
    const v = j.daily.temperature_2m_max[i];
    if (v != null) { sum += v; n++; }
  });
  return sum / n;
}

async function hottestYear(lat, lon, endYear, n) {
  const j = await getJSON(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${endYear - n + 1}-05-01&end_date=${endYear}-08-31&daily=temperature_2m_max&timezone=auto`,
    `h_${lat.toFixed(2)}_${lon.toFixed(2)}_${endYear}_${n}`);
  const by = {};
  j.daily.time.forEach((t, i) => {
    const mo = +t.slice(5, 7);
    if (mo < 5 || mo > 8) return;
    const y = t.slice(0, 4), v = j.daily.temperature_2m_max[i];
    if (v != null && (!by[y] || v > by[y])) by[y] = v;
  });
  return Object.keys(by).reduce((a, y) => (!a || by[y] > by[a] ? y : a), null);
}

const SITES = [
  ['Austin, TX',        30.267,  -97.743, 'MTBC home ground; Congress Ave bridge colony'],
  ['Carlsbad, NM',      32.176, -104.444, 'Carlsbad Caverns free-tail colony'],
  ['Phoenix, AZ',       33.448, -112.074, 'hottest large US city'],
  ['Miami, FL',         25.774,  -80.194, 'humid subtropics, long maternity season'],
  ['Minneapolis, MN',   44.978,  -93.265, 'cold end of the little brown bat range'],
  ['Portland, OR',      45.512, -122.658, 'mild summers, 2021 heat dome'],
  ['Lillooet, BC',      50.686, -121.936, 'de Mel study area; 2021 heat dome epicentre'],
  ['Asheville, NC',     35.595,  -82.552, 'southern Appalachians, white-nose country'],
  ['Salt Lake City, UT', 40.735, -111.960, 'Jordan River corridor; Great Basin wind and heat']
];

const BOX = { design: 'four', exposure: 'full', heightM: 4, material: 'pine', colony: 60 };
const COLORS = P.COLORS.map(c => c.id);
const FACINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const COMPASS = { 0:'N', 45:'NE', 90:'E', 135:'SE', 180:'S', 225:'SW', 270:'W', 315:'NW' };

function sweep(wx, mounts) {
  const rows = [];
  for (const color of COLORS) {
    for (const mount of mounts) {
      for (const facing of FACINGS) {
        const cfg = Object.assign({}, BOX, { color, mount, facing, subSteps: 12 });
        rows.push({ color, mount, facing, sc: Thermal.score(Thermal.simulate(wx, wx.site, cfg)) });
      }
    }
  }
  // Rank: never leave the colony without a refuge, then minimise time in the
  // acute band, then maximise how much of the box is actually usable.
  rows.sort((a, b) =>
    a.sc.lockoutHours - b.sc.lockoutHours ||
    a.sc.acuteHours - b.sc.acuteHours ||
    b.sc.usablePct - a.sc.usablePct);
  return rows;
}

(async function main() {
  const useHottest = process.argv.includes('--hottest');
  // Newest season with a full record: the window closes Aug 31 and ERA5 lands
  // about five days behind, so from Sept 8 the current year counts.
  const d = new Date();
  const now = (d.getMonth() > 8 || (d.getMonth() === 8 && d.getDate() >= 8))
    ? d.getFullYear() : d.getFullYear() - 1;

  console.log('\nRoostcast — the colour table versus the simulation');
  console.log(useHottest ? 'Season: hottest of the last ten\n' : `Season: ${now}\n`);
  console.log('Box held constant: four-chamber nursery, full sun, 4 m, pole or wall.\n');

  const header = ['site', 'yr', 'JulyF', 'table says', 'model says', 'usable', 'table usable', 'verdict'];
  const w = [20, 5, 7, 14, 25, 8, 14, 0];
  console.log(header.map((h, i) => String(h).padEnd(w[i])).join(''));
  console.log('-'.repeat(106));

  const disagreements = [];

  for (const [name, lat, lon, note] of SITES) {
    const year = useHottest ? +(await hottestYear(lat, lon, now, 10)) : now;
    const wx = await season(lat, lon, year);
    const jm = await julyMeanMax(lat, lon, Math.max(1991, now - 19), now);
    const rec = P.tableRecommendation(jm);

    const rows = sweep(wx, ['pole', 'building']);
    const best = rows[0];
    const obedient = rows.find(r => r.color === rec.color);

    const same = best.color === rec.color;
    if (!same) disagreements.push({ name, rec, best, obedient, jm, year, note });

    const modelStr = `${P.colorById(best.color).label.split(' ')[0]} · ${COMPASS[best.facing]} · ${best.mount}`;
    console.log(
      name.padEnd(w[0]) +
      String(year).padEnd(w[1]) +
      (jm * 9 / 5 + 32).toFixed(0).padEnd(w[2]) +
      rec.label.split(' ')[0].padEnd(w[3]) +
      modelStr.padEnd(w[4]) +
      (best.sc.usablePct.toFixed(0) + '%').padEnd(w[5]) +
      (obedient ? (obedient.sc.usablePct.toFixed(0) + '%') : '--').padEnd(w[6]) +
      (same ? 'agrees' : 'DISAGREES'));
  }

  console.log('\n' + '='.repeat(106));
  console.log(`${disagreements.length} of ${SITES.length} sites where the colour table picks a different colour than the simulation.\n`);

  for (const d of disagreements) {
    const lost = d.best.sc.usablePct - d.obedient.sc.usablePct;
    console.log(`${d.name} — ${d.note}`);
    console.log(`  July mean max ${(d.jm * 9 / 5 + 32).toFixed(0)} °F, so the table prescribes ${d.rec.label.toLowerCase()}.`);
    console.log(`  Table's best:  ${P.colorById(d.obedient.color).label}, ${COMPASS[d.obedient.facing]}-facing, ${d.obedient.mount}` +
                ` — ${d.obedient.sc.usablePct.toFixed(0)}% usable, ${d.obedient.sc.lockoutHours} h with no cool chamber,` +
                ` peak ${d.obedient.sc.peakC.toFixed(1)} °C`);
    console.log(`  Model's best:  ${P.colorById(d.best.color).label}, ${COMPASS[d.best.facing]}-facing, ${d.best.mount}` +
                ` — ${d.best.sc.usablePct.toFixed(0)}% usable, ${d.best.sc.lockoutHours} h with no cool chamber,` +
                ` peak ${d.best.sc.peakC.toFixed(1)} °C`);
    console.log(`  Difference: ${lost >= 0 ? '+' : ''}${lost.toFixed(0)} points of usable box,` +
                ` ${d.obedient.sc.acuteHours - d.best.sc.acuteHours} fewer hours past 45 C.\n`);
  }
})().catch(e => { console.error(e); process.exit(1); });
