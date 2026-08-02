#!/usr/bin/env node
// Run the model against published field measurements and print the error.
//
// This exists so nobody has to take the model on faith, including me. Nothing in
// src/ is fitted to these numbers -- every constant comes from a textbook or a
// cited paper -- so this is a test, not a calibration.
//
//   node tools/validate.js
//
// Weather is cached under .cache/ so reruns are offline.
//
// A note on what is and is not comparable. Fontaine et al. report a pooled range
// of 6.5-44 C for Classic boxes across seven Quebec sites. The lower bound proves
// that range is not a set of raw extremes: ERA5 puts the regional air minimum at
// -2.5 C inside their window, and a 19 mm wooden box cannot sit 9 K above air on
// a clear calm night. So their maximum is a maximum over many boxes at many
// sites, and a single simulated box should land under it. It does, by about 7 K.
// Comparing those two numbers as if they were the same quantity would be the
// easiest way to make this model look better than it is.

'use strict';

const fs = require('fs');
const path = require('path');
const Thermal = require('../src/thermal.js');
const P = require('../src/presets.js');

const CACHE = path.join(__dirname, '..', '.cache');
if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });

const HOURLY = [
  'temperature_2m', 'relative_humidity_2m', 'shortwave_radiation',
  'direct_normal_irradiance', 'diffuse_radiation', 'wind_speed_10m', 'cloud_cover'
].join(',');

