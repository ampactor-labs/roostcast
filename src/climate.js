// Climate input. Open-Meteo's ERA5 archive: free, no key, CORS open, hourly back
// to 1940, and it hands back elevation and the local UTC offset so we do not have
// to guess either.
//
// Everything here is cached in localStorage when there is one, because a season
// of hourly data is about 3000 rows and nobody should re-pull it to try a
// different paint colour.

(function (root) {
  'use strict';

  var ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
  var GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

  var HOURLY = [
    'temperature_2m',
    'relative_humidity_2m',
    'shortwave_radiation',
    'direct_normal_irradiance',
    'diffuse_radiation',
    'wind_speed_10m',
    'cloud_cover'
  ].join(',');

  function store() {
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; }
    catch (e) { return null; }
  }

  function cacheGet(key) {
    var s = store();
    if (!s) return null;
    try { var v = s.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }

  function cacheSet(key, val) {
    var s = store();
    if (!s) return;
    try { s.setItem(key, JSON.stringify(val)); }
    catch (e) { try { s.clear(); s.setItem(key, JSON.stringify(val)); } catch (e2) {} }
  }

  function geocode(query) {
    var url = GEOCODE + '?name=' + encodeURIComponent(query) + '&count=8&language=en&format=json';
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      return (j.results || []).map(function (r) {
        return {
          name: r.name,
          admin: [r.admin1, r.country].filter(Boolean).join(', '),
          latitude: r.latitude,
          longitude: r.longitude,
          elevation: r.elevation
        };
      });
    });
  }

  // One season of hourly weather. `year` is the calendar year; start and end are
  // 'MM-DD'.
  function fetchSeason(lat, lon, year, startMD, endMD) {
    var start = year + '-' + startMD;
    var end = year + '-' + endMD;
    var key = 'rc:' + lat.toFixed(3) + ',' + lon.toFixed(3) + ':' + start + ':' + end;
    var hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);

    var url = ARCHIVE +
      '?latitude=' + lat.toFixed(4) +
      '&longitude=' + lon.toFixed(4) +
      '&start_date=' + start +
      '&end_date=' + end +
      '&hourly=' + HOURLY +
      '&timezone=auto';

    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Weather archive returned ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j.hourly) throw new Error('No hourly data for that location and window.');
      var out = {
        site: {
          latitude: j.latitude,
          longitude: j.longitude,
          elevation: j.elevation,
          timezone: j.timezone,
          utcOffsetSeconds: j.utc_offset_seconds
        },
        year: year,
        time: j.hourly.time,
        temperature_2m: j.hourly.temperature_2m,
        relative_humidity_2m: j.hourly.relative_humidity_2m,
        shortwave_radiation: j.hourly.shortwave_radiation,
        direct_normal_irradiance: j.hourly.direct_normal_irradiance,
        diffuse_radiation: j.hourly.diffuse_radiation,
        wind_speed_10m: j.hourly.wind_speed_10m,
        cloud_cover: j.hourly.cloud_cover
      };
      cacheSet(key, out);
      return out;
    });
  }

  // Mean daily maximum for July across a span of years. This is the input to the
  // colour table the whole field currently runs on, so the tool has to compute it
  // the same way in order to disagree with it honestly.
  function julyMeanMax(lat, lon, fromYear, toYear) {
    var key = 'rc:july:' + lat.toFixed(3) + ',' + lon.toFixed(3) + ':' + fromYear + '-' + toYear;
    var hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);

    var url = ARCHIVE +
      '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&start_date=' + fromYear + '-07-01&end_date=' + toYear + '-07-31' +
      '&daily=temperature_2m_max&timezone=auto';

    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var sum = 0, n = 0;
      var d = j.daily;
      for (var i = 0; i < d.time.length; i++) {
        if (d.time[i].slice(5, 7) !== '07') continue;
        var v = d.temperature_2m_max[i];
        if (v == null) continue;
        sum += v; n++;
      }
      var res = { meanMaxC: n ? sum / n : null, days: n, fromYear: fromYear, toYear: toYear };
      cacheSet(key, res);
      return res;
    });
  }

  // Which of the last `n` years had the hottest maternity season here? That is
  // the year worth simulating, because a box only has to cook once.
  function hottestRecentYear(lat, lon, endYear, n) {
    var startYear = endYear - n + 1;
    var url = ARCHIVE +
      '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&start_date=' + startYear + '-05-01&end_date=' + endYear + '-08-31' +
      '&daily=temperature_2m_max&timezone=auto';

    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var byYear = {};
      var d = j.daily;
      for (var i = 0; i < d.time.length; i++) {
        var mo = +d.time[i].slice(5, 7);
        if (mo < 5 || mo > 8) continue;
        var y = d.time[i].slice(0, 4);
        var v = d.temperature_2m_max[i];
        if (v == null) continue;
        if (!byYear[y] || v > byYear[y]) byYear[y] = v;
      }
      var best = null;
      Object.keys(byYear).forEach(function (y) {
        if (!best || byYear[y] > best.maxC) best = { year: +y, maxC: byYear[y] };
      });
      return best;
    });
  }

  var api = {
    geocode: geocode,
    fetchSeason: fetchSeason,
    julyMeanMax: julyMeanMax,
    hottestRecentYear: hottestRecentYear,
    HOURLY: HOURLY
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Climate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
