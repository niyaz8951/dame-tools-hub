/* ============================================================
   Datasheet Notes - reader for the Daikin AHU technical report
   (ASTRAWEB selection software, text-based PDF).

   DSParse.lines(items, pageNo)  pdf.js text items -> lines of cells
   DSParse.parseAll(pages)       lines of every page -> [structured data, one per unit]
   DSParse.rows(data, choice)    one unit -> every row, each with a mapping key
   DSParse.grid(units, choice, mapping)   all units + the admin's row mapping -> the table
                                 (one column per unit tag)

   Rule: the reader adds and assumes nothing. Every value is text
   printed on the datasheet; wording is changed only by the admin's
   row mapping (Datasheet Notes > Row mapping). The reader rearranges
   three things:
   - "A • B" labels with "x • y" values become one row each
   - two filters printed in one section are shown as Filter 1 / Filter 2
   - the Options List lines are placed under their own section
   ============================================================ */
(function () {
  'use strict';

  var SKIP = /^(Technical Report\s*•|The certified standard performances|\d+\s*\/\s*\d+$)/;
  var TOP  = /^(EN\s*13053|Section List|Options List|Sound Report|NRVU\b.*|Electrical Power Inputs Data)$/i;
  var NUMBERED = /^(\d+)\)\s*(.+)$/;
  var CELL_GAP = 25;      // points between two pieces of text that makes them separate cells
  var DOT = /\s*•\s*/;

  function clean(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  /* ---- pdf.js items of one page -> lines, top to bottom ---- */
  function lines(items, pageNo) {
    var list = items
      .filter(function (it) { return it.str && it.str.trim(); })
      .map(function (it) {
        return { s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0,
                 h: Math.abs(it.transform[3]) || it.height || 10 };
      })
      .filter(function (it) { return it.h >= 6; })          // tiny print inside the energy label picture
      .sort(function (a, b) { return b.y - a.y || a.x - b.x; });

    var rows = [];
    list.forEach(function (it) {
      var last = rows[rows.length - 1];
      if (last && Math.abs(last.y - it.y) <= 2.5) last.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    });

    return rows.map(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      var cells = [], end = null, h = 0;
      r.items.forEach(function (it) {
        h = Math.max(h, it.h);
        var cur = cells[cells.length - 1];
        if (cur && it.x - end <= CELL_GAP) cur.s += (it.x - end > 1 ? ' ' : '') + it.s;
        else cells.push({ x: it.x, s: it.s });
        end = it.x + it.w;
      });
      cells.forEach(function (c) { c.s = clean(c.s); });
      return { page: pageNo, y: r.y, x: cells[0].x, h: h, cells: cells,
               text: cells.map(function (c) { return c.s; }).join(' ') };
    });
  }

  /* ---- most common text height = body text; anything taller is a heading ---- */
  function bodyHeight(pages) {
    var count = {}, best = 10, n = 0;
    pages.forEach(function (pg) { pg.forEach(function (ln) {
      var k = Math.round(ln.h * 2) / 2; count[k] = (count[k] || 0) + 1;
      if (count[k] > n) { n = count[k]; best = k; }
    }); });
    return best;
  }

  function parse(pages) {
    var body = bodyHeight(pages);
    var hdr = {}, unit = { rows: [], options: [] }, sections = [], warnings = [], elec = [];
    var mode = 'head', sec = null, sub = '', optTarget = null;
    var valueX = null, labelX = null, lastY = null, lastRow = null, secHeadH = null;

    function target() { return mode === 'unit' ? unit : sec; }

    pages.forEach(function (pg) {
      lastY = null;                                  // a block carries on across a page break
      pg.forEach(function (ln) {
        var text = ln.text;
        if (SKIP.test(text)) return;
        var heading = ln.h >= body + 0.8;
        var m = NUMBERED.exec(text);

        if (/^Electrical Power Inputs Data$/i.test(text)) { mode = 'elec'; return; }
        if (mode === 'elec') {
          // table rows: Component | Electrical Connection | Absorbed power - current
          if (!heading && ln.cells.length >= 2) elec.push({ component: ln.cells[0].s, connection: ln.cells[1].s });
          else if (heading && !/Component|Electrical Connection|Absorbed|Current/i.test(text)) mode = 'skip';
          return;
        }

        if (heading) {
          if (/^Unit Data$/i.test(text)) { mode = 'unit'; lastRow = null; return; }
          if (/^Options List$/i.test(text)) { mode = 'options'; optTarget = null; return; }
          if (mode === 'options') {
            if (/^Unit Options$/i.test(text)) { optTarget = unit; return; }
            if (m) {
              optTarget = sections.filter(function (s) { return s.no === m[1]; })[0] || null;
              if (!optTarget) warnings.push('Options for "' + text + '" have no matching section in the datasheet and were left out.');
              else if (optTarget.name !== clean(m[2])) warnings.push('Options list names section ' + m[1] + ' "' + clean(m[2]) + '" but the section is "' + optTarget.name + '". Check these options.');
              return;
            }
            mode = 'skip'; return;
          }
          if (m) {
            mode = 'section'; sub = ''; lastRow = null; lastY = null; secHeadH = ln.h;
            sec = { no: m[1], name: clean(m[2]), rows: [], options: [], page: ln.page };
            sections.push(sec);
            return;
          }
          if (mode === 'section') {
            if (TOP.test(text) || (secHeadH && ln.h >= secHeadH)) { mode = 'skip'; return; }
            sub = text; lastY = null; lastRow = null;  // sub-heading: Damper One Supply, Geometry, Cooling, Motor Data
            return;
          }
          if (mode === 'head') {
            var pm = /^Project\s+(.+)$/.exec(text), um = /^Unit\s+(.+)$/.exec(text);
            if (pm) hdr.project = pm[1]; else if (um) hdr.unit = um[1];
            return;
          }
          mode = 'skip';
          return;
        }

        if (mode === 'head') {
          var c0 = ln.cells[0].s, c1 = ln.cells[1] ? ln.cells[1].s : '';
          if (/^Technical Report$/i.test(c0) && c1) hdr.date = c1;
          else if (/^Material Name$/i.test(c0) && c1) hdr.material = c1;
          else if (/^Ref\.\s*/i.test(c1)) { hdr.software = c0; hdr.reference = c1.replace(/^Ref\.\s*/i, ''); }
          return;
        }

        if (mode === 'unit' || mode === 'section') {
          var t = target();
          if (ln.cells.length >= 2) {
            // a wide empty gap after a sub-block ends it (Recirculated Air / Drain Pan after the dampers)
            if (mode === 'section' && sub && lastY !== null && lastY - ln.y > body * 2.8) sub = '';
            lastRow = { sub: mode === 'section' ? sub : '', param: ln.cells[0].s,
                        value: ln.cells.slice(1).map(function (c) { return c.s; }).join(' '), page: ln.page };
            t.rows.push(lastRow);
            labelX = ln.cells[0].x; valueX = ln.cells[1].x; lastY = ln.y;
            return;
          }
          var cell = ln.cells[0];
          if (valueX !== null && cell.x >= valueX - 12) {         // value wrapped onto a second line
            if (lastRow) { lastRow.value += ' ' + cell.s; lastY = ln.y; }
            return;
          }
          if (/:$/.test(cell.s)) return;                          // group label, e.g. "Specific fan power efficiency rating:"
          if (labelX !== null && Math.abs(cell.x - labelX) <= 4) { // label printed with no value
            lastRow = { sub: mode === 'section' ? sub : '', param: cell.s, value: '', page: ln.page };
            t.rows.push(lastRow); lastY = ln.y;
            return;
          }
          // free text under a block, e.g. "Calculated in Wet Condition": kept with the block it is printed in
          t.rows.push({ sub: mode === 'section' ? sub : '', param: 'Note', value: cell.s, page: ln.page });
          lastRow = null;
          return;
        }

        if (mode === 'options' && optTarget) optTarget.options.push(text);
      });
    });

    sections.forEach(splitFilters);

    // Power supply = the Electrical Connection printed for Fan Supply in "Electrical Power Inputs Data".
    var fan = elec.filter(function (e) { return /^Fan Supply$/i.test(e.component); })[0] ||
              elec.filter(function (e) { return /^Fan\b/i.test(e.component); })[0];
    if (fan) { hdr.power = fan.connection; hdr.powerFrom = fan.component; }
    else warnings.push('No Fan Supply line was found under "Electrical Power Inputs Data", so the Power Supply row is missing.');
    return { hdr: hdr, unit: unit, sections: sections, warnings: warnings, elec: elec };
  }

  /* One PDF can hold several units, each starting on a page with the "Unit Data" heading.
     Pages are cut into one block per unit and each block is read on its own. */
  function parseAll(pages) {
    var starts = [];
    pages.forEach(function (pg, i) { if (pg.some(function (ln) { return /^Unit Data$/i.test(ln.text); })) starts.push(i); });
    if (starts.length < 2) return [parse(pages)];
    return starts.map(function (from, k) {
      return parse(pages.slice(k === 0 ? 0 : from, k + 1 < starts.length ? starts[k + 1] : pages.length));
    });
  }

  /* One filter section can hold two filters: a repeated "Filter Class" starts the next one. */
  function splitFilters(s) {
    var starts = [];
    s.rows.forEach(function (r, i) { if (!r.sub && /^Filter Class$/i.test(r.param)) starts.push(i); });
    if (starts.length < 2) return;
    starts.forEach(function (from, k) {
      var to = k + 1 < starts.length ? starts[k + 1] : s.rows.length;
      for (var i = from; i < to; i++) if (!s.rows[i].sub) s.rows[i].sub = 'Filter ' + (k + 1);
    });
  }

  /* "Panel • Insulation" = "62 mm • Foam"  ->  Panel: 62 mm, Insulation: Foam.
     A short second label takes its meaning from the first one:
     "Temp. Dry Bulb In • Out" -> "Temp. Dry Bulb In", "Temp. Dry Bulb Out". */
  var STANDALONE = /^(Door|Altitude|Rows|Insulation)$/i;
  function expand(param, value) {
    var lp = param.split(DOT), vp = value.split(DOT);
    if (lp.length < 2 || lp.length !== vp.length) return [{ param: param, value: value }];
    var words = lp[0].split(' ');
    return lp.map(function (l, i) {
      var name = l;
      if (i > 0 && l.indexOf(' ') < 0 && words.length > 1 && !STANDALONE.test(l)) {
        var base = words.slice(0, -1);
        while (base.length > 1 && /^(Diam|Dia)\.?$/i.test(base[base.length - 1])) base.pop();
        name = base.join(' ') + ' ' + l;
      }
      return { param: name, value: vp[i] };
    });
  }

  /* ---- structured data + the user's choices -> every row the datasheet gives ----
     Each row: { group, title, sub, component, value, key }
       group  section name without its number ("Filter Supply"); rows of every section
              with the same name share their mapping
       title  what is printed in the Section column ("2) Filter Supply")
       key    what the admin's row mapping is stored under: group | sub | component.
              "Filter 1" / "Filter 2" are left out of the key so one rule covers every filter. */
  function norm(s) { return clean(s).toLowerCase(); }
  function rowKey(group, sub, component) {
    return norm(group) + '|' + (/^Filter \d+$/i.test(sub) ? '' : norm(sub)) + '|' + norm(component);
  }

  function rows(data, choice) {
    var out = [], count = {};
    function push(group, title, nth, sub, component, value) {
      out.push({ group: group, title: title, nth: nth, sub: sub, component: component, value: value, key: rowKey(group, sub, component) });
    }
    function body(group, title, nth, t) {
      var subs = [];
      function add(r) { expand(r.param, r.value).forEach(function (e) { push(group, title, nth, r.sub, e.param, e.value); }); }
      t.rows.forEach(function (r) { if (!r.sub) add(r); else if (subs.indexOf(r.sub) < 0) subs.push(r.sub); });
      subs.forEach(function (s) { t.rows.forEach(function (r) { if (r.sub === s) add(r); }); });
      t.options.forEach(function (o) { push(group, title, nth, 'Options', 'Option', o); });
    }

    // The unit tag is the heading of the unit's column, so there is no "Unit" row.
    var h = data.hdr;
    function g(label, v) { if (v) push('General', 'General', 1, '', label, v); }
    g('Product', choice && choice.product); g('Factory', choice && choice.factory); g('Power Supply', h.power);
    g('Project', h.project); g('Reference', h.reference);
    g('Material Name', h.material); g('Selection Software', h.software); g('Report Date', h.date);
    body('Unit Data', 'Unit Data', 1, data.unit);
    data.sections.forEach(function (s) {
      count[s.name] = (count[s.name] || 0) + 1;          // 2nd, 3rd ... section with the same name in this unit
      body(s.name, s.no + ') ' + s.name, count[s.name], s);
    });
    return out;
  }

  /* An admin response: empty = the datasheet value, plain text = a standard response,
     $ or * inside the text = the place where the datasheet value goes. */
  function fill(response, value) {
    var r = clean(response || '');
    if (!r) return value;
    return r.replace(/[$*]/g, function () { return value; });
  }

  /* ---- every unit + the admin's mapping -> the table that is shown and exported ----
     units:   [data, ...] from parseAll()
     mapping: { showUnmapped: true|false, rules: { key: { show, label, response } } }
     Out: { columns: [unit tag, ...], rows: [{ section, component, cells: [one per unit], kind }] }
       kind = 'row' | 'sub'. section is filled on the first row of a section only. A sub-heading
       is written only when at least one of its rows is shown.

     One unit: the Section column shows the datasheet's own heading ("2) Filter Supply").
     Several units: section numbers differ from unit to unit, so rows are lined up by section
     NAME (2nd, 3rd section of the same name as "Filter Supply (2)" ...), sub-heading and
     component. Option lines are lined up by their text. A unit that does not have a row
     gets "-" in its cell. */
  var MISSING = '-';
  function optionId(text) { return norm(text).replace(/^\d+\s*x\s+/, ''); }

  function tags(units) {
    var seen = {};
    return units.map(function (u, i) {
      var t = clean(u.hdr.unit || '') || 'Unit ' + (i + 1);
      seen[t] = (seen[t] || 0) + 1;
      return seen[t] > 1 ? t + ' (' + seen[t] + ')' : t;
    });
  }

  function grid(units, choice, mapping) {
    var rules = (mapping && mapping.rules) || {}, unmapped = !mapping || mapping.showUnmapped !== false;
    var many = units.length > 1, merged = [], byId = {};

    units.forEach(function (data, u) {
      var pos = -1, dup = {};
      rows(data, choice).forEach(function (r) {
        var id = norm(r.group) + '#' + r.nth + '|' + norm(r.sub) + '|';
        if (r.sub === 'Options') id += optionId(r.value);
        else { id += norm(r.component); dup[id] = (dup[id] || 0) + 1; if (dup[id] > 1) id += '#' + dup[id]; }
        var m = byId[id];
        if (m) pos = Math.max(pos, merged.indexOf(m));
        else {
          m = byId[id] = { key: r.key, sub: r.sub, component: r.component, values: [],
                           title: many ? r.group + (r.nth > 1 ? ' (' + r.nth + ')' : '') : r.title };
          merged.splice(++pos, 0, m);                      // a row only a later unit has goes after the row before it
        }
        m.values[u] = r.value;
      });
    });

    var out = [], title = null, sub = '', blank = units.map(function () { return ''; });
    merged.forEach(function (m) {
      var rule = rules[m.key];
      if (rule ? rule.show === false : !unmapped) return;
      var first = m.title !== title;
      if (first) { title = m.title; sub = ''; }
      if (m.sub !== sub) {
        sub = m.sub;
        if (sub) { out.push({ section: first ? title : '', component: sub, cells: blank, kind: 'sub' }); first = false; }
      }
      out.push({ section: first ? title : '', component: (rule && clean(rule.label || '')) || m.component, kind: 'row',
                 cells: units.map(function (x, u) { return m.values[u] === undefined ? MISSING : fill(rule && rule.response, m.values[u]); }) });
    });
    return { columns: tags(units), rows: out };
  }

  window.DSParse = { readers: { ahu: true }, lines: lines, parse: parse, parseAll: parseAll, rows: rows, grid: grid,
                     fill: fill, expand: expand, rowKey: rowKey };
})();
