// Constants, thresholds and stock designs. Every number here traces to a
// citation in REFERENCES.md. If you change one, change it there too.

(function (root) {
  'use strict';

  var IN = 0.0254; // inch -> metre

  // Solar absorptivity of painted exterior wood. ASHRAE Fundamentals ch. 18
  // surface-property tables; the bracket labels are Tuttle's, the alpha values
  // are the physics.
  var COLORS = [
    { id: 'black',      label: 'Black',                 alpha: 0.95, swatch: '#1b1b1e' },
    { id: 'dark',       label: 'Dark brown / dark grey', alpha: 0.85, swatch: '#4a3728' },
    { id: 'medium',     label: 'Medium brown / grey',    alpha: 0.70, swatch: '#8a6f52' },
    { id: 'light',      label: 'Light tan / light grey', alpha: 0.45, swatch: '#c3ae90' },
    { id: 'white',      label: 'White',                  alpha: 0.25, swatch: '#efeae1' }
  ];

  // Thermal thresholds for reproductive females and pups, degrees C.
  //
  // 22-40 is the Extended Optimal Temperature Range from Fontaine et al. 2021:
  // below 22 a gestating or lactating female spends 50-70% of her time in torpor,
  // which stalls fetal and pup development; above 40 bats abandon their preferred
  // roost position to thermoregulate. 45 and 50 are the acute-risk marks from
  // de Mel et al. 2025 -- at 50+ a small bat can lose over half its body mass to
  // evaporative cooling in a single afternoon.
  var THRESHOLDS = {
    coldTorpor: 22,
    heatStress: 40,
    acute: 45,
    lethal: 50
  };

  // Wood and air properties, SI.
  var MATERIALS = {
    pine:    { k: 0.12, rho: 500, cp: 1700, label: 'Pine / softwood board' },
    plywood: { k: 0.13, rho: 550, cp: 1600, label: 'Exterior-grade plywood' },
    cedar:   { k: 0.10, rho: 380, cp: 1700, label: 'Cedar' },
    hdpe:    { k: 0.45, rho: 950, cp: 1900, label: 'Recycled plastic lumber' }
  };

  var AIR = { k: 0.026, rho: 1.16, cp: 1005 };

  // Mount types. Each sets how much sky and sun the box actually sees and what
  // it is thermally tied to.
  //
  // The occupancy note on each is Tuttle's field result, not a model output:
  // pole-mounted houses beat tree-mounted ones badly and get found about two and
  // a half times faster. It is printed in the UI because a thermally perfect box
  // on a tree trunk is still a bad bat house.
  var MOUNTS = {
    pole: {
      label: 'Free-standing pole',
      skyMask: 1.0,
      backExposed: true,
      windShelter: 1.0,
      note: 'Highest occupancy in field studies. Full sun control, fewest predators.'
    },
    building: {
      label: 'Building wall',
      skyMask: 0.95,
      backExposed: false,
      windShelter: 0.7,
      note: 'Wall mass buffers night cooling; the back panel gets no sun.'
    },
    tree: {
      label: 'Tree trunk',
      skyMask: 0.35,
      backExposed: false,
      windShelter: 0.45,
      note: 'Lowest occupancy of any mount. Shade, predator access, branches in the flight path.'
    }
  };

  // Sun exposure at the site. `window` is the span of local hours when nothing
  // obstructs the box; `beamIn` and `beamOut` are the fraction of the direct beam
  // that gets through inside and outside that span. `skyScale` cuts the diffuse
  // share, because whatever is blocking the sun is blocking sky as well.
  var EXPOSURES = {
    full:      { label: 'Full sun, all day',     window: [0, 24],     beamIn: 1.0,  beamOut: 1.0,  skyScale: 1.0 },
    morning:   { label: 'Morning sun only',      window: [0, 13],     beamIn: 1.0,  beamOut: 0.05, skyScale: 0.80 },
    afternoon: { label: 'Afternoon sun only',    window: [12, 24],    beamIn: 1.0,  beamOut: 0.05, skyScale: 0.80 },
    partial:   { label: 'About 6 hours, midday', window: [9.5, 15.5], beamIn: 1.0,  beamOut: 0.05, skyScale: 0.75 },
    dappled:   { label: 'Dappled / filtered',    window: [0, 24],     beamIn: 0.35, beamOut: 0.35, skyScale: 0.60 },
    shade:     { label: 'Full shade',            window: [0, 24],     beamIn: 0.0,  beamOut: 0.0,  skyScale: 0.45 }
  };

  // Stock designs. Dimensions follow the published certification criteria:
  // 3/4" roosting crevices, at least 24" tall, 4" landing area, rough interior.
  var DESIGNS = {
    single: {
      label: 'Single-chamber (small)',
      chambers: 1, height: 24 * IN, width: 16 * IN,
      crevice: 0.75 * IN, panel: 0.75 * IN, ventSlot: false,
      note: 'Warms and cools fast. No thermal choice for the colony.'
    },
    three: {
      label: 'Three-chamber',
      chambers: 3, height: 24 * IN, width: 24 * IN,
      crevice: 0.75 * IN, panel: 0.75 * IN, ventSlot: true,
      note: 'The common certified size.'
    },
    four: {
      label: 'Four-chamber nursery',
      chambers: 4, height: 32 * IN, width: 24 * IN,
      crevice: 0.75 * IN, panel: 0.75 * IN, ventSlot: true,
      note: 'Deepest front-to-back gradient, so the widest range of choices.'
    },
    rocket: {
      label: 'Rocket box (four-sided)',
      chambers: 4, height: 36 * IN, width: 12 * IN,
      crevice: 0.75 * IN, panel: 0.75 * IN, ventSlot: false, wrapAround: true,
      note: 'Wraps a central post, so some face is always shaded. Strong gradient by aspect.'
    }
  };

  // Tuttle's colour table, the rule this tool exists to test.
  // Keyed on mean daily maximum temperature in July, degrees C.
  function tableRecommendation(julyMeanMaxC) {
    var f = julyMeanMaxC * 9 / 5 + 32;
    if (f < 85) return { color: 'black',  label: 'Black',                  julyF: f };
    if (f < 95) return { color: 'dark',   label: 'Dark brown or dark grey', julyF: f };
    if (f < 100) return { color: 'medium', label: 'Medium colour',          julyF: f };
    return { color: 'white', label: 'White or light colour', julyF: f };
  }

  // A resting bat's metabolic heat output, watts. Normothermic RMR for a ~8 g
  // vespertilionid, converted from oxygen consumption at 20.1 J/mL O2.
  var BAT_WATTS = 0.07;

  var api = {
    IN: IN,
    COLORS: COLORS,
    THRESHOLDS: THRESHOLDS,
    MATERIALS: MATERIALS,
    AIR: AIR,
    MOUNTS: MOUNTS,
    EXPOSURES: EXPOSURES,
    DESIGNS: DESIGNS,
    BAT_WATTS: BAT_WATTS,
    tableRecommendation: tableRecommendation,
    colorById: function (id) {
      for (var i = 0; i < COLORS.length; i++) if (COLORS[i].id === id) return COLORS[i];
      return COLORS[0];
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Presets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