async function weather(lat, lon, start, end) {
  const file = path.join(CACHE, `${lat.toFixed(3)}_${lon.toFixed(3)}_${start}_${end}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${start}&end_date=${end}&hourly=${HOURLY}&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`archive ${res.status}`);
  const j = await res.json();
  const out = {
    site: { latitude: j.latitude, longitude: j.longitude, elevation: j.elevation,
            timezone: j.timezone, utcOffsetSeconds: j.utc_offset_seconds },
    time: j.hourly.time
  };
  for (const k of HOURLY.split(',')) out[k] = j.hourly[k];
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

const QC_WARM = { lat: 45.431, lon: -73.943, start: '2017-05-15', end: '2017-09-15' };
const BC_DOME = { lat: 50.686, lon: -121.936, start: '2021-06-20', end: '2021-07-05' };

const CLASSIC = {
  design: 'four', color: 'black', mount: 'pole', facing: 180,
  exposure: 'full', heightM: 3.5, ventSlot: false, material: 'pine', colony: 40
};

function peakOf(r) { return Thermal.score(r).peakC; }

function fractionInBand(r, lo, hi) {
  let n = 0;
  for (let h = 0; h < r.time.length; h++) {
    for (let c = 0; c < r.chambers.length; c++) {
      const t = r.chambers[c][h];
      if (t >= lo && t <= hi) { n++; break; }
    }
  }
  return 100 * n / r.time.length;
}

// Mean local hour at which the box tops out, averaged over days. The single
// hottest hour of a whole season says more about which day was hottest than
// about which way the box faces.
function meanPeakHour(r) {
  const byDay = new Map();
  for (let h = 0; h < r.time.length; h++) {
    const d = r.time[h].slice(0, 10);
    let hi = -Infinity;
    for (let c = 0; c < r.chambers.length; c++) hi = Math.max(hi, r.chambers[c][h]);
    const cur = byDay.get(d);
    if (!cur || hi > cur.t) byDay.set(d, { t: hi, hour: +r.time[h].slice(11, 13) });
  }
  let sum = 0;
  for (const v of byDay.values()) sum += v.hour;
  return sum / byDay.size;
}

function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }

(async function main() {
  const qc = await weather(QC_WARM.lat, QC_WARM.lon, QC_WARM.start, QC_WARM.end);
  const bc = await weather(BC_DOME.lat, BC_DOME.lon, BC_DOME.start, BC_DOME.end);

  const sim = (wx, over) => Thermal.simulate(wx, wx.site, Object.assign({}, CLASSIC, over));

  const quantitative = [];
  const ordering = [];

  // ---- quantitative, against numbers whose definition is unambiguous ----

  // de Mel et al. 2025, JEB 228:jeb251228. An east-facing artificial roost near
  // Lillooet BC peaked at 55.5 C during the June 2021 heat dome.
  {
    const r = sim(bc, { design: 'single', color: 'dark', facing: 90, colony: 0 });
    quantitative.push({
      label: 'de Mel 2025 · east-facing roost, 2021 heat dome',
      metric: 'peak C', want: 55.5, got: peakOf(r), tol: 6.0
    });
  }

  // Fontaine et al. 2021, Sci Rep 11:7728. Classic four-chamber black box spent
  // 46% of the mid-May to mid-September window inside 22-40 C.
  {
    const r = sim(qc, { mount: 'building' });
    quantitative.push({
      label: 'Fontaine 2021 · share of season within 22-40 C',
      metric: '% of hours', want: 46.0, got: fractionInBand(r, 22, 40), tol: 12.0
    });
  }

  // Same study, pooled maximum across seven sites. A single box must land under
  // it, and not absurdly far under.
  {
    const r = sim(qc, {});
    const got = peakOf(r);
    quantitative.push({
      label: 'Fontaine 2021 · under pooled 7-site maximum (44 C)',
      metric: 'gap below', want: -5.0, got: got - 44, tol: 6.0
    });
  }

  // ---- ordering, where the tool actually makes its claims ----

  const black = sim(qc, { color: 'black' });
  const white = sim(qc, { color: 'white' });
  const shaded = sim(qc, { color: 'black', exposure: 'shade' });
  const east = sim(qc, { facing: 90 });
  const west = sim(qc, { facing: 270 });
  const onTree = sim(qc, { mount: 'tree', exposure: 'dappled' });

  ordering.push(['black peaks above white', peakOf(black) > peakOf(white) + 2,
                 `${peakOf(black).toFixed(1)} vs ${peakOf(white).toFixed(1)}`]);
  ordering.push(['full sun peaks above full shade', peakOf(black) > peakOf(shaded) + 2,
                 `${peakOf(black).toFixed(1)} vs ${peakOf(shaded).toFixed(1)}`]);
  // Fontaine found east-facing boxes significantly warmer in the morning on
  // buildings, and orientation making almost no difference on poles. Both fall
  // out of the geometry: a pole-mounted box has two exposed faces, so an
  // east-facing box is a west-facing box with its chambers in reverse order.
  // Only a wall at its back makes which way it points mean anything.
  const eastWall = sim(qc, { facing: 90, mount: 'building' });
  const westWall = sim(qc, { facing: 270, mount: 'building' });
  ordering.push(['east wall-mount peaks earlier than west',
                 meanPeakHour(eastWall) < meanPeakHour(westWall) - 0.5,
                 `${meanPeakHour(eastWall).toFixed(1)}h vs ${meanPeakHour(westWall).toFixed(1)}h`]);
  ordering.push(['orientation barely matters on a free pole',
                 Math.abs(peakOf(east) - peakOf(west)) < 1.0,
                 `${peakOf(east).toFixed(1)} vs ${peakOf(west).toFixed(1)}`]);
  ordering.push(['tree mount runs cooler than open pole', peakOf(onTree) < peakOf(black),
                 `${peakOf(onTree).toFixed(1)} vs ${peakOf(black).toFixed(1)}`]);

  // Front chamber hottest on a sunlit afternoon: the gradient the whole refuge
  // idea depends on.
  {
    const i = black.time.indexOf('2017-07-15T15:00');
    const t = black.chambers.map(c => c[i]);
    ordering.push(['front chamber hottest on a July afternoon',
                   t[0] > t[t.length - 1], t.map(x => x.toFixed(1)).join(' > ')]);
  }

  // A south-facing vertical wall at 45 N takes its hardest sun in late summer,
  // not at the solstice, because midsummer sun is too high to strike it squarely.
  {
    const s = Thermal.score(black);
    const month = +s.peakAt.slice(5, 7);
    ordering.push(['south wall at 45 N peaks after midsummer', month >= 8,
                   `peak in month ${month}`]);
  }

  // ---- report ----

  console.log('\nroostcast model validation');
  console.log('='.repeat(76));
  console.log(pad("published comparison", 50) + pad('want', 8) + pad('model', 8) + pad('err', 8) + 'ok');
  console.log('-'.repeat(76));
  let fails = 0;
  for (const q of quantitative) {
    const err = q.got - q.want;
    const ok = Math.abs(err) <= q.tol;
    if (!ok) fails++;
    console.log(pad(q.label, 50) + pad(q.want.toFixed(1), 8) + pad(q.got.toFixed(1), 8) +
                pad((err >= 0 ? '+' : '') + err.toFixed(1), 8) + (ok ? 'yes' : 'NO'));
  }
  const mae = quantitative.reduce((a, q) => a + Math.abs(q.got - q.want), 0) / quantitative.length;

  console.log('\n' + pad("ordering the tool asserts", 50) + pad('', 16) + 'ok');
  console.log('-'.repeat(76));
  for (const [label, ok, detail] of ordering) {
    if (!ok) fails++;
    console.log(pad(label, 50) + pad(detail, 22) + (ok ? 'yes' : 'NO'));
  }

  console.log('-'.repeat(76));
  console.log(`${quantitative.length + ordering.length - fails}/${quantitative.length + ordering.length} passed` +
              `   mean absolute error on quantitative cases ${mae.toFixed(1)} C`);
  console.log('');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
