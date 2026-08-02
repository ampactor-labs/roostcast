#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path');
const Thermal = require('../src/thermal.js');
const Solar = require('../src/solar.js');
const P = require('../src/presets.js');
const CACHE = path.join(__dirname, '..', '.cache');
const HOURLY = ['temperature_2m','relative_humidity_2m','shortwave_radiation',
  'direct_normal_irradiance','diffuse_radiation','wind_speed_10m','cloud_cover'].join(',');

async function weather(lat, lon, start, end) {
  const file = path.join(CACHE, `${lat.toFixed(3)}_${lon.toFixed(3)}_${start}_${end}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&hourly=${HOURLY}&timezone=auto`;
  const j = await (await fetch(url)).json();
  const out = { site: { latitude: j.latitude, longitude: j.longitude, elevation: j.elevation,
      timezone: j.timezone, utcOffsetSeconds: j.utc_offset_seconds }, time: j.hourly.time };
  for (const k of HOURLY.split(',')) out[k] = j.hourly[k];
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

(async () => {
  const [lat, lon, start, end] = [45.431, -73.943, '2017-05-15', '2017-09-15'];
  const wx = await weather(lat, lon, start, end);

  let aMin = Infinity, aMax = -Infinity, ghiMax = 0;
  for (let i = 0; i < wx.time.length; i++) {
    const t = wx.temperature_2m[i];
    if (t != null) { aMin = Math.min(aMin, t); aMax = Math.max(aMax, t); }
    ghiMax = Math.max(ghiMax, wx.shortwave_radiation[i] || 0);
  }
  console.log(`AMBIENT  min ${aMin.toFixed(1)}  max ${aMax.toFixed(1)}  peak GHI ${ghiMax}`);

  const cool = await weather(47.323, -71.152, start, end);
  let cMin = Infinity, cMax = -Infinity;
  for (const t of cool.temperature_2m) if (t != null) { cMin = Math.min(cMin, t); cMax = Math.max(cMax, t); }
  console.log(`AMBIENT Montmorency  min ${cMin.toFixed(1)}  max ${cMax.toFixed(1)}\n`);

  const base = { design:'four', color:'black', mount:'pole', facing:180,
                 exposure:'full', heightM:3.5, ventSlot:false, material:'pine', colony:40 };

  for (const mount of ['pole','building']) {
    const r = Thermal.simulate(wx, wx.site, Object.assign({}, base, { mount }));
    const s = Thermal.score(r);
    console.log(`${mount.padEnd(9)} peak ${s.peakC.toFixed(1)} at ${s.peakAt}   min ${s.minC.toFixed(1)}   grad ${s.meanGradient.toFixed(1)}`);
  }

  // Peak-day trace on the pole case.
  const r = Thermal.simulate(wx, wx.site, base);
  const s = Thermal.score(r);
  const day = s.peakAt.slice(0, 10);
  console.log(`\n--- hourly trace, ${day} (pole, black, south) ---`);
  console.log('hh   Tair  Tsky   GHI   DNI  frontIrr  roofIrr  face   ch0   ch1   ch2   ch3');
  for (let h = 0; h < r.time.length; h++) {
    if (!r.time[h].startsWith(day)) continue;
    const hh = +r.time[h].slice(11, 13);
    if (hh < 5 || hh > 21) continue;
    const stamp = Date.parse(r.time[h] + ':00Z') - wx.site.utcOffsetSeconds * 1000;
    const sun = Solar.sunPosition(new Date(stamp), lat, lon);
    const irrF = Solar.planeIrradiance(sun, 90, 180, wx.shortwave_radiation[h], wx.direct_normal_irradiance[h], wx.diffuse_radiation[h], {}).total;
    const irrR = Solar.planeIrradiance(sun, 15, 180, wx.shortwave_radiation[h], wx.direct_normal_irradiance[h], wx.diffuse_radiation[h], {}).total;
    const tsky = Thermal.skyTemperature(wx.temperature_2m[h], Thermal.dewPoint(wx.temperature_2m[h], wx.relative_humidity_2m[h]), wx.cloud_cover[h]/100);
    console.log(
      String(hh).padStart(2) + '  ' +
      wx.temperature_2m[h].toFixed(1).padStart(5) +
      tsky.toFixed(1).padStart(6) +
      String(wx.shortwave_radiation[h]).padStart(6) +
      String(Math.round(wx.direct_normal_irradiance[h])).padStart(6) +
      irrF.toFixed(0).padStart(9) + irrR.toFixed(0).padStart(9) +
      r.frontFace[h].toFixed(1).padStart(7) +
      r.chambers.map(c => c[h].toFixed(1).padStart(6)).join(''));
  }

  // Where does the night minimum come from?
  console.log(`\n--- coldest night, pole, Montmorency ---`);
  const rc = Thermal.simulate(cool, cool.site, Object.assign({}, base, { colony: 0 }));
  const sc = Thermal.score(rc);
  let idx = 0, lo = Infinity;
  for (let h = 0; h < rc.time.length; h++) {
    const m = Math.min(...rc.chambers.map(c => c[h]));
    if (m < lo) { lo = m; idx = h; }
  }
  console.log('time              Tair  Tsky  cloud  wind  ch0');
  for (let h = Math.max(0, idx - 4); h <= Math.min(rc.time.length - 1, idx + 2); h++) {
    const tsky = Thermal.skyTemperature(cool.temperature_2m[h], Thermal.dewPoint(cool.temperature_2m[h], cool.relative_humidity_2m[h]), cool.cloud_cover[h]/100);
    console.log(rc.time[h] + '  ' + cool.temperature_2m[h].toFixed(1).padStart(5) +
      tsky.toFixed(1).padStart(6) + String(cool.cloud_cover[h]).padStart(7) +
      cool.wind_speed_10m[h].toFixed(1).padStart(6) + rc.chambers[0][h].toFixed(1).padStart(6));
  }
})();
