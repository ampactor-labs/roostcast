// Transient thermal model of a bat house.
//
// Geometry, flat multi-chamber box, front to back:
//
//   panel0 | chamber0 | panel1 | chamber1 | panel2 | ... | chamberN-1 | panelN
//
// plus three lateral panels (left, right, roof).
//
// Each wood panel carries two nodes, one per face, connected through the board.
// A 19 mm board in full sun has a Biot number over 1, so the sunlit face really
// is meaningfully hotter than the face the bats touch, and lumping the panel into
// a single node throws that gradient away. Sun is absorbed at the outer face and
// convection and longwave happen at that same face, with no wood in between --
// getting that wrong was the first version's largest error, worth about 19 C.
//
// Chamber air is not a state. Its time constant is under two seconds, so each
// chamber is solved algebraically from the surfaces bounding it every step. That
// is more accurate than integrating it, and it keeps the system non-stiff.
//
// Lateral panels touch a chamber only along the crevice edge, height times gap,
// which is about 3% of the face area. So the front panel dominates, which is why
// orientation and colour swamp everything else in the field data.

(function (root) {
  'use strict';

  var Solar = (typeof require === 'function') ? require('./solar.js') : root.Solar;
  var P = (typeof require === 'function') ? require('./presets.js') : root.Presets;

  var SIGMA = 5.670374419e-8;
  var EPS_WOOD = 0.90;

  // ---------------------------------------------------------------- geometry

  function buildBox(cfg) {
    var design = P.DESIGNS[cfg.design] || P.DESIGNS.four;
    var mat = P.MATERIALS[cfg.material || 'pine'];
    var color = P.colorById(cfg.color);
    var mount = P.MOUNTS[cfg.mount || 'pole'];

    var n = design.chambers;
    var H = design.height, W = design.width;
    var t = design.panel, gap = design.crevice;
    var depth = (n + 1) * t + n * gap;

    var faceArea = H * W;
    var sideArea = H * depth;
    var roofArea = W * depth;
    var halfC = mat.rho * mat.cp * (t / 2);      // per m^2, one face's half-board

    var panels = [];
    for (var k = 0; k <= n; k++) {
      var ext = null, extSide = null;
      if (k === 0) { ext = { azimuth: cfg.facing, tilt: 90 }; extSide = 'a'; }
      else if (k === n && mount.backExposed) {
        ext = { azimuth: (cfg.facing + 180) % 360, tilt: 90 }; extSide = 'b';
      }
      panels.push({
        kind: k === 0 ? 'front' : (k === n ? 'back' : 'partition'),
        area: faceArea,
        C: halfC * faceArea,                      // per node
        cond: mat.k * faceArea / (t / 2),         // face-to-face through the board
        exterior: ext,
        exteriorSide: extSide,
        wallCoupled: (k === n && !mount.backExposed)
      });
    }

    var lateral = [
      { kind: 'left',  area: sideArea, C: halfC * sideArea,
        cond: mat.k * sideArea / (t / 2), viewSky: 0.5,
        exterior: { azimuth: (cfg.facing + 270) % 360, tilt: 90 },
        contactPerChamber: H * gap },
      { kind: 'right', area: sideArea, C: halfC * sideArea,
        cond: mat.k * sideArea / (t / 2), viewSky: 0.5,
        exterior: { azimuth: (cfg.facing + 90) % 360, tilt: 90 },
        contactPerChamber: H * gap },
      { kind: 'roof',  area: roofArea, C: halfC * roofArea,
        cond: mat.k * roofArea / (t / 2), viewSky: 1.0,
        exterior: { azimuth: cfg.facing, tilt: 15 },
        contactPerChamber: W * gap }
    ];

    return {
      design: design, mat: mat, color: color, mount: mount,
      n: n, H: H, W: W, t: t, gap: gap, depth: depth,
      faceArea: faceArea, sideArea: sideArea, roofArea: roofArea,
      chamberVolume: faceArea * gap,
      panels: panels, lateral: lateral,
      facing: cfg.facing,
      ventSlot: cfg.ventSlot != null ? cfg.ventSlot : !!design.ventSlot,
      colony: cfg.colony == null ? 60 : cfg.colony
    };
  }

  // ------------------------------------------------------------- heat transfer

  // Exterior film conductance, W/m^2K. McAdams smooth-surface forced-convection
  // fit, floored by natural convection off a hot vertical plate, combined the
  // usual cubic way. The floor matters: on the calmest afternoons ERA5 reports
  // wind under 0.2 m/s, and a pure forced-convection fit then under-cools a
  // surface that is 35 K above air and driving its own plume.
  function exteriorFilm(windAtBox, deltaT) {
    var forced = 5.7 + 3.8 * Math.max(0, windAtBox);
    var natural = 1.31 * Math.pow(Math.max(0.5, Math.abs(deltaT || 10)), 1 / 3);
    return Math.pow(forced * forced * forced + natural * natural * natural, 1 / 3);
  }

  // ERA5 is a ~9 km grid and its calmest cells read below any real anemometer,
  // so hold a light-air floor of 0.5 m/s at the box.
  function windAtHeight(w10, heightM, shelter) {
    var h = Math.max(1, heightM);
    return Math.max(0.5, w10 * Math.pow(h / 10, 0.14) * shelter);
  }

  // Chimney flow through a roosting crevice.
  //
  // This is the term the first version got wrong by nearly two orders of
  // magnitude. A crevice is open at the bottom, sometimes vented at the front,
  // and 19 mm wide with hot wood on both sides: it does not exchange air at a
  // building's few air changes per hour, it runs a continuous buoyant draught
  // that turns over its own volume more than once a second. Treating it as
  // infiltration made every box about 12 C too hot.
  //
  // Returns an effective conductance to outside air, W/K.
  function ventConductance(box, chamberC, ambientC, windAtBox) {
    var Tm = (chamberC + ambientC) / 2 + 273.15;
    var dT = Math.max(0.05, chamberC - ambientC);
    var Cd = 0.60;                                   // slot entry and exit losses
    var vStack = Cd * Math.sqrt(2 * 9.81 * box.H * dT / Tm);
    var vWind = 0.08 * windAtBox;                    // openings sit on one face
    var v = Math.sqrt(vStack * vStack + vWind * vWind);

    var aFlow = box.W * box.gap * (box.ventSlot ? 1.35 : 1.0);
    var mdot = P.AIR.rho * v * aFlow;
    return mdot * P.AIR.cp;
  }

  // Effective sky temperature: Berdahl & Martin clear-sky emissivity from the dew
  // point, blended toward air temperature as cloud rises. This sets the overnight
  // minimum, and the overnight minimum decides whether a female spends the night
  // in torpor, so it is worth doing properly rather than with a flat offset.
  function skyTemperature(tAirC, dewC, cloudFrac) {
    var Ta = tAirC + 273.15;
    var td = dewC / 100;
    var epsClear = 0.711 + 0.56 * td + 0.73 * td * td;
    epsClear = Math.max(0.65, Math.min(0.95, epsClear));
    var c = Math.max(0, Math.min(1, cloudFrac));
    var epsSky = epsClear + (1 - epsClear) * c;
    return Math.pow(epsSky, 0.25) * Ta - 273.15;
  }

  function dewPoint(tC, rhPct) {
    var rh = Math.max(1, Math.min(100, rhPct)) / 100;
    var a = 17.625, b = 243.04;
    var g = Math.log(rh) + (a * tC) / (b + tC);
    return (b * g) / (a - g);
  }

  // Interior film in a 19 mm crevice: radiation between two high-emissivity
  // faces, conduction across the gap, and a stack-driven flow term. The flow term
  // is why a vent slot cools a box. Not by flushing air out -- the air in a
  // crevice has no heat capacity worth flushing -- but by scrubbing the wood.
  // Radiant exchange coefficient between the two faces of a crevice, W/m^2K.
  function radiantFilm(tSurfC, tAirC) {
    var Tm = (tSurfC + tAirC) / 2 + 273.15;
    return 4 * SIGMA * Tm * Tm * Tm / (2 / EPS_WOOD - 1);
  }

  function interiorFilm(tSurfC, tAirC, boxHeight, hasVent, gap) {
    var hRad = radiantFilm(tSurfC, tAirC);
    var dT = Math.abs(tSurfC - tAirC);
    var Tm = (tSurfC + tAirC) / 2 + 273.15;
    var v = Math.sqrt(2 * 9.81 * boxHeight * Math.max(0.1, dT) / Tm);
    if (hasVent) v *= 1.5;
    var hFlow = 1.5 + 5.0 * Math.min(v, 1.5);
    var hCond = P.AIR.k / gap;
    return hRad + hCond + hFlow;
  }

  // Net flux into an exposed face: absorbed sun, convection, longwave to sky and
  // ground. No wood resistance here -- this is the surface itself.
  function exteriorFlux(Tface, Tair, Tsky, irradiance, alpha, hOut, area, viewSky) {
    var Ts = Tface + 273.15, Tk = Tsky + 273.15, Tg = Tair + 273.15;
    return alpha * irradiance * area +
           hOut * area * (Tair - Tface) -
           EPS_WOOD * SIGMA * area * (
             viewSky * (Ts * Ts * Ts * Ts - Tk * Tk * Tk * Tk) +
             (1 - viewSky) * (Ts * Ts * Ts * Ts - Tg * Tg * Tg * Tg));
  }

  function beamAvailable(localHour, exposure) {
    var w = exposure.window;
    return (localHour >= w[0] && localHour <= w[1]) ? exposure.beamIn : exposure.beamOut;
  }

  function num(v, fallback) { return (v == null || isNaN(v)) ? fallback : v; }

  // ------------------------------------------------------------------ stepping

  function simulate(climate, site, cfg) {
    var box = buildBox(cfg);
    var n = box.n;
    var exposure = P.EXPOSURES[cfg.exposure || 'full'];
    var alpha = box.color.alpha;
    var heightM = cfg.heightM == null ? 4.0 : cfg.heightM;

    // 20 substeps is 3-minute integration. The explicit scheme needs dt under
    // about 425 s to stay stable on the outer panel node, so anything above 9
    // substeps per hour is safe; sweeps drop to 12 to run four times faster.
    var hours = climate.time.length;
    var subSteps = cfg.subSteps || 20;
    var dt = 3600 / subSteps;

    var nP = n + 1;
    var Pa = new Float64Array(nP);         // panel front-facing faces
    var Pb = new Float64Array(nP);         // panel back-facing faces
    var La = new Float64Array(3);          // lateral outer faces
    var Lb = new Float64Array(3);          // lateral inner faces
    var chamberT = new Float64Array(n);

    var t0 = num(climate.temperature_2m[0], 15);
    Pa.fill(t0); Pb.fill(t0); La.fill(t0); Lb.fill(t0); chamberT.fill(t0);
    var wallT = t0;

    var out = {
      time: climate.time,
      chambers: [],        // operative temperature -- what a bat experiences
      chambersAir: [],     // the through-draught
      chambersSurf: [],    // the wood it hangs from
      ambient: new Float64Array(hours),
      frontFace: new Float64Array(hours),
      isDay: new Uint8Array(hours),
      solarFront: new Float64Array(hours)
    };
    for (var c0 = 0; c0 < n; c0++) {
      out.chambers.push(new Float64Array(hours));
      out.chambersAir.push(new Float64Array(hours));
      out.chambersSurf.push(new Float64Array(hours));
    }

    var utcOff = site.utcOffsetSeconds || 0;
    var hInt = new Float64Array(n);

    for (var h = 0; h < hours; h++) {
      var nx = Math.min(h + 1, hours - 1);
      var Ta0 = num(climate.temperature_2m[h], t0);
      var Ta1 = num(climate.temperature_2m[nx], Ta0);
      var rh = num(climate.relative_humidity_2m[h], 60);
      var cloud = num(climate.cloud_cover[h], 40) / 100;
      var w10 = num(climate.wind_speed_10m[h], 7) / 3.6;   // API delivers km/h
      var ghi = num(climate.shortwave_radiation[h], 0);
      var dni = num(climate.direct_normal_irradiance[h], 0);
      var dhi = num(climate.diffuse_radiation[h], 0);

      var stampUTC = Date.parse(climate.time[h] + ':00Z') - utcOff * 1000;
      var sun = Solar.sunPosition(new Date(stampUTC), site.latitude, site.longitude);
      var localHour = ((stampUTC + utcOff * 1000) / 3600000) % 24;
      if (localHour < 0) localHour += 24;

      var beamMask = beamAvailable(localHour, exposure);
      var skyMask = box.mount.skyMask * exposure.skyScale;
      var vBox = windAtHeight(w10, heightM, box.mount.windShelter);
      var hOut = exteriorFilm(vBox, Pa[0] - Ta0);
      var Tsky = skyTemperature(Ta0, dewPoint(Ta0, rh), cloud);

      var irrP = new Float64Array(nP);
      for (var pi = 0; pi < nP; pi++) {
        var e = box.panels[pi].exterior;
        irrP[pi] = e ? Solar.planeIrradiance(sun, e.tilt, e.azimuth, ghi, dni, dhi,
          { skyMask: skyMask, beamMask: beamMask }).total : 0;
      }
      var irrL = new Float64Array(3);
      for (var li = 0; li < 3; li++) {
        var el = box.lateral[li].exterior;
        irrL[li] = Solar.planeIrradiance(sun, el.tilt, el.azimuth, ghi, dni, dhi,
          { skyMask: skyMask, beamMask: beamMask }).total;
      }

      var day = sun.elevation > 0;
      var batW = day ? box.colony * P.BAT_WATTS : 0;

      for (var s = 0; s < subSteps; s++) {
        var Ta = Ta0 + (Ta1 - Ta0) * ((s + 0.5) / subSteps);

        // Chambers: quasi-steady between the two faces bounding them, plus the
        // crevice-edge contact with the lateral panels.
        for (var i = 0; i < n; i++) {
          var fFront = Pb[i];               // back face of the panel in front
          var fBack = Pa[i + 1];            // front face of the panel behind
          var hi = interiorFilm((fFront + fBack) / 2, chamberT[i], box.H, box.ventSlot, box.gap);
          hInt[i] = hi;

          var Kf = hi * box.faceArea;
          var Kside = hi * box.lateral[0].contactPerChamber;
          var Kroof = hi * box.lateral[2].contactPerChamber;
          var Kvent = ventConductance(box, chamberT[i], Ta, vBox);

          var numer = Kf * fFront + Kf * fBack +
                      Kside * Lb[0] + Kside * Lb[1] + Kroof * Lb[2] +
                      Kvent * Ta + batW / n;
          var denom = 2 * Kf + 2 * Kside + Kroof + Kvent;
          chamberT[i] = numer / denom;
        }

        // Depth panels: two faces each.
        var dPa = new Float64Array(nP), dPb = new Float64Array(nP);
        for (var j = 0; j < nP; j++) {
          var pn = box.panels[j];
          var through = pn.cond * (Pb[j] - Pa[j]);       // b -> a positive
          var qa = through, qb = -through;

          if (pn.exterior && pn.exteriorSide === 'a') {
            qa += exteriorFlux(Pa[j], Ta, Tsky, irrP[j], alpha, hOut, pn.area, 0.5);
          } else if (j > 0) {
            qa += hInt[j - 1] * pn.area * (chamberT[j - 1] - Pa[j]);
          }

          if (pn.exterior && pn.exteriorSide === 'b') {
            qb += exteriorFlux(Pb[j], Ta, Tsky, irrP[j], alpha, hOut, pn.area, 0.5);
          } else if (pn.wallCoupled) {
            qb += 2.5 * pn.area * (wallT - Pb[j]);
          } else if (j < n) {
            qb += hInt[j] * pn.area * (chamberT[j] - Pb[j]);
          }

          dPa[j] = qa / pn.C;
          dPb[j] = qb / pn.C;
        }

        // Lateral panels.
        var dLa = new Float64Array(3), dLb = new Float64Array(3);
        for (var m = 0; m < 3; m++) {
          var lp = box.lateral[m];
          var thr = lp.cond * (Lb[m] - La[m]);
          var qo = thr + exteriorFlux(La[m], Ta, Tsky, irrL[m], alpha, hOut, lp.area, lp.viewSky);
          var qi = -thr;
          for (var ck = 0; ck < n; ck++) {
            qi += hInt[ck] * lp.contactPerChamber * (chamberT[ck] - Lb[m]);
          }
          // The rest of the inner face looks at the panels beside it, near enough
          // to the mean chamber temperature to treat as such.
          var leftover = lp.area - lp.contactPerChamber * n;
          if (leftover > 0) {
            var meanCh = 0;
            for (var cm = 0; cm < n; cm++) meanCh += chamberT[cm];
            meanCh /= n;
            qi += 4.0 * leftover * (meanCh - Lb[m]);
          }
          dLa[m] = qo / lp.C;
          dLb[m] = qi / lp.C;
        }

        for (var a = 0; a < nP; a++) { Pa[a] += dPa[a] * dt; Pb[a] += dPb[a] * dt; }
        for (var b2 = 0; b2 < 3; b2++) { La[b2] += dLa[b2] * dt; Lb[b2] += dLb[b2] * dt; }
        wallT += (Ta - wallT) * dt / (5 * 86400);
      }

      // What the bat is actually exposed to.
      //
      // A roosting bat is pressed against wood inside a channel with a buoyant
      // draught running through it. Air temperature alone is the wrong answer --
      // it under-reads badly on a sunlit afternoon, when the draught is cool and
      // the wood the colony is clinging to is not. Operative temperature blends
      // the two by their transfer coefficients, which is also much closer to what
      // a logger taped inside a crevice records.
      for (var z = 0; z < n; z++) {
        var surf = (Pb[z] + Pa[z + 1]) / 2;
        var hr = radiantFilm(surf, chamberT[z]);
        var hc = Math.max(0.5, hInt[z] - hr);
        out.chambersAir[z][h] = chamberT[z];
        out.chambersSurf[z][h] = surf;
        out.chambers[z][h] = (hr * surf + hc * chamberT[z]) / (hr + hc);
      }
      out.ambient[h] = Ta0;
      out.frontFace[h] = Pa[0];
      out.isDay[h] = day ? 1 : 0;
      out.solarFront[h] = irrP[0];
    }

    out.box = box;
    return out;
  }

  // --------------------------------------------------------------- scoring

  // The metric that matters: at each daytime hour, can a bat find a chamber in
  // the survivable band? A box with one good chamber and three lethal ones still
  // works. A box where every chamber is over 40 C is a trap, because a roosting
  // bat cannot leave in daylight.
  function score(result, thresholds) {
    var T = thresholds || P.THRESHOLDS;
    var n = result.chambers.length;
    var hours = result.time.length;

    var dayHours = 0, refuge = 0, lockout = 0, acute = 0, lethal = 0, cold = 0;
    var peak = -Infinity, peakIdx = -1, minT = Infinity;
    var gradSum = 0, gradN = 0;
    var usableCells = 0, totalCells = 0;
    var daily = {};

    for (var h = 0; h < hours; h++) {
      var lo = Infinity, hi = -Infinity, anyOk = false, okCount = 0;
      for (var c = 0; c < n; c++) {
        var t = result.chambers[c][h];
        if (t < lo) lo = t;
        if (t > hi) hi = t;
        if (t >= T.coldTorpor && t <= T.heatStress) { anyOk = true; okCount++; }
      }
      if (hi > peak) { peak = hi; peakIdx = h; }
      if (lo < minT) minT = lo;

      var day = result.time[h].slice(0, 10);
      if (!daily[day]) daily[day] = { max: -Infinity, min: Infinity, refuge: 0, dayHours: 0, lockout: 0 };
      if (hi > daily[day].max) daily[day].max = hi;
      if (lo < daily[day].min) daily[day].min = lo;

      if (result.isDay[h]) {
        dayHours++;
        daily[day].dayHours++;
        gradSum += (hi - lo); gradN++;
        usableCells += okCount; totalCells += n;
        if (anyOk) { refuge++; daily[day].refuge++; }
        if (lo > T.heatStress) { lockout++; daily[day].lockout++; }
        if (hi > T.acute) acute++;
        if (hi > T.lethal) lethal++;
        if (hi < T.coldTorpor) cold++;
      }
    }

    return {
      dayHours: dayHours,
      refugeHours: refuge,
      // Whether the colony has anywhere to go. Saturates near 100% on any
      // multi-chamber box, so it is a floor, not a ranking.
      refugePct: dayHours ? 100 * refuge / dayHours : 0,
      // How much of the box works, not just whether any of it does. This is the
      // one with enough range to rank configurations against each other.
      usablePct: totalCells ? 100 * usableCells / totalCells : 0,
      lockoutHours: lockout,
      acuteHours: acute,
      lethalHours: lethal,
      coldHours: cold,
      peakC: peak,
      peakAt: peakIdx >= 0 ? result.time[peakIdx] : null,
      minC: minT,
      meanGradient: gradN ? gradSum / gradN : 0,
      daily: daily
    };
  }

  var api = {
    buildBox: buildBox,
    simulate: simulate,
    score: score,
    skyTemperature: skyTemperature,
    dewPoint: dewPoint,
    interiorFilm: interiorFilm,
    exteriorFilm: exteriorFilm,
    windAtHeight: windAtHeight
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Thermal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
