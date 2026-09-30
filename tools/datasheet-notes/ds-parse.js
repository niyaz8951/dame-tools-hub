/* ============================================================
   Datasheet Notes - reader for the Daikin AHU technical report
   (ASTRAWEB selection software, text-based PDF).

   DSParse.lines(items, pageNo)  pdf.js text items -> lines of cells
   DSParse.parse(pages)          lines of every page -> structured data
   DSParse.table(data, choice)   structured data -> rows for the table

   Rule: nothing is added or assumed. Every Specs value is text
   printed on the datasheet. Only three things are rearranged:
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
    var hdr = {}, unit = { rows: [], options: [] }, sections = [], warnings = [];
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
    return { hdr: hdr, unit: unit, sections: sections, warnings: warnings };
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

  /* ---- structured data + the user's choices -> table rows ----
     Each row: { section, component, specs, kind }  kind = 'row' | 'sub'.
     section is filled on the first row of a section only. */
  function table(data, choice) {
    var out = [];
    function block(title, rows) {
      rows.forEach(function (r, i) { out.push({ section: i === 0 ? title : '', component: r.component, specs: r.specs, kind: r.kind || 'row' }); });
    }
    function body(t) {
      var rows = [], subs = [];
      function add(r) { expand(r.param, r.value).forEach(function (e) { rows.push({ component: e.param, specs: e.value }); }); }
      t.rows.forEach(function (r) { if (!r.sub) add(r); else if (subs.indexOf(r.sub) < 0) subs.push(r.sub); });
      subs.forEach(function (s) {
        rows.push({ component: s, specs: '', kind: 'sub' });
        t.rows.forEach(function (r) { if (r.sub === s) add(r); });
      });
      if (t.options.length) {
        rows.push({ component: 'Options', specs: '', kind: 'sub' });
        t.options.forEach(function (o) { rows.push({ component: 'Option', specs: o }); });
      }
      return rows;
    }

    var h = data.hdr, general = [];
    function g(label, v) { if (v) general.push({ component: label, specs: v }); }
    g('Product', choice && choice.product); g('Factory', choice && choice.factory); g('Power Supply', choice && choice.power);
    g('Project', h.project); g('Unit', h.unit); g('Reference', h.reference);
    g('Material Name', h.material); g('Selection Software', h.software); g('Report Date', h.date);
    block('General', general);
    block('Unit Data', body(data.unit));
    data.sections.forEach(function (s) { block(s.no + ') ' + s.name, body(s)); });
    return out;
  }

  window.DSParse = { lines: lines, parse: parse, table: table, expand: expand };
})();
