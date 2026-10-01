/* ==========================================================================
   DAME Tools Hub — psychrometric chart, page logic

   Holds the list of air states, keeps the chart and the tables in step with
   it, and handles input, examples, mixing, export and persistence. All
   psychrometry lives in psychro.js and all drawing in chart.js; this file is
   the wiring.

   Hub notes: this tool came over from Quicktools and keeps its own markup on
   the legacy-tools layer (see STANDARDS.md § 2a). User-typed text (the state
   names) is written with textContent / value, never innerHTML. The SVG chart
   is built as a string, so names that reach it pass through esc() first.
   Nothing is sent to the database: states live in this browser only.
   ========================================================================== */

(function (global) {
  'use strict';

  var TN = global.TN = global.TN || {};
  var P = TN.psychro;
  var CHART = TN.psychroChart;
  var STORAGE_KEY = 'dame.psychro.v1';

  /* legacy-tools.js supplies TN.esc and TN.toast; these fallbacks only exist
     so the tool still works if the page is opened outside the hub shell. */
  if (typeof TN.esc !== 'function') {
    TN.esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
  }
  if (typeof TN.toast !== 'function') {
    TN.toast = function (msg) {
      if (global.Hub && typeof global.Hub.toast === 'function') { global.Hub.toast(msg); }
    };
  }

  /* Series colours cycle through the --chart-N tokens in styles.css, which
     are defined from the hub's Daikin tokens, so the points follow day and
     night mode instead of carrying literals. */
  var COLOURS = ['--chart-1', '--chart-5', '--chart-2', '--chart-3',
                 '--chart-4', '--chart-6', '--chart-7', '--chart-8'];

  var MODES = {
    rh: { label: 'Relative humidity', unit: '%', ipUnit: '%' },
    wb: { label: 'Wet bulb', unit: '\u00b0C', ipUnit: '\u00b0F' },
    dp: { label: 'Dew point', unit: '\u00b0C', ipUnit: '\u00b0F' },
    w: { label: 'Humidity ratio', unit: 'g/kg', ipUnit: 'gr/lb' },
    h: { label: 'Enthalpy', unit: 'kJ/kg', ipUnit: 'Btu/lb' }
  };

  var FLOW_UNITS = {
    m3h: { label: 'm\u00b3/h', toM3s: function (v) { return v / 3600; }, fromM3s: function (v) { return v * 3600; } },
    ls: { label: 'L/s', toM3s: function (v) { return v / 1000; }, fromM3s: function (v) { return v * 1000; } },
    cfm: { label: 'CFM', toM3s: function (v) { return v / 2118.88; }, fromM3s: function (v) { return v * 2118.88; } }
  };

  var model = null;
  var lastRender = null;
  var pickArmed = false;
  var nextId = 1;

  /* ------------------------------------------------------------- helpers */

  function el(sel) { return document.querySelector(sel); }
  function els(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function esc(s) { return global.TN.esc(s); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; }
  function fix(v, d) { return isFinite(v) ? v.toFixed(d) : '\u2014'; }

  function isIP() { return model.units === 'ip'; }

  /* Temperatures are stored in the unit the user typed them in, so switching
     units converts the stored figures rather than only the labels — otherwise
     "22" would silently become 22 °F. */
  function tempToC(v) { return isIP() ? P.ip.tempToC(v) : v; }
  function tempFromC(v) { return isIP() ? P.ip.tempToF(v) : v; }
  function dTFromK(v) { return isIP() ? P.ip.deltaTToF(v) : v; }

  function tempUnit() { return isIP() ? '\u00b0F' : '\u00b0C'; }
  function powerUnit() { return isIP() ? 'MBH' : 'kW'; }
  function powerFrom(kW) { return isIP() ? P.ip.powerToBtuh(kW) / 1000 : kW; }
  function wUnit() { return isIP() ? 'gr/lb' : 'g/kg'; }
  function wFrom(kgkg) { return isIP() ? P.ip.humRatioToGrains(kgkg) : kgkg * 1000; }
  function hUnit() { return isIP() ? 'Btu/lb' : 'kJ/kg'; }
  function hFrom(kJkg) { return isIP() ? P.ip.enthalpyToIP(kJkg) : kJkg; }
  function vUnit() { return isIP() ? 'ft\u00b3/lb' : 'm\u00b3/kg'; }
  function vFrom(m3kg) { return isIP() ? P.ip.volumeToIP(m3kg) : m3kg; }
  function rhoUnit() { return isIP() ? 'lb/ft\u00b3' : 'kg/m\u00b3'; }
  function rhoFrom(kgm3) { return isIP() ? P.ip.densityToIP(kgm3) : kgm3; }
  function pressUnit() { return isIP() ? 'in.Hg' : 'kPa'; }
  function pressFrom(kPa) { return isIP() ? P.ip.pressureToIP(kPa) : kPa; }

  /* Convert a humidity value between unit systems for the mode it belongs to. */
  function convertHumidityValue(value, mode, toIP) {
    if (!isFinite(value)) { return value; }
    if (mode === 'rh') { return value; }
    if (mode === 'wb' || mode === 'dp') { return toIP ? P.ip.tempToF(value) : P.ip.tempToC(value); }
    if (mode === 'w') { return toIP ? value * 7 : value / 7; }        /* g/kg to gr/lb */
    if (mode === 'h') {
      return toIP ? P.ip.enthalpyToIP(value) : P.ip.enthalpyToSI(value);
    }
    return value;
  }

  /* The humidity figure as psychro.js wants it: SI, and g/kg for mode w. */
  function humidityToSI(value, mode) {
    if (!isFinite(value)) { return NaN; }
    if (mode === 'rh') { return value; }
    if (mode === 'wb' || mode === 'dp') { return tempToC(value); }
    if (mode === 'w') { return isIP() ? value / 7 : value; }
    if (mode === 'h') { return isIP() ? P.ip.enthalpyToSI(value) : value; }
    return value;
  }

  /* --------------------------------------------------------------- model */

  function blankPoint(i) {
    return {
      id: nextId++,
      label: 'Point ' + (i + 1),
      colour: COLOURS[i % COLOURS.length],
      db: NaN,
      mode: 'rh',
      value: NaN,
      flow: NaN
    };
  }

  function defaultModel() {
    return {
      units: 'si',
      pressureMode: 'altitude',
      altitude: 0,
      pressure: P.P_STD,
      rangeMode: 'auto',
      flowUnit: 'm3h',
      layers: { rh: true, wetBulb: true, enthalpy: true, volume: false, comfort: false, protractor: true },
      showAdp: true,
      showLegs: true,
      activeSegment: 0,
      points: []
    };
  }

  function pressureKPa() {
    if (model.pressureMode === 'absolute') {
      var v = model.pressure;
      return isIP() ? v / 0.295299830714 : v;
    }
    var alt = isIP() ? P.ip.lengthToM(model.altitude) : model.altitude;
    return P.pressureAtAltitude(isFinite(alt) ? alt : 0);
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(model)); } catch (e) { /* private mode */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { return null; }
      var m = JSON.parse(raw);
      if (!m || !Array.isArray(m.points)) { return null; }
      m.points.forEach(function (pt) { pt.id = nextId++; });
      var base = defaultModel();
      Object.keys(base).forEach(function (k) { if (!(k in m)) { m[k] = base[k]; } });
      m.layers = Object.assign({}, base.layers, m.layers || {});
      return m;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------ examples */

  /* Deliberately weighted to the region DAME designs in: high ambient, high
     altitude and the two-coil sequences those force. */
  var EXAMPLES = {
    'ahu-mix': {
      name: 'AHU with mixed air \u2014 Dubai summer',
      note: 'Outdoor air at the ASHRAE 0.4% design condition mixed with room return, cooled at the coil, then picking up fan and duct heat on the way to the room.',
      units: 'si', altitude: 0, flowUnit: 'm3h', rangeMode: 'auto',
      points: [
        { label: 'Outdoor air', mode: 'wb', db: 46, value: 30, flow: 4000 },
        /* 4000 m3/h outdoor + 12000 m3/h room, mass-weighted (eq. 45/46):
           the same figure the "Mix two states" button gives. */
        { label: 'Mixed', mode: 'w', db: 29.2, value: 11.9, flow: 16000 },
        { label: 'Off coil', mode: 'rh', db: 13, value: 95, flow: 16000 },
        { label: 'Supply', mode: 'w', db: 14.6, value: 8.6, flow: 16000 },
        { label: 'Room', mode: 'rh', db: 24, value: 50, flow: 12000 }
      ]
    },
    'fresh-air': {
      name: '100% fresh air unit \u2014 Riyadh',
      note: 'A once-through outdoor air unit at 612 m, where the lower barometric pressure lifts the humidity ratio for the same relative humidity. Cooled deep, then reheated to avoid overcooling the space.',
      units: 'si', altitude: 612, flowUnit: 'm3h', rangeMode: 'auto',
      points: [
        { label: 'Outdoor air', mode: 'wb', db: 44, value: 22, flow: 6000 },
        { label: 'Off cooling coil', mode: 'rh', db: 11, value: 95, flow: 6000 },
        { label: 'Off reheat', mode: 'w', db: 18, value: 7.8, flow: 6000 }
      ]
    },
    'winter': {
      name: 'Winter heating and humidification',
      note: 'Cold dry outdoor air warmed by a heating coil at constant moisture, then brought up to room humidity by steam injection at near-constant dry bulb.',
      units: 'si', altitude: 0, flowUnit: 'm3h', rangeMode: 'normal',
      points: [
        { label: 'Outdoor air', mode: 'rh', db: 2, value: 70, flow: 8000 },
        { label: 'Off heating coil', mode: 'w', db: 26, value: 3.0, flow: 8000 },
        { label: 'Off humidifier', mode: 'rh', db: 25.4, value: 40, flow: 8000 }
      ]
    },
    'evap': {
      name: 'Direct evaporative cooling',
      note: 'Hot dry air passed through a wetted medium. The water takes its latent heat from the airstream, so the wet bulb barely moves while the dry bulb falls.',
      units: 'si', altitude: 0, flowUnit: 'm3h', rangeMode: 'auto',
      points: [
        { label: 'Outdoor air', mode: 'rh', db: 42, value: 12, flow: 6000 },
        { label: 'Off pad', mode: 'rh', db: 25.5, value: 62, flow: 6000 }
      ]
    },
    'recovery': {
      name: 'Heat recovery wheel then coil',
      note: 'An enthalpy wheel pre-treats hot humid outdoor air against cool dry exhaust, cutting both the sensible and the latent duty the coil has to carry.',
      units: 'si', altitude: 0, flowUnit: 'm3h', rangeMode: 'auto',
      points: [
        { label: 'Outdoor air', mode: 'wb', db: 42, value: 28, flow: 5000 },
        { label: 'Off wheel', mode: 'wb', db: 30, value: 22.5, flow: 5000 },
        { label: 'Off coil', mode: 'rh', db: 12.5, value: 95, flow: 5000 }
      ]
    }
  };

  function loadExample(key) {
    var ex = EXAMPLES[key];
    if (!ex) { return; }
    var m = defaultModel();
    m.units = ex.units;
    m.altitude = ex.altitude;
    m.flowUnit = ex.flowUnit;
    m.rangeMode = ex.rangeMode;
    m.points = ex.points.map(function (p, i) {
      return {
        id: nextId++,
        label: p.label,
        colour: COLOURS[i % COLOURS.length],
        db: p.db,
        mode: p.mode,
        value: p.value,
        flow: p.flow
      };
    });
    model = m;
    el('#example-note').textContent = ex.note;
    el('#example-note').hidden = false;
    renderAll();
    save();
  }

  /* ------------------------------------------------------------- compute */

  function solve() {
    var p = pressureKPa();
    return model.points.map(function (pt) {
      var db = tempToC(num(pt.db));
      var v = humidityToSI(num(pt.value), pt.mode);
      var s = P.state(db, pt.mode, v, p);
      return { label: pt.label, colour: pt.colour, state: s, point: pt };
    });
  }

  function segmentsOf(solved) {
    var out = [];
    for (var i = 0; i < solved.length - 1; i++) {
      var a = solved[i];
      var b = solved[i + 1];
      if (!a.state.ok || !b.state.ok) { out.push(null); continue; }
      var flowRaw = num(a.point.flow);
      var flowM3s = isFinite(flowRaw) ? FLOW_UNITS[model.flowUnit].toM3s(flowRaw) : NaN;
      out.push({
        index: i,
        from: a,
        to: b,
        process: P.classify(a.state, b.state),
        loads: P.loads(a.state, b.state, flowM3s),
        adp: P.apparatusDewPoint(a.state, b.state)
      });
    }
    return out;
  }

  /* --------------------------------------------------------- input table */

  function renderInputs() {
    var body = el('#points-body');
    var tUnit = tempUnit();
    /* The row skeleton carries only fixed markup; the user's own text (the
       state name) is written afterwards with value / textContent. */
    var rows = model.points.map(function (pt, i) {
      var mode = MODES[pt.mode];
      var unit = isIP() ? mode.ipUnit : mode.unit;
      var swatch = '<span class="psy-swatch" style="background:var(' + pt.colour + ')" aria-hidden="true"></span>';
      var n = 'state ' + (i + 1);
      return '<tr data-id="' + pt.id + '">' +
        '<td>' + swatch +
          '<label class="sr-only" for="lab-' + pt.id + '">Name of ' + n + '</label>' +
          '<input class="psy-name" id="lab-' + pt.id + '" type="text" data-f="label">' +
        '</td>' +
        '<td class="num">' +
          '<label class="sr-only" for="db-' + pt.id + '">Dry bulb for ' + n + ' in ' + tUnit + '</label>' +
          '<input id="db-' + pt.id + '" type="number" step="any" inputmode="decimal" data-f="db" value="' +
            (isFinite(pt.db) ? pt.db : '') + '" placeholder="' + tUnit + '">' +
        '</td>' +
        '<td>' +
          '<label class="sr-only" for="mode-' + pt.id + '">Humidity measure for ' + n + '</label>' +
          '<select id="mode-' + pt.id + '" data-f="mode">' +
            Object.keys(MODES).map(function (k) {
              return '<option value="' + k + '"' + (k === pt.mode ? ' selected' : '') + '>' + MODES[k].label + '</option>';
            }).join('') +
          '</select>' +
        '</td>' +
        '<td class="num">' +
          '<label class="sr-only" for="val-' + pt.id + '">' + mode.label + ' for ' + n + ' in ' + unit + '</label>' +
          '<input id="val-' + pt.id + '" type="number" step="any" inputmode="decimal" data-f="value" value="' +
            (isFinite(pt.value) ? pt.value : '') + '" placeholder="' + unit + '">' +
        '</td>' +
        '<td class="num">' +
          '<label class="sr-only" for="flow-' + pt.id + '">Airflow leaving ' + n + '</label>' +
          '<input id="flow-' + pt.id + '" type="number" step="any" min="0" inputmode="decimal" data-f="flow" value="' +
            (isFinite(pt.flow) ? pt.flow : '') + '" placeholder="optional">' +
        '</td>' +
        '<td class="psy-row-actions">' +
          '<button type="button" class="btn btn--quiet btn--sm" data-act="up"' + (i === 0 ? ' disabled' : '') +
            ' aria-label="Move ' + n + ' earlier">&#8593;</button>' +
          '<button type="button" class="btn btn--quiet btn--sm" data-act="down"' +
            (i === model.points.length - 1 ? ' disabled' : '') +
            ' aria-label="Move ' + n + ' later">&#8595;</button>' +
          '<button type="button" class="btn btn--quiet btn--sm" data-act="remove"' +
            ' aria-label="Remove ' + n + '">&#215;</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    body.innerHTML = rows;
    model.points.forEach(function (pt) {
      var input = body.querySelector('#lab-' + pt.id);
      if (input) { input.value = pt.label; }
    });
    el('#points-empty').hidden = model.points.length > 0;
    renderMixOptions();
    el('#flow-unit-head').textContent = FLOW_UNITS[model.flowUnit].label;
    el('#db-unit-head').textContent = tUnit;
  }

  /* ------------------------------------------------------------- results */

  var PROPS = [
    ['Dry bulb', function (s) { return fix(tempFromC(s.db), 1); }, tempUnit],
    ['Wet bulb', function (s) { return fix(tempFromC(s.wb), 1); }, tempUnit],
    ['Dew point', function (s) { return fix(tempFromC(s.dp), 1); }, tempUnit],
    ['Relative humidity', function (s) { return fix(s.rh, 1); }, function () { return '%'; }],
    ['Humidity ratio', function (s) { return fix(wFrom(s.W), isIP() ? 1 : 2); }, wUnit],
    ['Enthalpy', function (s) { return fix(hFrom(s.h), 2); }, hUnit],
    ['Specific volume', function (s) { return fix(vFrom(s.v), 4); }, vUnit],
    ['Density', function (s) { return fix(rhoFrom(s.rho), 4); }, rhoUnit],
    ['Vapour pressure', function (s) { return fix(pressFrom(s.pw), 3); }, pressUnit],
    ['Saturation vapour pressure', function (s) { return fix(pressFrom(P.satPressureMoist(s.db, s.p)), 3); }, pressUnit],
    ['Degree of saturation', function (s) { return fix(s.mu * 100, 1); }, function () { return '%'; }],
    ['Specific heat (moist air)', function (s) { return fix(isIP() ? s.cp / 4.1868 : s.cp, 4); },
      function () { return isIP() ? 'Btu/(lb·°F)' : 'kJ/(kg·K)'; }]
  ];

  function renderStateTable(solved) {
    var okStates = solved.filter(function (r) { return r.state.ok; });
    var wrap = el('#states-wrap');
    if (!okStates.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    var headRow = document.createElement('tr');
    headRow.innerHTML = '<th scope="col">Property</th><th scope="col">Unit</th>';
    okStates.forEach(function (r) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.className = 'num';
      var sw = document.createElement('span');
      sw.className = 'psy-swatch';
      sw.style.background = 'var(' + r.colour + ')';
      sw.setAttribute('aria-hidden', 'true');
      th.appendChild(sw);
      th.appendChild(document.createTextNode(r.label));
      headRow.appendChild(th);
    });

    var body = PROPS.map(function (p) {
      return '<tr><th scope="row">' + p[0] + '</th><td class="psy-unit">' + p[2]() + '</td>' +
        okStates.map(function (r) { return '<td class="num">' + p[1](r.state) + '</td>'; }).join('') +
        '</tr>';
    }).join('');

    var head = el('#states-head');
    head.innerHTML = '';
    head.appendChild(headRow);
    el('#states-body').innerHTML = body;
  }

  function renderSegmentTable(segments) {
    var wrap = el('#segments-wrap');
    var live = segments.filter(Boolean);
    if (!live.length) {
      wrap.hidden = true;
      el('#segments-empty').hidden = false;
      return;
    }
    wrap.hidden = false;
    el('#segments-empty').hidden = true;

    var pu = powerUnit();
    el('#seg-total-head').textContent = 'Total ' + pu;
    el('#seg-sens-head').textContent = 'Sensible ' + pu;
    el('#seg-lat-head').textContent = 'Latent ' + pu;
    el('#seg-dt-head').textContent = '\u0394t ' + tempUnit();
    el('#seg-dw-head').textContent = '\u0394W ' + wUnit();

    var segBody = el('#segments-body');
    segBody.innerHTML = live.map(function (sg) {
      var L = sg.loads;
      var dT = sg.to.state.db - sg.from.state.db;
      var dW = sg.to.state.W - sg.from.state.W;
      var active = sg.index === model.activeSegment;
      return '<tr data-seg="' + sg.index + '"' + (active ? ' class="is-active"' : '') + '>' +
        '<td><button type="button" class="psy-seg-btn" data-seg-select="' + sg.index + '">' +
          '<span class="psy-swatch" style="background:var(' + sg.to.colour + ')" aria-hidden="true"></span>' +
          '<span class="psy-seg-name"></span></button></td>' +
        '<td>' + esc(sg.process.name) + '</td>' +
        '<td class="num">' + fix(dTFromK(dT), 1) + '</td>' +
        '<td class="num">' + fix(wFrom(dW), isIP() ? 1 : 2) + '</td>' +
        '<td class="num">' + (L ? fix(powerFrom(L.total), 1) : '\u2014') + '</td>' +
        '<td class="num">' + (L ? fix(powerFrom(L.sensible), 1) : '\u2014') + '</td>' +
        '<td class="num">' + (L ? fix(powerFrom(L.latent), 1) : '\u2014') + '</td>' +
        '<td class="num">' + (L && isFinite(L.shr) ? fix(L.shr, 2) : '\u2014') + '</td>' +
        '</tr>';
    }).join('');
    /* State names are user text: written with textContent, not markup. */
    live.forEach(function (sg) {
      var span = segBody.querySelector('tr[data-seg="' + sg.index + '"] .psy-seg-name');
      if (span) { span.textContent = sg.from.label + ' \u2192 ' + sg.to.label; }
    });
  }

  function renderDetail(segments) {
    var box = el('#segment-detail');
    var sg = segments[model.activeSegment];
    if (!sg) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var L = sg.loads;
    var s1 = sg.from.state;
    var s2 = sg.to.state;

    var stats = [];
    stats.push(['Process', sg.process.name, '']);
    stats.push(['\u0394 Dry bulb', fix(dTFromK(s2.db - s1.db), 1), tempUnit()]);
    stats.push(['\u0394 Humidity ratio', fix(wFrom(s2.W - s1.W), isIP() ? 1 : 2), wUnit()]);
    stats.push(['\u0394 Enthalpy', fix(hFrom(s2.h) - hFrom(s1.h), 2), hUnit()]);
    if (L) {
      stats.push(['Total load', fix(powerFrom(Math.abs(L.total)), 1), powerUnit()]);
      stats.push(['Sensible', fix(powerFrom(Math.abs(L.sensible)), 1), powerUnit()]);
      stats.push(['Latent', fix(powerFrom(Math.abs(L.latent)), 1), powerUnit()]);
      stats.push(['Sensible heat ratio', isFinite(L.shr) ? fix(L.shr, 3) : '\u2014', '']);
      stats.push(['Moisture', fix(isIP() ? L.moisture * 2.20462 : L.moisture, 2), isIP() ? 'lb/h' : 'kg/h']);
      stats.push(['Dry air mass flow', fix(isIP() ? P.ip.massFlowToLbh(L.massFlowDryAir) : L.massFlowDryAir, 3),
                  isIP() ? 'lb/h' : 'kg/s']);
    }
    if (sg.adp) {
      stats.push(['Apparatus dew point', fix(tempFromC(sg.adp.t), 1), tempUnit()]);
      stats.push(['Coil bypass factor', fix(sg.adp.bypassFactor, 3), '']);
      stats.push(['Contact factor', fix(sg.adp.contactFactor, 3), '']);
    }

    el('#detail-title').textContent = sg.from.label + ' \u2192 ' + sg.to.label;
    el('#detail-note').textContent = sg.process.note;
    el('#detail-stats').innerHTML = stats.map(function (s) {
      return '<div class="stat"><div class="stat__value">' + esc(s[1]) +
        (s[2] ? ' <span class="psy-stat-unit">' + esc(s[2]) + '</span>' : '') +
        '</div><div class="stat__label">' + esc(s[0]) + '</div></div>';
    }).join('');

    /* Notes worth raising because they change what someone would do next,
       rather than restating a number that is already in the table above. */
    var notes = [];
    if (sg.process.key === 'cooldehumid' && !sg.adp) {
      notes.push('The process line never reaches the saturation curve, so there is no apparatus dew point. ' +
        'A single coil cannot produce this leaving condition from this entering condition — the duty needs ' +
        'either a lower sensible heat ratio than a coil can deliver, or a second stage.');
    }
    if (sg.adp && sg.adp.bypassFactor > 0.25) {
      notes.push('A bypass factor of ' + sg.adp.bypassFactor.toFixed(2) +
        ' is high for a comfort coil. Expect it to need more rows, closer fin spacing, or a lower face velocity.');
    }
    if (sg.adp && sg.adp.t < 4) {
      notes.push('An apparatus dew point of ' + fix(tempFromC(sg.adp.t), 1) + ' ' + tempUnit() +
        ' is close to freezing. Check the chilled water or refrigerant temperature this implies.');
    }
    if (s2.rh > 95) {
      notes.push('Leaving air at ' + s2.rh.toFixed(0) + '% relative humidity is close to saturation. ' +
        'Any further cooling downstream — duct losses, a cold plenum — will condense.');
    }
    if (sg.process.key === 'evap') {
      notes.push('Wet bulb moved by ' + fix(dTFromK(s2.wb - s1.wb), 2) + ' ' + tempUnit() +
        ' across this step. An ideal adiabatic process holds it constant, so the closer to zero, the closer to ideal.');
    }
    if (L && isFinite(L.shr) && L.shr < 0.6 && sg.process.key === 'cooldehumid') {
      notes.push('A sensible heat ratio of ' + L.shr.toFixed(2) +
        ' means most of the duty is latent. Worth confirming the moisture load is real and not an artefact of the assumed outdoor condition.');
    }
    el('#detail-notes').innerHTML = notes.length
      ? notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('')
      : '';
    el('#detail-notes-wrap').hidden = notes.length === 0;
  }

  function renderErrors(solved) {
    var bad = [];
    solved.forEach(function (r, i) {
      if (!r.state.ok && (isFinite(num(r.point.db)) || isFinite(num(r.point.value)))) {
        bad.push(r.label + ': ' + r.state.error);
      }
    });
    var box = el('#input-errors');
    box.hidden = bad.length === 0;
    box.innerHTML = '';
    if (bad.length) {
      var wrap = document.createElement('div');
      var strong = document.createElement('strong');
      strong.textContent = 'Check these states';
      var ul = document.createElement('ul');
      bad.forEach(function (b) {
        var li = document.createElement('li');
        li.textContent = b;
        ul.appendChild(li);
      });
      wrap.appendChild(strong);
      wrap.appendChild(ul);
      box.appendChild(wrap);
    }
  }

  /* ------------------------------------------------------------- mixing */

  /* Adiabatic mixing of two of the listed states (ASHRAE Eq 45/46), added as
     a new state with its own row. The airflow of each state is taken from its
     Airflow column; the mixed row gets their sum. The result is stored as an
     ordinary row (dry bulb + humidity ratio) so it can be edited or moved
     like any other, and so later edits to the sources do not silently move
     it — a mixed condition on a submittal is a number, not a formula. */
  function renderMixOptions() {
    var selA = el('#mix-a');
    var selB = el('#mix-b');
    if (!selA || !selB) { return; }
    var prevA = selA.value;
    var prevB = selB.value;
    [selA, selB].forEach(function (sel) { sel.innerHTML = ''; });
    model.points.forEach(function (pt, i) {
      [selA, selB].forEach(function (sel) {
        var o = document.createElement('option');
        o.value = String(pt.id);
        o.textContent = pt.label || ('State ' + (i + 1));
        sel.appendChild(o);
      });
    });
    var ids = model.points.map(function (pt) { return String(pt.id); });
    selA.value = ids.indexOf(prevA) >= 0 ? prevA : (ids[0] || '');
    selB.value = ids.indexOf(prevB) >= 0 ? prevB : (ids[1] || ids[0] || '');
    el('#mix-wrap').hidden = model.points.length < 2;
  }

  function mixStates() {
    var ia = findPoint(+el('#mix-a').value);
    var ib = findPoint(+el('#mix-b').value);
    var msg = el('#mix-msg');
    msg.textContent = '';
    if (ia < 0 || ib < 0 || ia === ib) { msg.textContent = 'Choose two different states to mix.'; return; }
    var solved = solve();
    var a = solved[ia];
    var b = solved[ib];
    if (!a.state.ok || !b.state.ok) { msg.textContent = 'Both states need valid inputs before they can be mixed.'; return; }
    var fa = num(a.point.flow);
    var fb = num(b.point.flow);
    if (!(fa > 0) || !(fb > 0)) {
      msg.textContent = 'Enter an airflow for both states in the Airflow column — the mix is weighted by mass flow.';
      return;
    }
    var unit = FLOW_UNITS[model.flowUnit];
    var mixed = P.mix(a.state, unit.toM3s(fa), b.state, unit.toM3s(fb));
    if (!mixed.ok) { msg.textContent = mixed.error; return; }

    var pt = blankPoint(model.points.length);
    pt.label = 'Mixed (' + a.label + ' + ' + b.label + ')';
    pt.db = +tempFromC(mixed.db).toFixed(2);
    pt.mode = 'w';
    pt.value = +wFrom(mixed.W).toFixed(3);
    /* Volume flow at the mixed state, from the total dry-air mass flow. */
    pt.flow = +unit.fromM3s(mixed.massFlowDryAir * mixed.v).toFixed(1);
    /* Insert straight after the later of the two sources so the process
       order still reads top to bottom. */
    model.points.splice(Math.max(ia, ib) + 1, 0, pt);
    renderAll();
    save();
    TN.toast('Added ' + pt.label + ' at ' + fix(tempFromC(mixed.db), 1) + ' ' + tempUnit() +
             ', ' + fix(mixed.rh, 0) + '% RH.');
  }

  /* --------------------------------------------------------------- chart */

  function renderChart(solved, segments) {
    var sg = segments[model.activeSegment];
    var shr = sg && sg.loads && isFinite(sg.loads.shr) ? sg.loads.shr : NaN;
    /* With no airflow entered there is no load, but the ratio is still fixed
       by the two states, so the protractor can still be driven. */
    if (!isFinite(shr) && sg) {
      var s1 = sg.from.state;
      var s2 = sg.to.state;
      var dh = s2.h - s1.h;
      if (Math.abs(dh) > 1e-9) {
        shr = P.specificHeat((s1.W + s2.W) / 2) * (s2.db - s1.db) / dh;
      }
    }

    var caption;
    if (model.pressureMode === 'altitude') {
      var altM = isIP() ? P.ip.lengthToM(model.altitude) : model.altitude;
      caption = 'Altitude ' + Math.round(isFinite(altM) ? altM : 0) + ' m (standard atmosphere)';
    } else {
      caption = 'Measured barometric pressure';
    }

    var out = CHART.render(solved, {
      pressure: pressureKPa(),
      rangeMode: model.rangeMode,
      layers: model.layers,
      activeSegment: model.activeSegment,
      showAdp: model.showAdp,
      showLegs: model.showLegs,
      shr: shr,
      captionAltitude: caption
    });

    var svg = el('#psy-svg');
    svg.setAttribute('viewBox', '0 0 ' + CHART.VB.w + ' ' + CHART.VB.h);
    svg.innerHTML = out.svg;
    svg.setAttribute('aria-label', chartDescription(solved, segments));
    lastRender = out;
  }

  function chartDescription(solved, segments) {
    var ok = solved.filter(function (r) { return r.state.ok; });
    if (!ok.length) { return 'Psychrometric chart with no points plotted yet.'; }
    var parts = ok.map(function (r) {
      return r.label + ' at ' + r.state.db.toFixed(1) + ' degrees dry bulb and ' +
        r.state.rh.toFixed(0) + ' percent relative humidity';
    });
    var procs = segments.filter(Boolean).map(function (s) { return s.process.name.toLowerCase(); });
    return 'Psychrometric chart plotting ' + parts.join('; ') +
      (procs.length ? '. Processes: ' + procs.join(', ') : '') +
      '. The same figures are given in the tables below this chart.';
  }

  /* Live readout as the pointer moves over the chart. This is the thing a
     paper chart cannot do and the reason to have it on a screen at all. */
  function wireChartPointer() {
    var svg = el('#psy-svg');
    var readout = el('#psy-readout');

    function fromEvent(ev) {
      if (!lastRender) { return null; }
      var rect = svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) / rect.width * CHART.VB.w;
      var py = (ev.clientY - rect.top) / rect.height * CHART.VB.h;
      if (px < CHART.PLOT.x0 || px > CHART.PLOT.x1 || py < CHART.PLOT.y0 || py > CHART.PLOT.y1) { return null; }
      var t = lastRender.view.t(px);
      var w = lastRender.view.w(py);
      var s = P.state(t, 'w', w, pressureKPa());
      return { px: px, py: py, t: t, w: w, state: s };
    }

    svg.addEventListener('pointermove', function (ev) {
      var hit = fromEvent(ev);
      var layer = svg.querySelector('.psy-cursor');
      if (!hit || !hit.state.ok) {
        if (layer) { layer.innerHTML = ''; }
        readout.hidden = true;
        return;
      }
      var s = hit.state;
      if (layer) {
        layer.innerHTML =
          '<line class="psy-cross" x1="' + CHART.PLOT.x0 + '" y1="' + hit.py.toFixed(1) +
          '" x2="' + CHART.PLOT.x1 + '" y2="' + hit.py.toFixed(1) + '"/>' +
          '<line class="psy-cross" x1="' + hit.px.toFixed(1) + '" y1="' + CHART.PLOT.y0 +
          '" x2="' + hit.px.toFixed(1) + '" y2="' + CHART.PLOT.y1 + '"/>';
      }
      readout.hidden = false;
      readout.innerHTML = [
        ['DB', fix(tempFromC(s.db), 1) + ' ' + tempUnit()],
        ['WB', fix(tempFromC(s.wb), 1) + ' ' + tempUnit()],
        ['DP', fix(tempFromC(s.dp), 1) + ' ' + tempUnit()],
        ['RH', fix(s.rh, 1) + ' %'],
        ['W', fix(wFrom(s.W), 2) + ' ' + wUnit()],
        ['h', fix(hFrom(s.h), 1) + ' ' + hUnit()],
        ['v', fix(vFrom(s.v), 4) + ' ' + vUnit()]
      ].map(function (r) {
        return '<span><b>' + r[0] + '</b> ' + r[1] + '</span>';
      }).join('');
    });

    svg.addEventListener('pointerleave', function () {
      var layer = svg.querySelector('.psy-cursor');
      if (layer) { layer.innerHTML = ''; }
      readout.hidden = true;
    });

    svg.addEventListener('click', function (ev) {
      if (!pickArmed) { return; }
      var hit = fromEvent(ev);
      if (!hit || !hit.state.ok) { return; }
      var i = model.points.length;
      var pt = blankPoint(i);
      pt.db = +tempFromC(hit.state.db).toFixed(1);
      pt.mode = 'rh';
      pt.value = +hit.state.rh.toFixed(1);
      model.points.push(pt);
      setPick(false);
      renderAll();
      save();
      TN.toast('Added ' + pt.label + ' from the chart.');
    });
  }

  function setPick(on) {
    pickArmed = on;
    var btn = el('#btn-pick');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? 'Click the chart\u2026' : 'Pick from chart';
    el('#psy-svg').classList.toggle('is-picking', on);
  }

  /* -------------------------------------------------------------- export */

  function toCSV(solved, segments) {
    var rows = [];
    rows.push(['DAME Tools Hub — psychrometric chart (ASHRAE Fundamentals Ch. 1, with enhancement factor)']);
    rows.push(['Barometric pressure', fix(pressFrom(pressureKPa()), 3), pressUnit()]);
    rows.push([]);
    rows.push(['State'].concat(PROPS.map(function (p) { return p[0] + ' (' + p[2]() + ')'; })));
    solved.forEach(function (r) {
      if (!r.state.ok) { return; }
      rows.push([r.label].concat(PROPS.map(function (p) { return p[1](r.state); })));
    });
    rows.push([]);
    rows.push(['From', 'To', 'Process', '\u0394t (' + tempUnit() + ')', '\u0394W (' + wUnit() + ')',
               'Total (' + powerUnit() + ')', 'Sensible (' + powerUnit() + ')',
               'Latent (' + powerUnit() + ')', 'SHR', 'ADP (' + tempUnit() + ')', 'Bypass factor']);
    segments.filter(Boolean).forEach(function (sg) {
      var L = sg.loads;
      rows.push([
        sg.from.label, sg.to.label, sg.process.name,
        fix(dTFromK(sg.to.state.db - sg.from.state.db), 1),
        fix(wFrom(sg.to.state.W - sg.from.state.W), 2),
        L ? fix(powerFrom(L.total), 2) : '',
        L ? fix(powerFrom(L.sensible), 2) : '',
        L ? fix(powerFrom(L.latent), 2) : '',
        L && isFinite(L.shr) ? fix(L.shr, 3) : '',
        sg.adp ? fix(tempFromC(sg.adp.t), 2) : '',
        sg.adp ? fix(sg.adp.bypassFactor, 3) : ''
      ]);
    });

    return rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  function download(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* The SVG carries no styles of its own — everything resolves through CSS
     custom properties on the page — so exporting it means baking the computed
     values in first. Without this the downloaded file renders black on black. */
  function svgForExport() {
    var src = el('#psy-svg');
    var clone = src.cloneNode(true);
    var cursor = clone.querySelector('.psy-cursor');
    if (cursor) { cursor.remove(); }

    var cs = getComputedStyle(document.documentElement);
    var tokens = ['--surface', '--surface-2', '--text', '--text-soft', '--border',
                  '--brand', '--brand-strong', '--brand-sky', '--brand-navy',
                  '--ok', '--warn', '--danger', '--font-mono', '--font-heading', '--font-body',
                  '--chart-grid', '--chart-sensible', '--chart-latent'];
    for (var i = 1; i <= 8; i++) { tokens.push('--chart-' + i); }
    var vars = tokens.map(function (t) { return t + ':' + cs.getPropertyValue(t).trim() + ';'; }).join('');

    var css = '';
    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      var rules;
      try { rules = sheet.cssRules; } catch (e) { return; }   /* cross-origin */
      Array.prototype.forEach.call(rules, function (rule) {
        if (rule.selectorText && rule.selectorText.indexOf('.psy-') === 0) {
          css += rule.cssText + '\n';
        }
      });
    });

    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', CHART.VB.w);
    clone.setAttribute('height', CHART.VB.h);
    clone.insertAdjacentHTML('afterbegin',
      '<rect width="' + CHART.VB.w + '" height="' + CHART.VB.h + '" fill="' +
      cs.getPropertyValue('--surface').trim() + '"/>');
    clone.insertAdjacentHTML('afterbegin', '<style>:root{' + vars + '}\n' + css + '</style>');
    return new XMLSerializer().serializeToString(clone);
  }

  function exportPNG() {
    var markup = svgForExport();
    var img = new Image();
    var svgBlob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(svgBlob);
    img.onload = function () {
      var scale = 2;                                   /* readable when printed */
      var canvas = document.createElement('canvas');
      canvas.width = CHART.VB.w * scale;
      canvas.height = CHART.VB.h * scale;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--surface').trim() || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) {
        if (blob) { download('psychrometric-chart.png', blob); }
      }, 'image/png');
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      TN.toast('The chart could not be turned into an image in this browser.', 'error');
    };
    img.src = url;
  }

  /* ------------------------------------------------------------- rendering */

  function renderAll() {
    syncControls();
    renderInputs();
    var solved = solve();
    var segments = segmentsOf(solved);
    if (model.activeSegment >= segments.length) { model.activeSegment = Math.max(0, segments.length - 1); }
    renderErrors(solved);
    renderChart(solved, segments);
    renderStateTable(solved);
    renderSegmentTable(segments);
    renderDetail(segments);
  }

  function syncControls() {
    el('#pressure-mode').value = model.pressureMode;
    el('#altitude').value = isFinite(model.altitude) ? model.altitude : '';
    el('#pressure').value = isFinite(model.pressure) ? model.pressure : '';
    el('#alt-field').hidden = model.pressureMode !== 'altitude';
    el('#press-field').hidden = model.pressureMode !== 'absolute';
    el('#alt-unit').textContent = isIP() ? 'ft' : 'm';
    el('#press-unit').textContent = pressUnit();
    el('#range-mode').value = model.rangeMode;
    el('#flow-unit').value = model.flowUnit;
    el('#derived-pressure').textContent =
      fix(pressFrom(pressureKPa()), 2) + ' ' + pressUnit();

    els('[data-unit-btn]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-unit-btn') === model.units ? 'true' : 'false');
    });
    Object.keys(model.layers).forEach(function (k) {
      var box = el('#layer-' + k);
      if (box) { box.checked = !!model.layers[k]; }
    });
    el('#opt-adp').checked = model.showAdp;
    el('#opt-legs').checked = model.showLegs;
  }

  /* ---------------------------------------------------------------- events */

  function findPoint(id) {
    for (var i = 0; i < model.points.length; i++) {
      if (model.points[i].id === id) { return i; }
    }
    return -1;
  }

  function wire() {
    /* Input table — delegated, because the rows are rebuilt on every render. */
    el('#points-body').addEventListener('input', function (ev) {
      var field = ev.target.getAttribute('data-f');
      if (!field) { return; }
      var row = ev.target.closest('tr');
      var i = findPoint(+row.getAttribute('data-id'));
      if (i < 0) { return; }
      var pt = model.points[i];
      if (field === 'label') { pt.label = ev.target.value; } else if (field === 'mode') {
        pt.mode = ev.target.value;
      } else {
        pt[field] = ev.target.value === '' ? NaN : num(ev.target.value);
      }
      /* A name change need not redraw the whole table and steal focus, but it
         does have to reach the chart and the results. */
      var solved = solve();
      var segments = segmentsOf(solved);
      renderErrors(solved);
      renderChart(solved, segments);
      renderStateTable(solved);
      renderSegmentTable(segments);
      renderDetail(segments);
      save();
    });

    el('#points-body').addEventListener('change', function (ev) {
      if (ev.target.getAttribute('data-f') === 'mode') { renderAll(); save(); }
    });

    el('#points-body').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) { return; }
      var row = btn.closest('tr');
      var i = findPoint(+row.getAttribute('data-id'));
      if (i < 0) { return; }
      var act = btn.getAttribute('data-act');
      if (act === 'remove') { model.points.splice(i, 1); }
      if (act === 'up' && i > 0) { model.points.splice(i - 1, 0, model.points.splice(i, 1)[0]); }
      if (act === 'down' && i < model.points.length - 1) { model.points.splice(i + 1, 0, model.points.splice(i, 1)[0]); }
      renderAll();
      save();
    });

    el('#btn-add').addEventListener('click', function () {
      model.points.push(blankPoint(model.points.length));
      renderAll();
      save();
      var rows = els('#points-body tr');
      var last = rows[rows.length - 1];
      if (last) { last.querySelector('input[data-f="db"]').focus(); }
    });

    el('#btn-clear').addEventListener('click', function () {
      model = defaultModel();
      el('#example-note').hidden = true;
      renderAll();
      save();
    });

    el('#btn-pick').addEventListener('click', function () { setPick(!pickArmed); });

    el('#example').addEventListener('change', function () {
      if (this.value) { loadExample(this.value); }
    });

    els('[data-unit-btn]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var to = btn.getAttribute('data-unit-btn');
        if (to === model.units) { return; }
        var toIP = to === 'ip';
        /* Convert what was typed so the physical states do not move. */
        model.points.forEach(function (pt) {
          if (isFinite(pt.db)) { pt.db = +(toIP ? P.ip.tempToF(pt.db) : P.ip.tempToC(pt.db)).toFixed(2); }
          if (isFinite(pt.value)) { pt.value = +convertHumidityValue(pt.value, pt.mode, toIP).toFixed(2); }
        });
        if (isFinite(model.altitude)) {
          model.altitude = Math.round(toIP ? P.ip.lengthToFt(model.altitude) : P.ip.lengthToM(model.altitude));
        }
        if (isFinite(model.pressure)) {
          model.pressure = +(toIP ? P.ip.pressureToIP(model.pressure) : model.pressure / 0.295299830714).toFixed(3);
        }
        model.units = to;
        renderAll();
        save();
      });
    });

    el('#pressure-mode').addEventListener('change', function () {
      model.pressureMode = this.value;
      renderAll();
      save();
    });
    el('#altitude').addEventListener('input', function () {
      model.altitude = this.value === '' ? 0 : num(this.value);
      el('#derived-pressure').textContent = fix(pressFrom(pressureKPa()), 2) + ' ' + pressUnit();
      var solved = solve();
      renderChart(solved, segmentsOf(solved));
      renderStateTable(solved);
      save();
    });
    el('#pressure').addEventListener('input', function () {
      model.pressure = this.value === '' ? P.P_STD : num(this.value);
      renderAll();
      save();
    });
    el('#range-mode').addEventListener('change', function () {
      model.rangeMode = this.value;
      var solved = solve();
      renderChart(solved, segmentsOf(solved));
      save();
    });
    el('#flow-unit').addEventListener('change', function () {
      var from = FLOW_UNITS[model.flowUnit];
      var to = FLOW_UNITS[this.value];
      model.points.forEach(function (pt) {
        if (isFinite(pt.flow)) { pt.flow = +to.fromM3s(from.toM3s(pt.flow)).toFixed(1); }
      });
      model.flowUnit = this.value;
      renderAll();
      save();
    });

    Object.keys(defaultModel().layers).forEach(function (k) {
      var box = el('#layer-' + k);
      if (!box) { return; }
      box.addEventListener('change', function () {
        model.layers[k] = box.checked;
        var solved = solve();
        renderChart(solved, segmentsOf(solved));
        save();
      });
    });
    el('#opt-adp').addEventListener('change', function () {
      model.showAdp = this.checked;
      var solved = solve();
      renderChart(solved, segmentsOf(solved));
      save();
    });
    el('#opt-legs').addEventListener('change', function () {
      model.showLegs = this.checked;
      var solved = solve();
      renderChart(solved, segmentsOf(solved));
      save();
    });

    el('#segments-body').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-seg-select]');
      if (!btn) { return; }
      model.activeSegment = +btn.getAttribute('data-seg-select');
      renderAll();
      save();
    });

    el('#btn-csv').addEventListener('click', function () {
      var solved = solve();
      var csv = toCSV(solved, segmentsOf(solved));
      download('psychrometric-analysis.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    });
    el('#btn-png').addEventListener('click', exportPNG);
    el('#btn-print').addEventListener('click', function () { global.print(); });
    el('#btn-mix').addEventListener('click', mixStates);

    wireChartPointer();
  }

  /* ----------------------------------------------------------------- boot */

  var booted = false;
  function boot() {
    if (booted) { return; }
    booted = true;
    model = load();
    if (!model || !model.points.length) {
      model = defaultModel();
      wire();
      loadExample('ahu-mix');
      el('#example').value = 'ahu-mix';
      return;
    }
    wire();
    renderAll();
  }

  /* The hub guard (Hub.requireLogin) decides whether the page is shown at
     all; drawing can start as soon as the DOM is there, whichever event the
     shell fires first. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  document.addEventListener('tn:ready', boot);

  /* Exposed for the test harness and for anyone wanting the numbers from a
     console without going through the UI. */
  global.TN.psychroApp = {
    solve: function () { return solve(); },
    segments: function () { return segmentsOf(solve()); },
    model: function () { return model; }
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
