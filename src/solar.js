// Solar position and irradiance transposition.
//
// Position: NOAA solar calculator equations (Meeus, low-precision set). Good to
// ~0.01 deg, far tighter than anything downstream cares about.
// Transposition: isotropic sky (Liu & Jordan 1960). Perez would be better for
// tilted-plane accuracy but needs a coefficient table and buys us little here --
// the dominant error in this model is the box, not the sky.

(function (root) {
  'use strict';

  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;

  // Julian day from a Date, using UTC.
  function julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  // Sun position for an instant at a location.
  // Returns zenith and azimuth in degrees; azimuth is compass-style,
  // 0 = north, 90 = east, 180 = south, 270 = west.
  function sunPosition(date, latDeg, lonDeg) {
    var jd = julianDay(date);
    var n = jd - 2451545.0;               // days from J2000.0
    var T = n / 36525.0;                  // Julian centuries

    var L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);        // mean longitude
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);         // mean anomaly
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);    // eccentricity

    var Mr = M * RAD;
    var C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
            Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
            Math.sin(3 * Mr) * 0.000289;                            // equation of center

    var trueLong = L0 + C;
    var omega = 125.04 - 1934.136 * T;
    var appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

    var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    var eps = eps0 + 0.00256 * Math.cos(omega * RAD);

    var declRad = Math.asin(Math.sin(eps * RAD) * Math.sin(appLong * RAD));

    // Equation of time, minutes.
    var y = Math.tan(eps * RAD / 2); y = y * y;
    var L0r = L0 * RAD;
    var eqTime = 4 * DEG * (
      y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr)
    );

    // True solar time -> hour angle.
    var minutesUTC = (jd - Math.floor(jd - 0.5) - 0.5) * 1440;
    var trueSolarMin = minutesUTC + eqTime + 4 * lonDeg;
    var hourAngle = trueSolarMin / 4 - 180;
    while (hourAngle < -180) hourAngle += 360;
    while (hourAngle > 180) hourAngle -= 360;

    var latRad = latDeg * RAD;
    var haRad = hourAngle * RAD;

    var cosZen = Math.sin(latRad) * Math.sin(declRad) +
                 Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad);
    cosZen = Math.max(-1, Math.min(1, cosZen));
    var zenith = Math.acos(cosZen) * DEG;

    // Azimuth measured from north, clockwise. The +180 is not optional: the bare
    // arccosine puts the sun due north at local noon, which silently swaps the
    // front and back of every box in the model.
    var azimuth;
    var denom = Math.cos(latRad) * Math.sin(Math.acos(cosZen));
    if (Math.abs(denom) < 1e-9) {
      azimuth = latDeg > 0 ? 180 : 0;
    } else {
      var cosAz = (Math.sin(latRad) * cosZen - Math.sin(declRad)) / denom;
      cosAz = Math.max(-1, Math.min(1, cosAz));
      var acosAz = Math.acos(cosAz) * DEG;
      azimuth = hourAngle > 0 ? (acosAz + 180) % 360 : (540 - acosAz) % 360;
    }

    return {
      zenith: zenith,
      elevation: 90 - zenith,
      azimuth: azimuth,
      declination: declRad * DEG
    };
  }

  // Cosine of the incidence angle between the sun and a surface.
  // tilt: 0 = horizontal (facing up), 90 = vertical.
  // surfaceAzimuth: compass bearing the surface faces (0 = N, 180 = S).
  function cosIncidence(sun, tiltDeg, surfaceAzimuthDeg) {
    var z = sun.zenith * RAD;
    var b = tiltDeg * RAD;
    var gamma = (sun.azimuth - surfaceAzimuthDeg) * RAD;
    return Math.cos(z) * Math.cos(b) + Math.sin(z) * Math.sin(b) * Math.cos(gamma);
  }

  // Total irradiance on a tilted surface, W/m^2.
  //
  // ghi/dni/dhi come straight from the reanalysis. skyMask and beamMask are the
  // shading terms: what fraction of the sky dome and of the direct beam actually
  // reach this surface after trees, eaves and walls take their cut.
  function planeIrradiance(sun, tiltDeg, surfaceAzimuthDeg, ghi, dni, dhi, opts) {
    opts = opts || {};
    var albedo = opts.albedo == null ? 0.20 : opts.albedo;
    var skyMask = opts.skyMask == null ? 1 : opts.skyMask;
    var beamMask = opts.beamMask == null ? 1 : opts.beamMask;

    var b = tiltDeg * RAD;
    var viewSky = (1 + Math.cos(b)) / 2;
    var viewGround = (1 - Math.cos(b)) / 2;

    var cosI = cosIncidence(sun, tiltDeg, surfaceAzimuthDeg);
    var beam = 0;
    if (cosI > 0 && sun.elevation > 0) beam = dni * cosI * beamMask;

    var diffuse = dhi * viewSky * skyMask;
    var reflected = ghi * albedo * viewGround;

    return {
      total: beam + diffuse + reflected,
      beam: beam,
      diffuse: diffuse,
      reflected: reflected,
      cosIncidence: cosI,
      viewSky: viewSky * skyMask
    };
  }

  // Sunrise/sunset in local decimal hours, or null for polar day/night.
  // Used only to decide when bats are home, so the 0.833 deg refraction
  // convention is plenty.
  function daylightWindow(date, latDeg, lonDeg, utcOffsetSeconds) {
    var noonUTC = new Date(Date.UTC(
      date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
    var sun = sunPosition(noonUTC, latDeg, lonDeg);
    var decl = sun.declination * RAD;
    var lat = latDeg * RAD;

    var cosH = (Math.cos(90.833 * RAD) - Math.sin(lat) * Math.sin(decl)) /
               (Math.cos(lat) * Math.cos(decl));
    if (cosH > 1) return null;   // sun never rises
    if (cosH < -1) return { sunrise: 0, sunset: 24 };

    var H = Math.acos(cosH) * DEG / 15;
    var solarNoonLocal = 12 - lonDeg / 15 + utcOffsetSeconds / 3600;
    return { sunrise: solarNoonLocal - H, sunset: solarNoonLocal + H };
  }

  var api = {
    sunPosition: sunPosition,
    cosIncidence: cosIncidence,
    planeIrradiance: planeIrradiance,
    daylightWindow: daylightWindow
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Solar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
