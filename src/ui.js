// Roostcast front end.
//
// Colour carries meaning throughout, so the ramp runs blue to cream to orange to
// plum and never touches the red/green axis. Every colour claim is also written
// out in words and repeated as a number, because a colour scale is a nice-to-have
// and a sentence is not.

(function () {
  'use strict';

  var T = window.Thermal, P = window.Presets, C = window.Climate, S = window.Solar;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    site: null,
    climate: null,
    result: null,
    julyMax: null,
    season: { start: '05-01', end: '08-31' }
  };

  // ------------------------------------------------------------------- colour

  // Piecewise ramp keyed to the biology, not to a gradient that looks nice:
  // blue is too cold to raise pups, cream is the band they need, orange is heat
  // stress, plum is the range where evaporative water loss turns lethal.
  var STOPS = [
    [  0, [ 20,  52,  92]],
    [ 12, [ 52, 106, 158]],
    [ 22, [176, 205, 224]],
    [ 26, [244, 238, 222]],
    [ 36, [240, 224, 186]],
    [ 40, [230, 160,  60]],
    [ 45, [186,  92,  22]],
    [ 50, [124,  40,  30]],
    [ 60, [ 58,  12,  42]]
  ];

  function ramp(t) {
    if (t <= STOPS[0][0]) return STOPS[0][1];
    for (var i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i];
        var f = (t - a[0]) / (b[0] - a[0]);
        return [
          Math.round(a[1][0] + (b[1][0] - a[1][0]) * f),
          Math.round(a[1][1] + (b[1][1] - a[1][1]) * f),
          Math.round(a[1][2] + (b[1][2] - a[1][2]) * f)
        ];
      }
    }
    return STOPS[STOPS.length - 1][1];
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  // What a bat in this box actually gets at this hour: the chamber nearest the
  // band it needs. If one is inside the band, that is the answer; otherwise it is
  // the closest miss, which is the best the colony can do.
  function bestAvailable(result, h) {
    var lo = P.THRESHOLDS.coldTorpor, hi = P.THRESHOLDS.heatStress;
    var best = null, bestMiss = Infinity;
    for (var c = 0; c < result.chambers.length; c++) {
      var t = result.chambers[c][h];
      var miss = t < lo ? lo - t : (t > hi ? t - hi : 0);
      if (miss < bestMiss) { bestMiss = miss; best = t; }
      if (miss === 0) break;
    }
    return best;
  }

  // ------------------------------------------------------------------ controls

  function fillSelects() {
    var d = $('design');
    Object.keys(P.DESIGNS).forEach(function (k) {
      d.appendChild(new Option(P.DESIGNS[k].label, k));
    });
    d.value = 'four';

    var c = $('color');
    P.COLORS.forEach(function (x) { c.appendChild(new Option(x.label, x.id)); });
    c.value = 'dark';

    var m = $('mount');
    Object.keys(P.MOUNTS).forEach(function (k) {
      m.appendChild(new Option(P.MOUNTS[k].label, k));
    });

    var f = $('facing');
    [['N', 0], ['NE', 45], ['E', 90], ['SE', 135],
     ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]].forEach(function (x) {
      f.appendChild(new Option(x[0], x[1]));
    });
    f.value = 180;

    var e = $('exposure');
    Object.keys(P.EXPOSURES).forEach(function (k) {
      e.appendChild(new Option(P.EXPOSURES[k].label, k));
    });

    var y = $('year');
    var last = lastSeason();
    y.appendChild(new Option('Hottest of the last 10 years', 'hottest'));
    for (var yr = last; yr >= last - 11; yr--) y.appendChild(new Option(yr, yr));
  }

  // The newest maternity season with a full record. The window closes Aug 31 and
  // ERA5 lands about five days behind, so from Sept 8 this year counts. Before
  // this, an October run skipped the summer that had just happened, which in
  // Salt Lake in 2026 was the hottest of the decade.
  function lastSeason() {
    var d = new Date(), y = d.getFullYear();
    return (d.getMonth() > 8 || (d.getMonth() === 8 && d.getDate() >= 8)) ? y : y - 1;
  }

  // A link can open the page set up for one box:
  //   ?lat=40.735&lon=-111.96&place=Jordan+River&color=medium&mount=pole&facing=135&run=1
  // Anything missing or not on the menus keeps the default. The point is that a
  // proposal, an email or a QR code on a bat house can say "this box" exactly.
  function applyQuery() {
    var q;
    try { q = new URLSearchParams(window.location.search); } catch (e) { return false; }
    var lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
    if (isFinite(lat) && Math.abs(lat) <= 90 && isFinite(lon) && Math.abs(lon) <= 180) {
      $('lat').value = lat.toFixed(3);
      $('lon').value = lon.toFixed(3);
    }
    if (q.get('place')) $('q').value = q.get('place').slice(0, 80);
    var pick = { design: 'design', color: 'color', mount: 'mount', facing: 'facing',
                 exposure: 'exposure', year: 'year' };
    Object.keys(pick).forEach(function (k) {
      var v = q.get(k), el = $(pick[k]);
      if (v == null) return;
      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].value === v) { el.value = v; return; }
      }
    });
    var h = parseFloat(q.get('height'));
    if (isFinite(h) && h >= 1 && h <= 12) $('height').value = h;
    return q.get('run') === '1';
  }

  function readConfig() {
    return {
      design: $('design').value,
      color: $('color').value,
      mount: $('mount').value,
      facing: +$('facing').value,
      exposure: $('exposure').value,
      heightM: +$('height').value,
      material: 'pine',
      colony: 60
    };
  }

  // ----------------------------------------------------------------- geocoding

  var searchTimer = null;
  $('q').addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = this.value.trim();
    if (q.length < 3) { $('hits').className = 'hits'; return; }
    searchTimer = setTimeout(function () {
      C.geocode(q).then(function (rows) {
        var ul = $('hits');
        ul.innerHTML = '';
        if (!rows.length) { ul.className = 'hits'; return; }
        rows.forEach(function (r) {
          // Place names come back from a third-party geocoder, so they go in as
          // text, never as markup.
          var li = document.createElement('li');
          var top = document.createElement('div');
          top.textContent = r.name;
          var sub = document.createElement('div');
          sub.className = 'sub';
          sub.textContent = r.admin + ' · ' + r.latitude.toFixed(3) + ', ' + r.longitude.toFixed(3);
          li.appendChild(top); li.appendChild(sub);
          li.onclick = function () {
            $('lat').value = r.latitude.toFixed(3);
            $('lon').value = r.longitude.toFixed(3);
            $('q').value = r.name + (r.admin ? ', ' + r.admin : '');
            ul.className = 'hits';
          };
          ul.appendChild(li);
        });
        ul.className = 'hits on';
      }).catch(function () { $('hits').className = 'hits'; });
    }, 260);
  });
  document.addEventListener('click', function (ev) {
    if (!$('q').contains(ev.target) && !$('hits').contains(ev.target)) {
      $('hits').className = 'hits';
    }
  });

  // ------------------------------------------------------------------- running

  $('run').addEventListener('click', function () {
    var lat = +$('lat').value, lon = +$('lon').value;
    if (isNaN(lat) || isNaN(lon)) { $('err').textContent = 'Need a latitude and longitude.'; return; }
    $('err').textContent = '';
    $('run').disabled = true;
    $('spin').textContent = 'Pulling the season…';

    var pick = $('year').value;
    var now = lastSeason();
    var yearP = pick === 'hottest'
      ? C.hottestRecentYear(lat, lon, now, 10).then(function (b) { return b ? b.year : now; })
      : Promise.resolve(+pick);

    yearP.then(function (year) {
      state.year = year;
      return Promise.all([
        C.fetchSeason(lat, lon, year, state.season.start, state.season.end),
        C.julyMeanMax(lat, lon, Math.max(1991, now - 19), now)
      ]);
    }).then(function (both) {
      state.climate = both[0];
      state.site = both[0].site;
      state.julyMax = both[1];
      $('spin').textContent = 'Simulating…';
      return new Promise(function (res) { setTimeout(res, 20); });
    }).then(function () {
      var cfg = readConfig();
      state.result = T.simulate(state.climate, state.site, cfg);
      state.cfg = cfg;
      // Unhide before drawing. A canvas inside a display:none parent measures
      // zero, and a canvas told to be zero pixels wide quietly reverts to 300.
      $('results').className = 'on';
      renderAll();
      $('spin').textContent = '';
      return runSweep(cfg);
    }).then(function () {
      $('run').disabled = false;
      $('spin').textContent = '';
    }).catch(function (e) {
      $('err').textContent = e.message || String(e);
      $('run').disabled = false;
      $('spin').textContent = '';
    });
  });

  // -------------------------------------------------------------------- render

  function renderAll() {
    renderSiteBar();
    renderVerdict();
    renderStats();
    renderHeatmap();
    renderWorstDay();
  }

  function renderSiteBar() {
    var s = state.site;
    $('sitebar').innerHTML =
      '<span>' + s.latitude.toFixed(3) + ', ' + s.longitude.toFixed(3) + '</span>' +
      '<span>' + Math.round(s.elevation) + ' m</span>' +
      '<span>' + s.timezone + '</span>' +
      '<span>season ' + state.year + '</span>';
  }

  function renderVerdict() {
    var sc = T.score(state.result);
    var box = state.result.box;
    var el = $('verdict');
    var head, why, cls;

    var lockDays = 0;
    Object.keys(sc.daily).forEach(function (d) { if (sc.daily[d].lockout > 0) lockDays++; });

    if (sc.lethalHours > 0) {
      cls = 'bad';
      head = 'This box reaches ' + sc.peakC.toFixed(0) + ' °C. That kills bats.';
      why = 'For ' + sc.lethalHours + ' hour' + (sc.lethalHours === 1 ? '' : 's') +
        ' of the season some part of the box sits past 50 °C, and for ' + sc.lockoutHours +
        ' hours there is no chamber below 40 °C to move to. A bat cannot fly out in daylight, and ' +
        'evaporative cooling at those temperatures costs more body water than it has. ' +
        'The worst of it falls on ' + fmtDate(sc.peakAt) + '.';
    } else if (sc.lockoutHours > 0) {
      cls = 'bad';
      head = 'No refuge for ' + sc.lockoutHours + ' hours across ' + lockDays + ' days.';
      why = 'On those hours every chamber sits above 40 °C at once, so there is nowhere cooler to ' +
        'move. Peak ' + sc.peakC.toFixed(0) + ' °C on ' + fmtDate(sc.peakAt) + '. ' +
        'Pups are the ones that cannot leave.';
    } else if (sc.refugePct >= 70) {
      cls = 'good';
      head = 'Workable. A survivable chamber on ' + sc.refugePct.toFixed(0) + '% of daylight hours.';
      why = 'Peak ' + sc.peakC.toFixed(0) + ' °C, and the box never runs out of cooler chambers. ' +
        'Front-to-back spread averages ' + sc.meanGradient.toFixed(1) + ' °C, which is the room ' +
        'the colony has to move around in.';
    } else if (sc.coldHours > sc.dayHours * 0.3) {
      cls = 'warn';
      head = 'Too cold. Only ' + sc.refugePct.toFixed(0) + '% of daylight hours are usable.';
      why = 'The box spends ' + sc.coldHours + ' daylight hours below 22 °C throughout, which pushes ' +
        'gestating and nursing females into torpor and slows pups down. It needs more sun or a ' +
        'darker colour.';
    } else {
      cls = 'warn';
      head = 'Marginal. A survivable chamber on ' + sc.refugePct.toFixed(0) + '% of daylight hours.';
      why = 'Peak ' + sc.peakC.toFixed(0) + ' °C on ' + fmtDate(sc.peakAt) + '. ' +
        'No total lockout, but the margin is thin.';
    }

    var mountNote = box.mount.note;
    el.className = 'verdict ' + cls;
    el.innerHTML = '<p>' + head + '</p><p class="why">' + why + '</p>' +
      '<p class="why"><strong>' + box.mount.label + '.</strong> ' + mountNote + '</p>';
  }

  function renderStats() {
    var sc = T.score(state.result);
    var items = [
      ['refuge', sc.refugePct.toFixed(0) + '%', 'daylight hours with a chamber in 22–40 °C', ''],
      ['lock', sc.lockoutHours, 'hours with every chamber past 40 °C', sc.lockoutHours > 0 ? 'alarm' : ''],
      ['acute', sc.acuteHours, 'hours anywhere past 45 °C', sc.acuteHours > 0 ? 'caution' : ''],
      ['peak', sc.peakC.toFixed(1) + ' °C', 'hottest the box gets, ' + fmtDate(sc.peakAt), ''],
      ['cold', sc.coldHours, 'daylight hours too cold throughout', sc.coldHours > 0 ? 'caution' : ''],
      ['grad', sc.meanGradient.toFixed(1) + ' °C', 'average front-to-back choice', '']
    ];
    $('stats').innerHTML = items.map(function (i) {
      return '<div class="stat ' + i[3] + '"><div class="n">' + i[1] + '</div>' +
             '<div class="k">' + i[2] + '</div></div>';
    }).join('');
  }

  function renderHeatmap() {
    var r = state.result;
    var days = [], seen = {};
    for (var h = 0; h < r.time.length; h++) {
      var d = r.time[h].slice(0, 10);
      if (!seen[d]) { seen[d] = true; days.push(d); }
    }
    var cv = $('heat');
    var wCss = Math.max(320, cv.parentNode.clientWidth - 42);
    var dpr = window.devicePixelRatio || 1;
    var padL = 34, padB = 26, padT = 6;
    var plotW = wCss - padL, plotH = 380;
    cv.style.height = (plotH + padB + padT) + 'px';
    cv.width = wCss * dpr; cv.height = (plotH + padB + padT) * dpr;
    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, wCss, plotH + padB + padT);

    var cw = plotW / days.length, ch = plotH / 24;
    var idx = 0;
    for (var i = 0; i < r.time.length; i++) {
      var dd = days.indexOf(r.time[i].slice(0, 10));
      var hh = +r.time[i].slice(11, 13);
      g.fillStyle = rgb(ramp(bestAvailable(r, i)));
      g.fillRect(padL + dd * cw, padT + hh * ch, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
    }

    var ink = getComputedStyle(document.body).getPropertyValue('--muted').trim();
    g.fillStyle = ink; g.font = '10px ui-monospace, monospace'; g.textAlign = 'right';
    [0, 6, 12, 18].forEach(function (hr) {
      g.fillText(String(hr).padStart(2, '0') + ':00', padL - 6, padT + hr * ch + 9);
    });
    g.textAlign = 'center';
    var step = Math.ceil(days.length / 8);
    for (var k = 0; k < days.length; k += step) {
      g.fillText(days[k].slice(5), padL + k * cw + cw / 2, plotH + padT + 16);
    }

    $('hmnote').textContent =
      'Colour is the best chamber available at that hour — what a bat would move to. ' +
      'Cream is the band pups need. Blue is too cold to grow in; orange and plum mean the whole ' +
      'box has gone past what the colony can tolerate.';

    $('hmlegend').innerHTML = [
      [10, 'below 22 °C — torpor, pups develop slowly'],
      [30, '22–40 °C — the band that works'],
      [43, '40–45 °C — heat stress, no refuge left'],
      [52, 'past 50 °C — lethal water loss']
    ].map(function (x) {
      return '<span><i class="sw" style="background:' + rgb(ramp(x[0])) + '"></i>' + x[1] + '</span>';
    }).join('');
  }

  function renderWorstDay() {
    var r = state.result, sc = T.score(r);
    var day = sc.peakAt.slice(0, 10);
    var idx = [];
    for (var h = 0; h < r.time.length; h++) if (r.time[h].slice(0, 10) === day) idx.push(h);

    var cv = $('dayplot');
    var wCss = Math.max(320, cv.parentNode.clientWidth - 42);
    var dpr = window.devicePixelRatio || 1;
    var padL = 38, padR = 8, padT = 10, padB = 26, plotH = 250;
    cv.style.height = (plotH + padT + padB) + 'px';
    cv.width = wCss * dpr; cv.height = (plotH + padT + padB) * dpr;
    var g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.clearRect(0, 0, wCss, plotH + padT + padB);

    var lo = 5, hi = Math.max(50, Math.ceil(sc.peakC / 5) * 5 + 5);
    var plotW = wCss - padL - padR;
    var X = function (i) { return padL + plotW * i / (idx.length - 1); };
    var Y = function (t) { return padT + plotH * (1 - (t - lo) / (hi - lo)); };

    var line = getComputedStyle(document.body).getPropertyValue('--line').trim();
    var muted = getComputedStyle(document.body).getPropertyValue('--muted').trim();

    // The band that works. Kept quiet: it is the backdrop, not the subject.
    var bandTop = Y(P.THRESHOLDS.heatStress);
    var bandBot = Y(P.THRESHOLDS.coldTorpor);
    g.fillStyle = rgb(ramp(30)); g.globalAlpha = 0.16;
    g.fillRect(padL, bandTop, plotW, bandBot - bandTop);
    g.globalAlpha = 1;
    g.strokeStyle = rgb(ramp(41)); g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(padL, bandTop); g.lineTo(wCss - padR, bandTop); g.stroke();
    g.strokeStyle = rgb(ramp(16));
    g.beginPath(); g.moveTo(padL, bandBot); g.lineTo(wCss - padR, bandBot); g.stroke();
    g.setLineDash([]);
    g.fillStyle = muted; g.font = '10px ui-monospace, monospace'; g.textAlign = 'left';
    g.fillText('40 °C  heat stress', padL + 6, bandTop - 4);
    g.fillText('22 °C  torpor', padL + 6, bandBot + 12);
    g.strokeStyle = line; g.lineWidth = 1;
    g.fillStyle = muted; g.font = '10px ui-monospace, monospace'; g.textAlign = 'right';
    for (var t = 10; t <= hi; t += 10) {
      g.beginPath(); g.moveTo(padL, Y(t)); g.lineTo(wCss - padR, Y(t)); g.stroke();
      g.fillText(t + '°', padL - 6, Y(t) + 3);
    }
    g.textAlign = 'center';
    for (var hh = 0; hh < idx.length; hh += 4) {
      g.fillText(String(hh).padStart(2, '0'), X(hh), plotH + padT + 16);
    }

    // Ambient, for reference.
    g.strokeStyle = muted; g.setLineDash([3, 3]); g.lineWidth = 1.2;
    g.beginPath();
    idx.forEach(function (h, i) { i ? g.lineTo(X(i), Y(r.ambient[h])) : g.moveTo(X(i), Y(r.ambient[h])); });
    g.stroke(); g.setLineDash([]);

    // One line per chamber, front to back. Sequential lightness on one hue, so
    // the order reads as an order rather than as four unrelated categories.
    var n = r.chambers.length;
    var legend = ['<span><i class="sw" style="background:' + muted + '"></i>outside air</span>'];
    // Dash pattern carries the same ordering as the colour, so the chart still
    // reads if the lightness steps are hard to separate.
    var DASH = [[], [7, 3], [3, 3], [2, 4], [9, 3, 2, 3]];
    for (var c = 0; c < n; c++) {
      var shade = n === 1 ? 0 : c / (n - 1);
      var col = 'rgb(' + Math.round(70 + shade * 80) + ',' +
                Math.round(90 + shade * 75) + ',' + Math.round(175 + shade * 50) + ')';
      g.strokeStyle = col; g.lineWidth = 2.2;
      g.setLineDash(DASH[c % DASH.length]);
      g.beginPath();
      idx.forEach(function (h, i) {
        var v = r.chambers[c][h];
        i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v));
      });
      g.stroke();
      g.setLineDash([]);
      legend.push('<span><i class="sw" style="background:' + col + '"></i>chamber ' + (c + 1) +
                  (c === 0 ? ' (front)' : (c === n - 1 ? ' (back)' : '')) + '</span>');
    }
    $('dplegend').innerHTML = legend.join('');
    $('worstTitle').textContent = 'The worst day — ' +
      new Date(day + 'T12:00').toLocaleDateString(undefined,
        { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  // -------------------------------------------------------------------- sweep

  function runSweep(current) {
    var colors = P.COLORS.map(function (c) { return c.id; });
    var facings = [0, 45, 90, 135, 180, 225, 270, 315];
    var mounts = ['pole', 'building'];
    var jobs = [];
    colors.forEach(function (col) {
      mounts.forEach(function (mt) {
        facings.forEach(function (fa) {
          jobs.push({ color: col, mount: mt, facing: fa });
        });
      });
    });

    var rows = [];
    var i = 0;
    $('spin').textContent = 'Trying ' + jobs.length + ' configurations…';

    return new Promise(function (resolve) {
      function chunk() {
        var t0 = performance.now();
        while (i < jobs.length && performance.now() - t0 < 60) {
          var j = jobs[i++];
          var cfg = Object.assign({}, current, j, { subSteps: 12 });
          var sc = T.score(T.simulate(state.climate, state.site, cfg));
          rows.push({ cfg: j, sc: sc });
        }
        $('spin').textContent = 'Trying configurations… ' + i + '/' + jobs.length;
        if (i < jobs.length) { requestAnimationFrame(chunk); }
        else { renderSweep(rows, current); resolve(); }
      }
      requestAnimationFrame(chunk);
    });
  }

  var COMPASS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

  function renderSweep(rows, current) {
    // Never leave the colony without a refuge; then minimise time in the acute
    // band; only then maximise how much of the box is usable. That order matters
    // — a darker box is warmer more of the time and lethal at the top end, and
    // ranking on the average would pick it.
    rows.sort(function (a, b) {
      return a.sc.lockoutHours - b.sc.lockoutHours ||
             a.sc.acuteHours - b.sc.acuteHours ||
             b.sc.usablePct - a.sc.usablePct;
    });
    state.sweep = rows;

    // Best row for each colour rather than the top eight, which would be eight
    // near-identical whites. The question is which colour and which way round,
    // not which of eight indistinguishable whites wins by a tenth of a point.
    var top = [], seenColor = {}, seenMount = {};
    rows.forEach(function (r) {
      if (!seenColor[r.cfg.color]) { seenColor[r.cfg.color] = 1; top.push(r); }
    });
    rows.forEach(function (r) {
      if (!seenMount[r.cfg.mount] && top.indexOf(r) === -1) {
        seenMount[r.cfg.mount] = 1; top.push(r);
      }
    });
    top.sort(function (a, b) { return rows.indexOf(a) - rows.indexOf(b); });

    var cur = rows.filter(function (r) {
      return r.cfg.color === current.color && r.cfg.mount === current.mount &&
             r.cfg.facing === current.facing;
    })[0];
    var curRank = rows.indexOf(cur) + 1;
    if (cur && top.indexOf(cur) === -1) top.push(cur);

    var html = '<thead><tr><th>Colour</th><th>Mount</th><th>Faces</th>' +
      '<th class="num">Usable</th><th class="num">No-refuge hrs</th>' +
      '<th class="num">Past 45 °C</th><th class="num">Peak</th></tr></thead><tbody>';
    top.forEach(function (r, n) {
      var isCur = r === cur;
      var cls = (n === 0 ? 'best' : '') + (isCur ? ' current' : '');
      html += '<tr class="' + cls + '"><td>' + P.colorById(r.cfg.color).label +
        (n === 0 ? '<span class="tag">best here</span>' : '') +
        (isCur ? '<span class="tag">yours</span>' : '') + '</td>' +
        '<td>' + P.MOUNTS[r.cfg.mount].label + '</td>' +
        '<td>' + COMPASS[r.cfg.facing] + '</td>' +
        '<td class="num">' + r.sc.usablePct.toFixed(0) + '%</td>' +
        '<td class="num">' + r.sc.lockoutHours + '</td>' +
        '<td class="num">' + r.sc.acuteHours + '</td>' +
        '<td class="num">' + r.sc.peakC.toFixed(1) + '</td></tr>';
    });
    html += '</tbody>';
    $('sweep').innerHTML = html;

    renderTableComparison(rows, cur, curRank);
  }

  function renderTableComparison(rows, cur, curRank) {
    if (!state.julyMax || state.julyMax.meanMaxC == null) { $('tablecmp').innerHTML = ''; return; }
    var rec = P.tableRecommendation(state.julyMax.meanMaxC);
    var best = rows[0];

    // Best configuration available if you obey the colour table.
    var obedient = rows.filter(function (r) { return r.cfg.color === rec.color; })[0];

    var out = '<p>Mean July daily maximum here is <strong>' +
      state.julyMax.meanMaxC.toFixed(1) + ' °C (' + rec.julyF.toFixed(0) + ' °F)</strong> over ' +
      state.julyMax.fromYear + '–' + state.julyMax.toYear + '. The standard colour table says: ' +
      '<strong>' + rec.label + '</strong>.</p>';

    if (!obedient) { $('tablecmp').innerHTML = out; return; }

    if (obedient.cfg.color === best.cfg.color) {
      out += '<p>The simulation agrees on colour. ' + rec.label + ' ranks first here, ' +
        best.sc.usablePct.toFixed(0) + '% of the box usable, best on a ' +
        P.MOUNTS[best.cfg.mount].label.toLowerCase() + ' facing ' + COMPASS[best.cfg.facing] +
        '. Note that the orientation and the mount are doing work the table never mentions.</p>';
    } else {
      var dUse = best.sc.usablePct - obedient.sc.usablePct;
      var dAcute = obedient.sc.acuteHours - best.sc.acuteHours;
      var dLock = obedient.sc.lockoutHours - best.sc.lockoutHours;
      out += '<p>The simulation disagrees. The best you can do while obeying the table is ' +
        P.colorById(obedient.cfg.color).label.toLowerCase() + ' facing ' + COMPASS[obedient.cfg.facing] +
        ': ' + obedient.sc.usablePct.toFixed(0) + '% of the box usable, ' +
        obedient.sc.lockoutHours + ' hours with no cool chamber anywhere, peak ' +
        obedient.sc.peakC.toFixed(1) + ' °C. Switching to <strong>' +
        P.colorById(best.cfg.color).label.toLowerCase() + '</strong> facing ' + COMPASS[best.cfg.facing] +
        ' gives ' + best.sc.usablePct.toFixed(0) + '%, ' + best.sc.lockoutHours +
        ' hours, peak ' + best.sc.peakC.toFixed(1) + ' °C.</p>';

      if (dUse < 0) {
        out += '<p>Read that carefully: the table\'s colour is usable <em>more</em> of the time, by ' +
          Math.abs(dUse).toFixed(0) + ' points. It is also the one that cooks. It buys ' +
          'comfortable afternoons in June and pays for them with ' + dAcute + ' extra hours past ' +
          '45 °C and ' + dLock + ' extra hours with nowhere to retreat. A colony can sit out a cool ' +
          'week. It cannot sit out an afternoon at 47 °C.</p>';
      }
      out += '<p>The table knows one number about this place: an average. Bats die on the ' +
        'extremes. It cannot see your latitude, which way the box points, whether its back is ' +
        'against a wall, or that the sun striking a vertical south wall in late August is nothing ' +
        'like the sun striking it in June.</p>';
    }
    if (cur) {
      out += '<p>Your configuration ranks ' + curRank + ' of ' + rows.length + '.</p>';
    }
    $('tablecmp').innerHTML = out;
  }

  // -------------------------------------------------------------------- utils

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + ':00');
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) +
      ', ' + iso.slice(11, 16);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!state.result) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { renderHeatmap(); renderWorstDay(); }, 180);
  });

  fillSelects();
  if (applyQuery()) $('run').click();
})();
