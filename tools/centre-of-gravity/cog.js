/* ==========================================================================
   Thinkneering — Centre of gravity calculator
   Vanilla JS, no dependencies. All maths is exposed on TN.cog for the tests.
   ========================================================================== */

(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- units */

  var LENGTH_TO_MM = { mm: 1, cm: 10, m: 1000, 'in': 25.4 };
  var MASS_TO_KG = { kg: 1, lb: 0.45359237 };
  var GRAVITY = 9.80665;
  var STORAGE_KEY = 'tn.cog.v1';

  /* ---------------------------------------------------------------- maths */

  function num(value, fallback) {
    var n = parseFloat(value);
    return isFinite(n) ? n : (fallback || 0);
  }

  /* A block is uniform, so its own centre sits at the middle of its size.
     posMode says whether the entered position is the low corner or the centre. */
  function blockCentre(part, posMode) {
    if (posMode === 'centre') {
      return { x: part.x, y: part.y, z: part.z };
    }
    return { x: part.x + part.dx / 2, y: part.y + part.dy / 2, z: part.z + part.dz / 2 };
  }

  function blockMin(part, posMode) {
    if (posMode === 'centre') {
      return { x: part.x - part.dx / 2, y: part.y - part.dy / 2, z: part.z - part.dz / 2 };
    }
    return { x: part.x, y: part.y, z: part.z };
  }

  function computeCog(parts, posMode) {
    var total = 0;
    var sx = 0;
    var sy = 0;
    var sz = 0;
    var counted = 0;

    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p.on || !(p.w > 0)) { continue; }
      var c = blockCentre(p, posMode);
      total += p.w;
      sx += p.w * c.x;
      sy += p.w * c.y;
      sz += p.w * c.z;
      counted++;
    }

    if (total <= 0) {
      return { ok: false, weight: 0, x: 0, y: 0, z: 0, counted: counted };
    }
    return { ok: true, weight: total, x: sx / total, y: sy / total, z: sz / total, counted: counted };
  }

  /* Reactions on a set of supports, assuming a rigid body on equally stiff
     supports. The loads then lie on a plane: R(x,y) = a + b*x + c*y, chosen so
     that vertical force and both moments balance. Three supports give the exact
     statically determinate answer; more are indeterminate and this is the
     standard first-pass distribution. */
  function planeSolve(points, weight, cgx, cgy) {
    var n = points.length;
    if (n === 0) {
      return { ok: false, reason: 'no-supports' };
    }
    if (n === 1) {
      return {
        ok: true,
        loads: [weight],
        mode: 'single',
        offset: Math.sqrt(Math.pow(cgx - points[0].x, 2) + Math.pow(cgy - points[0].y, 2))
      };
    }

    var i;
    var mx = 0;
    var my = 0;
    for (i = 0; i < n; i++) { mx += points[i].x; my += points[i].y; }
    mx /= n;
    my /= n;

    var sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < n; i++) {
      var dx = points[i].x - mx;
      var dy = points[i].y - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }

    var det = sxx * syy - sxy * sxy;
    var scale = sxx * syy;
    var ex = weight * (cgx - mx);
    var ey = weight * (cgy - my);
    var loads = [];

    if (scale > 0 && det / scale > 1e-9) {
      var b = (ex * syy - ey * sxy) / det;
      var c = (ey * sxx - ex * sxy) / det;
      for (i = 0; i < n; i++) {
        loads.push(weight / n + b * (points[i].x - mx) + c * (points[i].y - my));
      }
      return { ok: true, loads: loads, mode: 'plane' };
    }

    /* Supports fall on a straight line (this also covers the two-support case),
       so only the component along that line can be balanced. */
    var ux = 0;
    var uy = 0;
    var best = 0;
    for (i = 0; i < n; i++) {
      var vx = points[i].x - mx;
      var vy = points[i].y - my;
      var len = vx * vx + vy * vy;
      if (len > best) { best = len; ux = vx; uy = vy; }
    }
    if (best <= 0) {
      /* Every support is at the same point. */
      for (i = 0; i < n; i++) { loads.push(weight / n); }
      return {
        ok: true,
        loads: loads,
        mode: 'coincident',
        offset: Math.sqrt(Math.pow(cgx - points[0].x, 2) + Math.pow(cgy - points[0].y, 2))
      };
    }
    var ulen = Math.sqrt(best);
    ux /= ulen;
    uy /= ulen;

    var stt = 0;
    var t = [];
    for (i = 0; i < n; i++) {
      var ti = (points[i].x - mx) * ux + (points[i].y - my) * uy;
      t.push(ti);
      stt += ti * ti;
    }
    var tg = (cgx - mx) * ux + (cgy - my) * uy;
    var perp = -(cgx - mx) * uy + (cgy - my) * ux;
    for (i = 0; i < n; i++) {
      loads.push(weight / n + (stt > 0 ? weight * tg * t[i] / stt : 0));
    }
    return { ok: true, loads: loads, mode: 'collinear', offset: Math.abs(perp) };
  }

  /* A support cannot pull down on the unit. If one comes out negative the unit
     has lifted off it, so drop the worst one and solve again on what is left. */
  function solveReactions(supports, weight, cgx, cgy, redistribute) {
    if (!supports.length) {
      return { ok: false, reason: 'no-supports' };
    }
    var active = supports.map(function (s, i) { return i; });
    var guard = supports.length + 1;
    var lifted = [];

    while (guard-- > 0) {
      var subset = active.map(function (i) { return supports[i]; });
      var res = planeSolve(subset, weight, cgx, cgy);
      if (!res.ok) { return res; }

      var loads = new Array(supports.length).fill(0);
      active.forEach(function (idx, k) { loads[idx] = res.loads[k]; });

      var tol = Math.max(1e-9, Math.abs(weight) * 1e-9);
      var negative = active.filter(function (i) { return loads[i] < -tol; });

      if (!negative.length || !redistribute || active.length <= 3) {
        return {
          ok: true,
          loads: loads,
          mode: res.mode,
          offset: res.offset,
          active: active.slice(),
          lifted: lifted.slice(),
          negative: negative.slice()
        };
      }

      var worst = negative.reduce(function (a, b) { return loads[a] < loads[b] ? a : b; });
      lifted.push(worst);
      active = active.filter(function (i) { return i !== worst; });
    }
    return { ok: false, reason: 'no-solution' };
  }

  /* Andrew's monotone chain hull, counter-clockwise. */
  function convexHull(points) {
    var pts = points.slice().sort(function (a, b) {
      return a.x === b.x ? a.y - b.y : a.x - b.x;
    });
    if (pts.length < 3) { return pts; }

    function cross(o, a, b) {
      return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

    var lower = [];
    var i;
    for (i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
        lower.pop();
      }
      lower.push(pts[i]);
    }
    var upper = [];
    for (i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) {
        upper.pop();
      }
      upper.push(pts[i]);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  /* Shortest distance from the centre of gravity to the edge of the support
     outline. Positive means inside, negative means the unit wants to tip. */
  function stabilityMargin(supports, cgx, cgy) {
    var hull = convexHull(supports);
    if (hull.length < 3) {
      return { ok: false, hull: hull };
    }
    var margin = Infinity;
    for (var i = 0; i < hull.length; i++) {
      var a = hull[i];
      var b = hull[(i + 1) % hull.length];
      var ex = b.x - a.x;
      var ey = b.y - a.y;
      var len = Math.sqrt(ex * ex + ey * ey);
      if (len <= 0) { continue; }
      var d = (ex * (cgy - a.y) - ey * (cgx - a.x)) / len;
      if (d < margin) { margin = d; }
    }
    return { ok: true, hull: hull, margin: margin, inside: margin >= 0 };
  }

  var api = {
    computeCog: computeCog,
    planeSolve: planeSolve,
    solveReactions: solveReactions,
    convexHull: convexHull,
    stabilityMargin: stabilityMargin,
    blockCentre: blockCentre,
    blockMin: blockMin,
    LENGTH_TO_MM: LENGTH_TO_MM,
    MASS_TO_KG: MASS_TO_KG,
    GRAVITY: GRAVITY
  };

  global.TN = global.TN || {};
  global.TN.cog = api;

  /* ---------------------------------------------------------------- presets */

  function part(name, x, y, z, dx, dy, dz, w) {
    return { name: name, x: x, y: y, z: z, dx: dx, dy: dy, dz: dz, w: w, on: true };
  }

  var PRESETS = {
    blank: function () {
      return {
        envelope: { dx: 2000, dy: 1000, dz: 1000 },
        /* Sat over the centroid of the four supports, so an empty project opens
           with an even, uneventful load split rather than an uplift warning. */
        parts: [part('Block 1', 600, 200, 0, 800, 600, 400, 100)],
        supports: [
          { name: 'S1', x: 100, y: 100 },
          { name: 'S2', x: 1900, y: 100 },
          { name: 'S3', x: 1900, y: 900 },
          { name: 'S4', x: 100, y: 900 }
        ]
      };
    },
    /* Laid out from the general arrangement drawing. Dimensions follow the
       drawing; weights are indicative placeholders and must be replaced with
       certified figures before use. */
    chiller: function () {
      var supports = [];
      [540, 2700, 4860, 7020, 9180].forEach(function (x, i) {
        supports.push({ name: 'A' + (i + 1), x: x, y: 116 });
        supports.push({ name: 'B' + (i + 1), x: x, y: 2116 });
      });
      return {
        envelope: { dx: 10328, dy: 2232, dz: 2400 },
        parts: [
          part('Base frame', 0, 0, 0, 9720, 2232, 260, 1800),
          part('Compressor 1', 300, 180, 260, 1200, 780, 900, 680),
          part('Compressor 2', 300, 1272, 260, 1200, 780, 900, 680),
          part('Evaporator', 1809, 666, 280, 3430, 900, 700, 1450),
          part('Pipework and headers', 5300, 900, 300, 3200, 420, 700, 520),
          part('Condenser coils', 540, 66, 1000, 8060, 2100, 1000, 2800),
          part('Fan deck', 540, 216, 2000, 8060, 1800, 250, 660),
          part('Control panel', 8760, 700, 280, 1300, 800, 1400, 420)
        ],
        supports: supports
      };
    },
    ahu: function () {
      return {
        envelope: { dx: 6000, dy: 2200, dz: 2000 },
        parts: [
          part('Base frame', 0, 0, 0, 6000, 2200, 200, 620),
          part('Mixing section', 0, 0, 200, 1200, 2200, 1800, 380),
          part('Filter section', 1200, 0, 200, 900, 2200, 1800, 290),
          part('Cooling coil', 2100, 0, 200, 1100, 2200, 1800, 720),
          part('Supply fan', 3200, 300, 300, 1400, 1500, 1400, 640),
          part('Attenuator', 4600, 0, 200, 1400, 2200, 1800, 310)
        ],
        supports: [
          { name: 'S1', x: 200, y: 150 },
          { name: 'S2', x: 3000, y: 150 },
          { name: 'S3', x: 5800, y: 150 },
          { name: 'S4', x: 200, y: 2050 },
          { name: 'S5', x: 3000, y: 2050 },
          { name: 'S6', x: 5800, y: 2050 }
        ]
      };
    }
  };

  /* ---------------------------------------------------------------- app */

  function boot() {
    var root = document.querySelector('[data-tool="centre-of-gravity"]');
    if (!root) { return; }

    var uid = 0;
    var state = {
      lengthUnit: 'mm',
      massUnit: 'kg',
      posMode: 'corner',
      envelope: { dx: 10328, dy: 2232, dz: 2400 },
      parts: [],
      supports: [],
      capacity: null,
      redistribute: true,
      view: { envelope: true, labels: true, ortho: false }
    };

    var cam = { az: -0.95, el: 0.42, dist: 20000, panX: 0, panY: 0, target: { x: 0, y: 0, z: 0 }, radius: 5000 };

    var el = {
      partsBody: document.getElementById('parts-body'),
      partsEmpty: document.getElementById('parts-empty'),
      supportsBody: document.getElementById('supports-body'),
      supportsEmpty: document.getElementById('supports-empty'),
      loadsBody: document.getElementById('loads-body'),
      loadsEmpty: document.getElementById('loads-empty'),
      notices: document.getElementById('notices'),
      stability: document.getElementById('stability'),
      canvas: document.getElementById('scene')
    };
    var ctx = el.canvas.getContext('2d');

    /* ------------------------------------------------------------ helpers */

    function lengthLabel() { return state.lengthUnit; }
    function massLabel() { return state.massUnit; }

    function fmt(value, digits) {
      if (!isFinite(value)) { return '—'; }
      return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits === undefined ? 1 : digits
      });
    }

    /* Millimetres need one decimal; metres and inches need more to stay useful. */
    function lengthDigits() {
      return { mm: 1, cm: 2, m: 3, 'in': 2 }[state.lengthUnit] || 1;
    }

    function fmtLen(value) {
      return fmt(value, lengthDigits());
    }

    function toKN(mass) {
      return mass * MASS_TO_KG[state.massUnit] * GRAVITY / 1000;
    }

    function nextId() { uid += 1; return 'r' + uid; }

    /* Blocks are coloured from the --chart-1..8 tokens already in global.css,
       which have their own dark-mode values, so nothing new is introduced. */
    function readTokens() {
      var cs = getComputedStyle(document.documentElement);
      function token(name, fallback) {
        var v = cs.getPropertyValue(name);
        v = v ? v.trim() : '';
        return v || fallback;
      }
      var chart = [];
      for (var i = 1; i <= 8; i++) {
        var swatch = token('--chart-' + i, '');
        if (swatch) { chart.push(swatch); }
      }

      return {
        chart: chart,
        surface: token('--color-surface', '#ffffff'),
        bg: token('--color-bg', '#f7f8fa'),
        text: token('--color-text', '#14161a'),
        muted: token('--color-text-muted', '#5c6270'),
        border: token('--color-border', '#e3e5ea'),
        primary: token('--color-primary', '#2f5fff'),
        accent: token('--color-accent', '#00c2a8'),
        danger: token('--color-danger', '#e0432f'),
        success: token('--color-success', '#1fa971'),
        warning: token('--color-warning', '#e0a100'),
        font: token('--font-body', "'Inter', sans-serif")
      };
    }

    function hexToHsl(hex) {
      var h = String(hex).trim().replace('#', '');
      if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
      if (!/^[0-9a-fA-F]{6}$/.test(h)) { return null; }
      var r = parseInt(h.slice(0, 2), 16) / 255;
      var g = parseInt(h.slice(2, 4), 16) / 255;
      var b = parseInt(h.slice(4, 6), 16) / 255;
      var max = Math.max(r, g, b);
      var min = Math.min(r, g, b);
      var l = (max + min) / 2;
      var s = 0;
      var hue = 0;
      if (max !== min) {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) { hue = ((g - b) / d + (g < b ? 6 : 0)); }
        else if (max === g) { hue = (b - r) / d + 2; }
        else { hue = (r - g) / d + 4; }
        hue *= 60;
      }
      return { h: hue, s: s * 100, l: l * 100 };
    }

    function palette(count, tokens) {
      var source = tokens.chart.length ? tokens.chart : [tokens.primary, tokens.accent];
      var out = [];
      for (var i = 0; i < count; i++) {
        out.push(hexToHsl(source[i % source.length]) || { h: 226, s: 100, l: 59 });
      }
      return out;
    }

    function hsl(colour, shade, alpha) {
      var l = Math.max(8, Math.min(92, colour.l * shade));
      if (alpha === undefined || alpha >= 1) {
        return 'hsl(' + colour.h.toFixed(1) + ', ' + colour.s.toFixed(1) + '%, ' + l.toFixed(1) + '%)';
      }
      return 'hsla(' + colour.h.toFixed(1) + ', ' + colour.s.toFixed(1) + '%, ' + l.toFixed(1) + '%, ' + alpha + ')';
    }

    /* ------------------------------------------------------------ state io */

    function applyProject(data) {
      state.envelope = {
        dx: num(data.envelope && data.envelope.dx, 0),
        dy: num(data.envelope && data.envelope.dy, 0),
        dz: num(data.envelope && data.envelope.dz, 0)
      };
      state.parts = (data.parts || []).map(function (p) {
        return {
          id: nextId(),
          name: String(p.name || 'Block'),
          x: num(p.x), y: num(p.y), z: num(p.z),
          dx: num(p.dx), dy: num(p.dy), dz: num(p.dz),
          w: num(p.w),
          on: p.on !== false
        };
      });
      state.supports = (data.supports || []).map(function (s, i) {
        return { id: nextId(), name: String(s.name || 'S' + (i + 1)), x: num(s.x), y: num(s.y) };
      });
      if (data.lengthUnit && LENGTH_TO_MM[data.lengthUnit]) { state.lengthUnit = data.lengthUnit; }
      if (data.massUnit && MASS_TO_KG[data.massUnit]) { state.massUnit = data.massUnit; }
      if (data.posMode === 'centre' || data.posMode === 'corner') { state.posMode = data.posMode; }
      if (data.capacity !== undefined && data.capacity !== null && data.capacity !== '') {
        state.capacity = num(data.capacity, null);
      } else {
        state.capacity = null;
      }
    }

    function serialise() {
      return {
        tool: 'centre-of-gravity',
        version: 1,
        lengthUnit: state.lengthUnit,
        massUnit: state.massUnit,
        posMode: state.posMode,
        capacity: state.capacity,
        envelope: state.envelope,
        parts: state.parts.map(function (p) {
          return { name: p.name, x: p.x, y: p.y, z: p.z, dx: p.dx, dy: p.dy, dz: p.dz, w: p.w, on: p.on };
        }),
        supports: state.supports.map(function (s) {
          return { name: s.name, x: s.x, y: s.y };
        })
      };
    }

    function save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serialise()));
      } catch (err) {
        /* Storage can be full or blocked; the tool still works without it. */
      }
    }

    function restore() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) { return false; }
        applyProject(JSON.parse(raw));
        return true;
      } catch (err) {
        return false;
      }
    }

    /* ------------------------------------------------------------ rows */

    function cell(input, numeric) {
      var td = document.createElement('td');
      if (numeric) { td.className = 'num'; }
      td.appendChild(input);
      return td;
    }

    function numberInput(value, field, ariaLabel) {
      var input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.inputMode = 'decimal';
      input.value = value;
      input.dataset.field = field;
      input.setAttribute('aria-label', ariaLabel);
      return input;
    }

    function textInput(value, ariaLabel) {
      var input = document.createElement('input');
      input.type = 'text';
      input.value = value;
      input.dataset.field = 'name';
      input.setAttribute('aria-label', ariaLabel);
      return input;
    }

    function removeButton(ariaLabel) {
      var td = document.createElement('td');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--quiet btn--sm';
      button.dataset.action = 'delete';
      button.innerHTML = global.TN ? global.TN.icon('trash', 18) : '&times;';
      button.setAttribute('aria-label', ariaLabel);
      td.appendChild(button);
      return td;
    }

    function renderParts() {
      var tokens = readTokens();
      var colours = palette(Math.max(state.parts.length, 1), tokens);
      el.partsBody.textContent = '';
      el.partsEmpty.hidden = state.parts.length > 0;

      state.parts.forEach(function (p, index) {
        var tr = document.createElement('tr');
        tr.dataset.id = p.id;
        tr.dataset.off = p.on ? 'false' : 'true';

        var includeTd = document.createElement('td');
        var include = document.createElement('span');
        include.className = 'cog-include';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = p.on;
        box.dataset.field = 'on';
        box.setAttribute('aria-label', 'Include ' + p.name + ' in the calculation');
        var swatch = document.createElement('span');
        swatch.className = 'cog-swatch';
        swatch.style.background = hsl(colours[index], 1);
        swatch.setAttribute('aria-hidden', 'true');
        include.appendChild(box);
        include.appendChild(swatch);
        includeTd.appendChild(include);
        tr.appendChild(includeTd);

        tr.appendChild(cell(textInput(p.name, 'Name of block ' + (index + 1)), false));

        [['x', 'X'], ['y', 'Y'], ['z', 'Z'],
         ['dx', 'Size X'], ['dy', 'Size Y'], ['dz', 'Size Z']].forEach(function (f) {
          tr.appendChild(cell(
            numberInput(p[f[0]], f[0], f[1] + ' of ' + p.name + ' in ' + lengthLabel()),
            true
          ));
        });
        tr.appendChild(cell(
          numberInput(p.w, 'w', 'Weight of ' + p.name + ' in ' + massLabel()),
          true
        ));
        tr.appendChild(removeButton('Remove ' + p.name));

        el.partsBody.appendChild(tr);
      });
    }

    function renderSupports() {
      el.supportsBody.textContent = '';
      el.supportsEmpty.hidden = state.supports.length > 0;

      state.supports.forEach(function (s, index) {
        var tr = document.createElement('tr');
        tr.dataset.id = s.id;
        tr.appendChild(cell(textInput(s.name, 'Name of support ' + (index + 1)), false));
        tr.appendChild(cell(
          numberInput(s.x, 'x', 'X position of ' + s.name + ' in ' + lengthLabel()), true));
        tr.appendChild(cell(
          numberInput(s.y, 'y', 'Y position of ' + s.name + ' in ' + lengthLabel()), true));
        tr.appendChild(removeButton('Remove ' + s.name));
        el.supportsBody.appendChild(tr);
      });
    }

    /* ------------------------------------------------------------ results */

    var lastResult = null;

    function recompute(skipDraw) {
      var cg = computeCog(state.parts, state.posMode);
      var notices = [];

      document.getElementById('s-weight').textContent = cg.ok ? fmt(cg.weight, 1) + ' ' + massLabel() : '—';
      document.getElementById('s-weight-sub').textContent = cg.ok
        ? fmt(toKN(cg.weight), 2) + ' kN over ' + cg.counted + ' block' + (cg.counted === 1 ? '' : 's')
        : 'Add a block with a weight';

      var axes = [['x', 's-cgx', state.envelope.dx], ['y', 's-cgy', state.envelope.dy], ['z', 's-cgz', state.envelope.dz]];
      axes.forEach(function (a) {
        var valueEl = document.getElementById(a[1]);
        var subEl = document.getElementById(a[1] + '-sub');
        if (!cg.ok) {
          valueEl.textContent = '—';
          subEl.textContent = '\u00a0';
          return;
        }
        valueEl.textContent = fmtLen(cg[a[0]]) + ' ' + lengthLabel();
        if (a[2] > 0) {
          var offset = cg[a[0]] - a[2] / 2;
          subEl.textContent = (offset >= 0 ? '+' : '\u2212') + fmtLen(Math.abs(offset)) + ' '
            + lengthLabel() + ' from the middle';
        } else {
          subEl.textContent = '\u00a0';
        }
      });

      var supports = state.supports.map(function (s) { return { x: s.x, y: s.y }; });
      var reactions = null;
      var stability = null;

      el.loadsBody.textContent = '';

      if (cg.ok && supports.length) {
        reactions = solveReactions(supports, cg.weight, cg.x, cg.y, state.redistribute);
        stability = stabilityMargin(supports, cg.x, cg.y);
      }

      if (reactions && reactions.ok) {
        el.loadsEmpty.hidden = true;
        var maxLoad = Math.max.apply(null, reactions.loads);
        state.supports.forEach(function (s, i) {
          var load = reactions.loads[i];
          var tr = document.createElement('tr');

          tr.appendChild(readCell(s.name, false));
          tr.appendChild(readCell(fmtLen(s.x), true));
          tr.appendChild(readCell(fmtLen(s.y), true));
          tr.appendChild(readCell(fmt(load, 1), true));
          tr.appendChild(readCell(fmt(toKN(load), 2), true));
          tr.appendChild(readCell(cg.weight > 0 ? fmt(load / cg.weight * 100, 1) + '%' : '—', true));

          var chip = document.createElement('span');
          chip.className = 'chip';
          if (reactions.lifted.indexOf(i) !== -1) {
            chip.className += ' chip--auth';
            chip.textContent = 'Lifts off';
          } else if (load < 0) {
            chip.className += ' chip--danger';
            chip.textContent = 'Uplift';
          } else if (state.capacity !== null && state.capacity > 0 && load > state.capacity) {
            chip.className += ' chip--danger';
            chip.textContent = 'Over capacity';
          } else if (Math.abs(load - maxLoad) < 1e-6) {
            chip.className += ' chip--restricted';
            chip.textContent = 'Highest';
          } else {
            chip.textContent = 'Carrying';
          }
          var statusTd = document.createElement('td');
          statusTd.appendChild(chip);
          tr.appendChild(statusTd);

          el.loadsBody.appendChild(tr);
        });

        if (reactions.mode === 'single') {
          notices.push('With a single support the unit only balances if the support sits under the centre of gravity. '
            + 'It is ' + fmtLen(reactions.offset) + ' ' + lengthLabel() + ' away.');
        }
        if (reactions.mode === 'collinear' && reactions.offset > 1e-6) {
          notices.push('All supports lie on one line and the centre of gravity is '
            + fmtLen(reactions.offset) + ' ' + lengthLabel()
            + ' off that line, so the unit will tip sideways without extra restraint.');
        }
        if (reactions.lifted.length) {
          notices.push(reactions.lifted.length + ' support'
            + (reactions.lifted.length === 1 ? '' : 's')
            + ' carry no load and were left out of the distribution.');
        }
        if (reactions.negative.length) {
          notices.push('Some supports are still in uplift. Check the layout, or move weight towards the middle of the support pattern.');
        }
        if (state.capacity !== null && state.capacity > 0 && maxLoad > state.capacity) {
          notices.push('The heaviest support carries ' + fmt(maxLoad, 1) + ' ' + massLabel()
            + ', above the ' + fmt(state.capacity, 1) + ' ' + massLabel() + ' capacity you set.');
        }
      } else {
        el.loadsEmpty.hidden = false;
        el.loadsEmpty.textContent = cg.ok
          ? 'Add support points to see the load on each one.'
          : 'Add a block with a weight to see support loads.';
      }

      if (stability && stability.ok) {
        el.stability.textContent = stability.inside
          ? 'The centre of gravity sits inside the support outline, ' + fmtLen(stability.margin) + ' '
            + lengthLabel() + ' clear of the nearest edge.'
          : 'The centre of gravity falls outside the support outline by ' + fmtLen(Math.abs(stability.margin))
            + ' ' + lengthLabel() + '. The unit will tip.';
        if (!stability.inside) {
          notices.push('The centre of gravity is outside the support outline.');
        }
      } else if (cg.ok && supports.length) {
        el.stability.textContent = 'Add at least three supports that are not in a straight line to check tipping.';
      } else {
        el.stability.textContent = 'Add blocks and at least three supports to check tipping.';
      }

      if (notices.length) {
        el.notices.hidden = false;
        el.notices.textContent = '';
        var ul = document.createElement('ul');
        notices.forEach(function (t) {
          var li = document.createElement('li');
          li.textContent = t;
          ul.appendChild(li);
        });
        el.notices.appendChild(ul);
      } else {
        el.notices.hidden = true;
        el.notices.textContent = '';
      }

      lastResult = { cg: cg, reactions: reactions, stability: stability };
      if (!skipDraw) { draw(); }
      save();
    }

    function readCell(value, numeric) {
      var td = document.createElement('td');
      if (numeric) { td.className = 'num'; }
      td.textContent = value;
      return td;
    }

    /* ------------------------------------------------------------ 3D view */

    function sceneBounds() {
      var min = { x: Infinity, y: Infinity, z: Infinity };
      var max = { x: -Infinity, y: -Infinity, z: -Infinity };

      function add(x, y, z) {
        if (x < min.x) { min.x = x; }
        if (y < min.y) { min.y = y; }
        if (z < min.z) { min.z = z; }
        if (x > max.x) { max.x = x; }
        if (y > max.y) { max.y = y; }
        if (z > max.z) { max.z = z; }
      }

      if (state.envelope.dx > 0 || state.envelope.dy > 0 || state.envelope.dz > 0) {
        add(0, 0, 0);
        add(state.envelope.dx, state.envelope.dy, state.envelope.dz);
      }
      state.parts.forEach(function (p) {
        var lo = blockMin(p, state.posMode);
        add(lo.x, lo.y, lo.z);
        add(lo.x + p.dx, lo.y + p.dy, lo.z + p.dz);
      });
      state.supports.forEach(function (s) { add(s.x, s.y, 0); });

      if (!isFinite(min.x)) {
        min = { x: 0, y: 0, z: 0 };
        max = { x: 1000, y: 1000, z: 1000 };
      }
      return { min: min, max: max };
    }

    function fitView() {
      var b = sceneBounds();
      cam.target = {
        x: (b.min.x + b.max.x) / 2,
        y: (b.min.y + b.max.y) / 2,
        z: (b.min.z + b.max.z) / 2
      };
      var dx = b.max.x - b.min.x;
      var dy = b.max.y - b.min.y;
      var dz = b.max.z - b.min.z;
      cam.radius = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2);
      cam.dist = cam.radius * 3.2;
      cam.panX = 0;
      cam.panY = 0;
      refineFit(b);
    }

    /* A bounding sphere leaves a long, flat unit looking tiny in an elevation,
       so close in until the projected corners nearly fill the canvas. */
    function refineFit(bounds) {
      var wrap = el.canvas.parentNode;
      var w = Math.max(1, wrap.clientWidth);
      var h = Math.max(1, wrap.clientHeight);
      var corners = boxCorners(bounds.min, {
        dx: bounds.max.x - bounds.min.x,
        dy: bounds.max.y - bounds.min.y,
        dz: bounds.max.z - bounds.min.z
      });

      for (var pass = 0; pass < 6; pass++) {
        var project = makeProjector(w, h);
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        var visible = true;
        for (var i = 0; i < corners.length; i++) {
          var p = project(corners[i]);
          if (!p.ok) { visible = false; break; }
          if (p.x < minX) { minX = p.x; }
          if (p.y < minY) { minY = p.y; }
          if (p.x > maxX) { maxX = p.x; }
          if (p.y > maxY) { maxY = p.y; }
        }
        if (!visible || !isFinite(minX)) { cam.dist *= 1.6; continue; }

        var ratio = Math.max((maxX - minX) / (w * 0.84), (maxY - minY) / (h * 0.80));
        if (!isFinite(ratio) || ratio <= 0) { break; }
        if (Math.abs(ratio - 1) < 0.02) { break; }
        cam.dist = Math.max(cam.radius * 0.4, cam.dist * ratio);
      }
    }

    function cameraBasis() {
      var ce = Math.cos(cam.el);
      var se = Math.sin(cam.el);
      var ca = Math.cos(cam.az);
      var sa = Math.sin(cam.az);
      var forward = { x: ce * ca, y: ce * sa, z: se };
      var eye = {
        x: cam.target.x + cam.dist * forward.x,
        y: cam.target.y + cam.dist * forward.y,
        z: cam.target.z + cam.dist * forward.z
      };
      var right = { x: -sa, y: ca, z: 0 };
      var up = {
        x: forward.y * right.z - forward.z * right.y,
        y: forward.z * right.x - forward.x * right.z,
        z: forward.x * right.y - forward.y * right.x
      };
      return { eye: eye, right: right, up: up, forward: forward };
    }

    function makeProjector(width, height) {
      var basis = cameraBasis();
      var fov = 35 * Math.PI / 180;
      var focal = (height / 2) / Math.tan(fov / 2);
      var orthoScale = Math.min(width, height) / (cam.dist / 1.6);
      var cx = width / 2 + cam.panX;
      var cy = height / 2 + cam.panY;

      return function (p) {
        var dx = p.x - basis.eye.x;
        var dy = p.y - basis.eye.y;
        var dz = p.z - basis.eye.z;
        var vx = dx * basis.right.x + dy * basis.right.y + dz * basis.right.z;
        var vy = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z;
        var depth = -(dx * basis.forward.x + dy * basis.forward.y + dz * basis.forward.z);

        if (state.view.ortho) {
          return { x: cx + vx * orthoScale, y: cy - vy * orthoScale, depth: depth, ok: true };
        }
        if (depth < 1e-3) {
          return { x: cx, y: cy, depth: depth, ok: false };
        }
        return { x: cx + focal * vx / depth, y: cy - focal * vy / depth, depth: depth, ok: true };
      };
    }

    var BOX_FACES = [
      { idx: [0, 1, 2, 3], n: [0, 0, -1] },
      { idx: [4, 7, 6, 5], n: [0, 0, 1] },
      { idx: [0, 4, 5, 1], n: [0, -1, 0] },
      { idx: [3, 2, 6, 7], n: [0, 1, 0] },
      { idx: [0, 3, 7, 4], n: [-1, 0, 0] },
      { idx: [1, 5, 6, 2], n: [1, 0, 0] }
    ];

    function boxCorners(lo, size) {
      var x0 = lo.x, y0 = lo.y, z0 = lo.z;
      var x1 = lo.x + size.dx, y1 = lo.y + size.dy, z1 = lo.z + size.dz;
      return [
        { x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 },
        { x: x1, y: y1, z: z0 }, { x: x0, y: y1, z: z0 },
        { x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 },
        { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }
      ];
    }

    function resizeCanvas() {
      var wrap = el.canvas.parentNode;
      var dpr = global.devicePixelRatio || 1;
      var w = Math.max(1, wrap.clientWidth);
      var h = Math.max(1, wrap.clientHeight);
      el.canvas.width = Math.round(w * dpr);
      el.canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: w, h: h };
    }

    function draw() {
      var size = resizeCanvas();
      var tokens = readTokens();
      var project = makeProjector(size.w, size.h);

      labelBoxes = [];
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.fillStyle = tokens.surface;
      ctx.fillRect(0, 0, size.w, size.h);

      var bounds = sceneBounds();
      var baseZ = Math.min(0, bounds.min.z);

      drawGround(project, bounds, baseZ, tokens);

      var colours = palette(Math.max(state.parts.length, 1), tokens);
      var light = { x: 0.35, y: -0.45, z: 0.82 };
      var faces = [];
      var basis = cameraBasis();

      state.parts.forEach(function (p, index) {
        if (!p.on) { return; }
        if (p.dx <= 0 && p.dy <= 0 && p.dz <= 0) { return; }
        var lo = blockMin(p, state.posMode);
        var corners = boxCorners(lo, { dx: p.dx, dy: p.dy, dz: p.dz });
        var projected = corners.map(project);

        BOX_FACES.forEach(function (face) {
          var pts = face.idx.map(function (i) { return projected[i]; });
          if (pts.some(function (pt) { return !pt.ok; })) { return; }

          var mid = { x: 0, y: 0, z: 0 };
          face.idx.forEach(function (i) {
            mid.x += corners[i].x / 4;
            mid.y += corners[i].y / 4;
            mid.z += corners[i].z / 4;
          });
          var toEye = {
            x: basis.eye.x - mid.x,
            y: basis.eye.y - mid.y,
            z: basis.eye.z - mid.z
          };
          if (face.n[0] * toEye.x + face.n[1] * toEye.y + face.n[2] * toEye.z <= 0) { return; }

          var lambert = Math.max(0, face.n[0] * light.x + face.n[1] * light.y + face.n[2] * light.z);
          var shade = 0.72 + 0.5 * lambert;
          var depth = (pts[0].depth + pts[1].depth + pts[2].depth + pts[3].depth) / 4;
          faces.push({ pts: pts, depth: depth, fill: hsl(colours[index], shade), part: p, mid: mid });
        });
      });

      faces.sort(function (a, b) { return b.depth - a.depth; });
      ctx.lineJoin = 'round';
      faces.forEach(function (f) {
        ctx.beginPath();
        ctx.moveTo(f.pts[0].x, f.pts[0].y);
        for (var i = 1; i < f.pts.length; i++) { ctx.lineTo(f.pts[i].x, f.pts[i].y); }
        ctx.closePath();
        ctx.fillStyle = f.fill;
        ctx.fill();
        ctx.strokeStyle = hsl({ h: 0, s: 0, l: 100 }, 0.001, 0.18);
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      if (state.view.envelope && (state.envelope.dx > 0 || state.envelope.dy > 0 || state.envelope.dz > 0)) {
        drawWireBox(project,
          { x: 0, y: 0, z: 0 },
          { dx: state.envelope.dx, dy: state.envelope.dy, dz: state.envelope.dz },
          tokens.muted, 1);
      }

      drawSupports(project, tokens);
      drawCog(project, baseZ, tokens);
      if (state.view.labels) { drawPartLabels(project, tokens); }
      drawAxes(size, tokens);
    }

    function drawGround(project, bounds, baseZ, tokens) {
      var pad = Math.max(1, cam.radius * 0.15);
      var x0 = bounds.min.x - pad;
      var x1 = bounds.max.x + pad;
      var y0 = bounds.min.y - pad;
      var y1 = bounds.max.y + pad;
      var span = Math.max(x1 - x0, y1 - y0);
      var step = Math.pow(10, Math.round(Math.log(span / 8) / Math.LN10));
      if (!isFinite(step) || step <= 0) { return; }

      ctx.strokeStyle = tokens.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      var x, y, a, b;
      for (x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        a = project({ x: x, y: y0, z: baseZ });
        b = project({ x: x, y: y1, z: baseZ });
        if (a.ok && b.ok) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      }
      for (y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        a = project({ x: x0, y: y, z: baseZ });
        b = project({ x: x1, y: y, z: baseZ });
        if (a.ok && b.ok) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      }
      ctx.stroke();
    }

    var WIRE_EDGES = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];

    function drawWireBox(project, lo, size, colour, width) {
      var corners = boxCorners(lo, size).map(project);
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      WIRE_EDGES.forEach(function (e) {
        var a = corners[e[0]];
        var b = corners[e[1]];
        if (a.ok && b.ok) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function fontFor(px, tokens) {
      return px + 'px ' + tokens.font;
    }

    /* Labels are placed in order of usefulness: support loads, then the centre
       of gravity, then block names. Anything that would land on top of a label
       already drawn is dropped rather than overprinted. */
    var labelBoxes = [];

    function claimLabel(text, x, midY, align, size) {
      var width = ctx.measureText ? ctx.measureText(text).width : text.length * size * 0.55;
      var half = size / 2 + 2;
      var left = align === 'center' ? x - width / 2 : (align === 'right' ? x - width : x);
      var box = { x0: left - 2, y0: midY - half, x1: left + width + 2, y1: midY + half };

      for (var i = 0; i < labelBoxes.length; i++) {
        var b = labelBoxes[i];
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) { return false; }
      }
      labelBoxes.push(box);
      return true;
    }

    function drawSupports(project, tokens) {
      if (!state.supports.length) { return; }
      var loads = lastResult && lastResult.reactions && lastResult.reactions.ok
        ? lastResult.reactions.loads
        : null;

      ctx.font = fontFor(11, tokens);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      var pending = [];

      state.supports.forEach(function (s, i) {
        var p = project({ x: s.x, y: s.y, z: 0 });
        if (!p.ok) { return; }
        var load = loads ? loads[i] : null;
        var colour = tokens.primary;
        if (load !== null && load < -1e-6) { colour = tokens.danger; }
        else if (load !== null && Math.abs(load) < 1e-6) { colour = tokens.warning; }

        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.strokeStyle = tokens.surface;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        if (state.view.labels) {
          var text = s.name;
          if (load !== null) { text += '  ' + fmt(load, 0) + ' ' + massLabel(); }
          pending.push({ text: text, x: p.x, y: p.y, depth: p.depth });
        }
      });

      /* Nearest labels claim their space first, so a support hidden behind
         another one gives up its label rather than covering the visible one. */
      pending.sort(function (a, b) { return a.depth - b.depth; });
      ctx.fillStyle = tokens.muted;
      pending.forEach(function (label) {
        if (claimLabel(label.text, label.x, label.y + 14, 'center', 11)) {
          ctx.fillText(label.text, label.x, label.y + 8);
        }
      });
    }

    function drawCog(project, baseZ, tokens) {
      if (!lastResult || !lastResult.cg.ok) { return; }
      var cg = lastResult.cg;
      var top = project({ x: cg.x, y: cg.y, z: cg.z });
      var foot = project({ x: cg.x, y: cg.y, z: baseZ });
      if (!top.ok) { return; }

      if (foot.ok) {
        ctx.strokeStyle = tokens.danger;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(foot.x, foot.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(foot.x, foot.y, 4, 0, Math.PI * 2);
        ctx.strokeStyle = tokens.danger;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      /* Quartered target marker, the usual way a centre of gravity is shown. */
      var r = 9;
      ctx.save();
      ctx.beginPath();
      ctx.arc(top.x, top.y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = tokens.surface;
      ctx.fillRect(top.x - r, top.y - r, r * 2, r * 2);
      ctx.fillStyle = tokens.danger;
      ctx.fillRect(top.x - r, top.y - r, r, r);
      ctx.fillRect(top.x, top.y, r, r);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(top.x, top.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = tokens.danger;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (state.view.labels) {
        ctx.font = fontFor(12, tokens);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = tokens.text;
        if (claimLabel('CG', top.x + r + 4, top.y, 'left', 12)) {
          ctx.fillText('CG', top.x + r + 4, top.y);
        }
      }
    }

    function drawPartLabels(project, tokens) {
      ctx.font = fontFor(11, tokens);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = tokens.text;
      var pending = [];
      state.parts.forEach(function (p) {
        if (!p.on || !p.name) { return; }
        var c = blockCentre(p, state.posMode);
        var top = project({ x: c.x, y: c.y, z: blockMin(p, state.posMode).z + p.dz });
        if (!top.ok) { return; }
        pending.push({ name: p.name, x: top.x, y: top.y, depth: top.depth });
      });

      /* Same rule as the supports: the block nearest the camera keeps its name. */
      pending.sort(function (a, b) { return a.depth - b.depth; });
      pending.forEach(function (label) {
        if (!claimLabel(label.name, label.x, label.y, 'center', 11)) { return; }
        ctx.strokeStyle = tokens.surface;
        ctx.lineWidth = 3;
        ctx.strokeText(label.name, label.x, label.y);
        ctx.fillText(label.name, label.x, label.y);
      });
    }

    /* Axis triad, drawn in the corner using the current camera rotation. */
    function drawAxes(size, tokens) {
      var basis = cameraBasis();
      var ox = 40;
      var oy = size.h - 40;
      var len = 26;
      var axes = [
        { v: { x: 1, y: 0, z: 0 }, label: 'X', colour: tokens.danger },
        { v: { x: 0, y: 1, z: 0 }, label: 'Y', colour: tokens.success },
        { v: { x: 0, y: 0, z: 1 }, label: 'Z', colour: tokens.primary }
      ];
      ctx.font = fontFor(11, tokens);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      axes.forEach(function (a) {
        var sx = a.v.x * basis.right.x + a.v.y * basis.right.y + a.v.z * basis.right.z;
        var sy = a.v.x * basis.up.x + a.v.y * basis.up.y + a.v.z * basis.up.z;
        var ex = ox + sx * len;
        var ey = oy - sy * len;
        ctx.strokeStyle = a.colour;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.fillStyle = a.colour;
        ctx.fillText(a.label, ox + sx * (len + 9), oy - sy * (len + 9));
      });
    }

    /* ------------------------------------------------------------ events */

    function onTableInput(list, body, event) {
      var target = event.target;
      var field = target.dataset.field;
      if (!field) { return; }
      var row = target.closest('tr');
      if (!row) { return; }
      var item = list.find(function (r) { return r.id === row.dataset.id; });
      if (!item) { return; }

      if (field === 'name') {
        item.name = target.value;
      } else if (field === 'on') {
        item.on = target.checked;
        row.dataset.off = item.on ? 'false' : 'true';
      } else {
        item[field] = num(target.value, 0);
      }
      recompute();
    }

    function onTableClick(list, event, rerender) {
      var button = event.target.closest('button[data-action]');
      if (!button) { return; }
      var row = button.closest('tr');
      if (!row) { return; }
      var index = list.findIndex(function (r) { return r.id === row.dataset.id; });
      if (index < 0) { return; }

      list.splice(index, 1);
      rerender();
      recompute();
    }

    el.partsBody.addEventListener('input', function (e) { onTableInput(state.parts, el.partsBody, e); });
    el.partsBody.addEventListener('change', function (e) { onTableInput(state.parts, el.partsBody, e); });
    el.partsBody.addEventListener('click', function (e) {
      onTableClick(state.parts, e, renderParts);
    });

    el.supportsBody.addEventListener('input', function (e) { onTableInput(state.supports, el.supportsBody, e); });
    el.supportsBody.addEventListener('click', function (e) {
      onTableClick(state.supports, e, renderSupports);
    });

    document.getElementById('btn-add-part').addEventListener('click', function () {
      state.parts.push({
        id: nextId(),
        name: 'Block ' + (state.parts.length + 1),
        x: 0, y: 0, z: 0, dx: 500, dy: 500, dz: 500, w: 100, on: true
      });
      renderParts();
      recompute();
    });

    document.getElementById('btn-clear-parts').addEventListener('click', function () {
      if (!state.parts.length || !confirm('Remove every block?')) { return; }
      state.parts = [];
      renderParts();
      recompute();
    });

    document.getElementById('btn-add-support').addEventListener('click', function () {
      state.supports.push({ id: nextId(), name: 'S' + (state.supports.length + 1), x: 0, y: 0 });
      renderSupports();
      recompute();
    });

    document.getElementById('btn-clear-supports').addEventListener('click', function () {
      if (!state.supports.length || !confirm('Remove every support?')) { return; }
      state.supports = [];
      renderSupports();
      recompute();
    });

    document.getElementById('btn-generate').addEventListener('click', function () {
      var nx = Math.max(1, Math.round(num(document.getElementById('gen-nx').value, 1)));
      var ny = Math.max(1, Math.round(num(document.getElementById('gen-ny').value, 1)));
      var sx = num(document.getElementById('gen-sx').value, 0);
      var sy = num(document.getElementById('gen-sy').value, 0);
      var ix = num(document.getElementById('gen-ix').value, 0);
      var iy = num(document.getElementById('gen-iy').value, 0);

      var usableX = Math.max(0, sx - 2 * ix);
      var usableY = Math.max(0, sy - 2 * iy);
      var list = [];
      for (var j = 0; j < ny; j++) {
        for (var i = 0; i < nx; i++) {
          list.push({
            id: nextId(),
            name: String.fromCharCode(65 + j) + (i + 1),
            x: ix + (nx > 1 ? usableX * i / (nx - 1) : usableX / 2),
            y: iy + (ny > 1 ? usableY * j / (ny - 1) : usableY / 2)
          });
        }
      }
      state.supports = list;
      renderSupports();
      recompute();
    });

    ['env-dx', 'env-dy', 'env-dz'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () {
        state.envelope[id.slice(4)] = num(this.value, 0);
        recompute();
      });
    });

    document.getElementById('pos-mode').addEventListener('change', function () {
      state.posMode = this.value;
      recompute();
    });

    document.getElementById('cap-per-support').addEventListener('input', function () {
      state.capacity = this.value === '' ? null : num(this.value, 0);
      recompute();
    });

    document.getElementById('opt-uplift').addEventListener('change', function () {
      state.redistribute = this.checked;
      recompute();
    });

    ['envelope', 'labels', 'ortho'].forEach(function (key) {
      document.getElementById('opt-' + key).addEventListener('change', function () {
        state.view[key] = this.checked;
        draw();
      });
    });

    var lengthSelect = document.getElementById('unit-length');
    var massSelect = document.getElementById('unit-mass');
    lengthSelect.dataset.previous = state.lengthUnit;
    massSelect.dataset.previous = state.massUnit;

    lengthSelect.addEventListener('change', function () {
      var previous = lengthSelect.dataset.previous;
      var factor = LENGTH_TO_MM[previous] / LENGTH_TO_MM[lengthSelect.value];
      state.lengthUnit = lengthSelect.value;
      lengthSelect.dataset.previous = state.lengthUnit;
      ['dx', 'dy', 'dz'].forEach(function (k) { state.envelope[k] *= factor; });
      state.parts.forEach(function (p) {
        ['x', 'y', 'z', 'dx', 'dy', 'dz'].forEach(function (k) { p[k] *= factor; });
      });
      state.supports.forEach(function (s) { s.x *= factor; s.y *= factor; });
      ['gen-sx', 'gen-sy', 'gen-ix', 'gen-iy'].forEach(function (id) {
        var input = document.getElementById(id);
        input.value = roundTidy(num(input.value, 0) * factor);
      });
      afterUnitChange();
    });

    massSelect.addEventListener('change', function () {
      var previous = massSelect.dataset.previous;
      var factor = MASS_TO_KG[previous] / MASS_TO_KG[massSelect.value];
      state.massUnit = massSelect.value;
      massSelect.dataset.previous = state.massUnit;
      state.parts.forEach(function (p) { p.w *= factor; });
      if (state.capacity !== null) { state.capacity *= factor; }
      afterUnitChange();
    });

    function roundTidy(value) {
      return Math.round(value * 1000) / 1000;
    }

    function afterUnitChange() {
      state.parts.forEach(function (p) {
        ['x', 'y', 'z', 'dx', 'dy', 'dz', 'w'].forEach(function (k) { p[k] = roundTidy(p[k]); });
      });
      state.supports.forEach(function (s) { s.x = roundTidy(s.x); s.y = roundTidy(s.y); });
      ['dx', 'dy', 'dz'].forEach(function (k) { state.envelope[k] = roundTidy(state.envelope[k]); });
      if (state.capacity !== null) { state.capacity = roundTidy(state.capacity); }
      syncUnitLabels();
      syncInputs();
      renderParts();
      renderSupports();
      fitView();
      recompute();
    }

    function syncUnitLabels() {
      Array.prototype.forEach.call(document.querySelectorAll('[data-unit="length"]'), function (n) {
        n.textContent = lengthLabel();
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-unit="mass"]'), function (n) {
        n.textContent = massLabel();
      });
    }

    function syncInputs() {
      document.getElementById('env-dx').value = state.envelope.dx;
      document.getElementById('env-dy').value = state.envelope.dy;
      document.getElementById('env-dz').value = state.envelope.dz;
      document.getElementById('pos-mode').value = state.posMode;
      lengthSelect.value = state.lengthUnit;
      massSelect.value = state.massUnit;
      lengthSelect.dataset.previous = state.lengthUnit;
      massSelect.dataset.previous = state.massUnit;
      document.getElementById('cap-per-support').value = state.capacity === null ? '' : state.capacity;
      document.getElementById('opt-uplift').checked = state.redistribute;
    }

    /* ------------------------------------------------------------ camera input */

    var pointers = new Map();
    var lastPinch = 0;
    var dragMode = null;
    var lastPoint = null;

    el.canvas.addEventListener('pointerdown', function (e) {
      el.canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragMode = (e.shiftKey || e.button === 1) ? 'pan' : 'orbit';
        lastPoint = { x: e.clientX, y: e.clientY };
      } else {
        dragMode = 'pinch';
        lastPinch = pinchDistance();
      }
    });

    function pinchDistance() {
      var list = Array.from(pointers.values());
      if (list.length < 2) { return 0; }
      var dx = list[0].x - list[1].x;
      var dy = list[0].y - list[1].y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    el.canvas.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) { return; }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (dragMode === 'pinch') {
        var d = pinchDistance();
        if (lastPinch > 0 && d > 0) { zoom(lastPinch / d); }
        lastPinch = d;
        return;
      }
      if (!lastPoint) { return; }
      var dx = e.clientX - lastPoint.x;
      var dy = e.clientY - lastPoint.y;
      lastPoint = { x: e.clientX, y: e.clientY };

      if (dragMode === 'pan') {
        cam.panX += dx;
        cam.panY += dy;
      } else {
        cam.az -= dx * 0.008;
        cam.el = Math.max(-1.5, Math.min(1.5, cam.el + dy * 0.008));
      }
      draw();
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) { dragMode = null; lastPoint = null; }
      else if (pointers.size === 1) {
        dragMode = 'orbit';
        var p = Array.from(pointers.values())[0];
        lastPoint = { x: p.x, y: p.y };
      }
    }
    el.canvas.addEventListener('pointerup', endPointer);
    el.canvas.addEventListener('pointercancel', endPointer);

    function zoom(factor) {
      cam.dist = Math.max(cam.radius * 0.4, Math.min(cam.radius * 40, cam.dist * factor));
      draw();
    }

    el.canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    el.canvas.addEventListener('keydown', function (e) {
      var step = 0.09;
      var handled = true;
      switch (e.key) {
        case 'ArrowLeft': cam.az -= step; break;
        case 'ArrowRight': cam.az += step; break;
        case 'ArrowUp': cam.el = Math.min(1.5, cam.el + step); break;
        case 'ArrowDown': cam.el = Math.max(-1.5, cam.el - step); break;
        case '+': case '=': zoom(1 / 1.15); return;
        case '-': case '_': zoom(1.15); return;
        case '0': setView('iso'); return;
        default: handled = false;
      }
      if (handled) { e.preventDefault(); draw(); }
    });

    function setView(name) {
      if (name === 'front') { cam.az = -Math.PI / 2; cam.el = 0; }
      else if (name === 'side') { cam.az = 0; cam.el = 0; }
      else if (name === 'top') { cam.az = -Math.PI / 2; cam.el = 1.5; }
      else { cam.az = -0.95; cam.el = 0.42; }
      fitView();
      Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) {
        b.setAttribute('aria-pressed', b.dataset.view === name ? 'true' : 'false');
      });
      draw();
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) {
      b.addEventListener('click', function () { setView(b.dataset.view); });
    });
    document.getElementById('btn-fit').addEventListener('click', function () { fitView(); draw(); });

    /* ------------------------------------------------------------ export */

    function download(blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      if (global.TN && global.TN.toast) { global.TN.toast('Downloaded ' + filename, 'success'); }
    }

    document.getElementById('btn-load-preset').addEventListener('click', function () {
      var key = document.getElementById('preset').value;
      var maker = PRESETS[key] || PRESETS.blank;
      var data = maker();
      data.lengthUnit = 'mm';
      data.massUnit = 'kg';
      data.posMode = 'corner';
      applyProject(data);
      syncInputs();
      syncUnitLabels();
      renderParts();
      renderSupports();
      fitView();
      recompute();
    });

    document.getElementById('btn-save-json').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(serialise(), null, 2)], { type: 'application/json' });
      download(blob, 'centre-of-gravity.json');
    });

    document.getElementById('btn-open-json').addEventListener('click', function () {
      document.getElementById('file-json').click();
    });

    document.getElementById('file-json').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          applyProject(JSON.parse(String(reader.result)));
          syncInputs();
          syncUnitLabels();
          renderParts();
          renderSupports();
          fitView();
          recompute();
        } catch (err) {
          if (global.TN && global.TN.toast) {
            global.TN.toast('That file could not be read as a saved project.', 'error');
          }
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    document.getElementById('btn-csv').addEventListener('click', function () {
      var lines = [];
      function esc(v) {
        var s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }
      function row(arr) { lines.push(arr.map(esc).join(',')); }

      row(['Blocks']);
      row(['Name', 'Included', 'X', 'Y', 'Z', 'Size X', 'Size Y', 'Size Z', 'Weight (' + massLabel() + ')']);
      state.parts.forEach(function (p) {
        row([p.name, p.on ? 'yes' : 'no', p.x, p.y, p.z, p.dx, p.dy, p.dz, p.w]);
      });

      row([]);
      row(['Result']);
      if (lastResult && lastResult.cg.ok) {
        row(['Total weight (' + massLabel() + ')', lastResult.cg.weight]);
        row(['CG X (' + lengthLabel() + ')', lastResult.cg.x]);
        row(['CG Y (' + lengthLabel() + ')', lastResult.cg.y]);
        row(['CG Z (' + lengthLabel() + ')', lastResult.cg.z]);
      }

      row([]);
      row(['Support loads']);
      row(['Name', 'X', 'Y', 'Load (' + massLabel() + ')', 'Load (kN)', 'Share %']);
      if (lastResult && lastResult.reactions && lastResult.reactions.ok) {
        state.supports.forEach(function (s, i) {
          var load = lastResult.reactions.loads[i];
          row([s.name, s.x, s.y, load, toKN(load), load / lastResult.cg.weight * 100]);
        });
      }

      download(new Blob([lines.join('\n')], { type: 'text/csv' }), 'centre-of-gravity.csv');
    });

    document.getElementById('btn-png').addEventListener('click', function () {
      draw();
      el.canvas.toBlob(function (blob) {
        if (blob) { download(blob, 'centre-of-gravity.png'); }
      });
    });

    document.getElementById('btn-print').addEventListener('click', function () { global.print(); });

    /* ------------------------------------------------------------ start */

    if (global.ResizeObserver) {
      new ResizeObserver(function () { draw(); }).observe(el.canvas.parentNode);
    } else {
      global.addEventListener('resize', draw);
    }

    if (global.matchMedia) {
      var scheme = global.matchMedia('(prefers-color-scheme: dark)');
      if (scheme.addEventListener) { scheme.addEventListener('change', draw); }
    }
    // DAME Tools Hub: redraw when the day/night button is pressed.
    global.document.addEventListener('hub:theme', function () { draw(); });

    if (!restore()) {
      applyProject(PRESETS.chiller());
    }
    syncInputs();
    syncUnitLabels();
    renderParts();
    renderSupports();
    setView('iso');
    recompute();
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

}(typeof window !== 'undefined' ? window : globalThis));
