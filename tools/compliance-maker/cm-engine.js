/* ============================================================
   Compliance Maker - the conversion engine.
   Specification text or PDF in, classified rows out:
     { type: 'part' | 'section' | 'letter' | 'number' | 'text', sr, spec }
   No page, no database: used by the classic Compliance Maker page
   (compliance-maker.js) and by "Add a specification" in a project
   (tools/projects/add-spec.html). This is the only copy of the parser.

   CMEngine.fromText(text, { skipFront, keepBreaks })      -> { rows, info: [text], partial }
   CMEngine.fromPdf(file, { skipFront, onProgress(text) }) -> Promise of the same; rejects with a plain message
   CMEngine.parseLines, skipFrontMatter, dropPageFurniture, extractLinesFromTextContent, frontNote
   ============================================================ */
(function () {
  'use strict';

  /* Page ceiling. Nothing enforces this but this line — there is no server to
     disagree with it. It exists to stop a 400-page spec locking up the tab,
     not to ration anything. */
  var MAX_PAGES = 50;
  var CHARS_PER_PAGE = 3000;

  /* ======================================================================
     PARSER — lines to classified rows.
     ====================================================================== */

  var RE = {
    part:    /^(PART\s+[0-9IVX]+)\b\s*(.*)$/i,
    section: /^(\d{1,2}\.\d{1,2})\s+(.*)$/,        // 1.01, 1.1, 2.1, 1.3
    number:  /^(\d{1,2})\.\s+(.*)$/,               // 1.
    letter:  /^([A-Z])\.\s+(.*)$/,                 // A.
    letterLoose: /^([a-zA-Z])[.)]\s+(.*)$/
  };

  // Mirrors the Excel tool's section test: a numbered heading is a blue
  // SECTION when its text is short and heading-shaped (Proper Case, ALL CAPS,
  // "CAPS-word + Proper rest", or ends with ":"). Otherwise it's a body row
  // (e.g. "1.1 The unit shall...") so it doesn't wrongly turn blue.
  function isSectionHeading(text) {
    if (!text) return true;                 // bare "1.3" with title on next line
    var words = text.split(/\s+/);
    if (words.length > 6) return false;      // long sentence -> not a heading
    if (/[.]/.test(text.replace(/:$/, ''))) return false; // decimals/periods inside -> not heading
    var stripped = text.replace(/:$/, '');
    var isCaps = stripped === stripped.toUpperCase();
    var isProper = words.every(function (w) {
      return !w || w[0] === w[0].toUpperCase();
    });
    var endsColon = /:$/.test(text);
    return isCaps || isProper || endsColon;
  }

  // "2.02 CASING" is a section. A wrapped line that happens to start with a decimal
  // ("0.68 W/m2 °K ...", "1.52 mm (16 gage) ...") is not: sections start at 1 and their
  // title starts with a capitalised word, not a unit.
  function sectionMatch(line) {
    var m = line.match(RE.section);
    if (!m) return null;
    var first = m[2].trim().split(/\s+/)[0] || '';
    if (/^0\./.test(m[1])) return null;
    if (first && !/^[A-Z][A-Za-z,&'’\-]*[:.]?$/.test(first)) {
      if (/^\d{1,2}\.\d{2}$/.test(m[1]) || !/^[A-Za-z]/.test(first)) return null;
    }
    return m;
  }

  function startsNewItem(line) {
    return RE.part.test(line) || !!sectionMatch(line) ||
           RE.number.test(line) || RE.letter.test(line) ||
           RE.letterLoose.test(line);
  }

  function classify(line) {
    var m;
    if ((m = line.match(RE.part)))    return { type: 'part',    sr: m[1].toUpperCase(), spec: (m[2] || '').trim() };
    if ((m = sectionMatch(line))) {
      var stext = m[2].trim();
      // x.xx (two-decimal) is always a section (classic spec numbering).
      // x.x (one-decimal) is a section only if it reads like a heading.
      var twoDecimal = /^\d{1,2}\.\d{2}$/.test(m[1]);
      if (twoDecimal || isSectionHeading(stext)) {
        return { type: 'section', sr: m[1], spec: stext };
      }
      // Otherwise treat as a normal numbered body clause.
      return { type: 'number', sr: m[1], spec: stext };
    }
    if ((m = line.match(RE.number)))  return { type: 'number',  sr: m[1], spec: m[2].trim() };
    if ((m = line.match(RE.letter)))  return { type: 'letter',  sr: m[1], spec: m[2].trim() };
    if ((m = line.match(RE.letterLoose))) return { type: 'letter', sr: m[1], spec: m[2].trim() };
    return { type: 'text', sr: '', spec: line.trim() };
  }

  /* ---------------------------------------------------------------------
     BARE LABELS — "1  Wheel Media", with no full stop after the number.

     Spec authors write these constantly, and every strict pattern above
     misses them, so the clause underneath is read as a wrap and glued on.
     That is the whole reason a five-clause paste came out as one row.

     Promoting any leading number would be worse than the bug. "25 mm
     nominal bore" and "2019 edition" open a line exactly the same way, and
     a number wrongly promoted to a label splits a clause in half — a
     failure that is much harder to spot in a 300-row matrix than a missed
     label is.

     What separates a label from a stray number is that labels COUNT. So
     candidates are collected first and only promoted where they form an
     ascending run: 1, 2, 3 in order. A lone number is promoted only when
     it is 1, which is a list beginning. "25 mm" has nothing before it and
     nothing after, so it stays part of its sentence.
     --------------------------------------------------------------------- */
  var RE_BARE = /^(\d{1,2})[ \t]+(\S.*)$/;

  // A label's text reads like the start of a clause. These open a
  // measurement or a count instead, so the number in front is a quantity.
  var RE_UNIT = /^(mm|cm|m|km|kg|g|lb|t|%|deg|k|hz|kw|kva|hp|w|v|a|bar|pa|kpa|psi|cfm|ls|m2|m3|nos?|off|x|to|and|or|of|per|min|mins|minutes|hour|hours|hrs|day|days|week|weeks|month|months|year|years|pcs|sets?|units?|copies|no)\b/i;

  function normaliseBareLabels(lines) {
    var runs = [], run = [];
    function closeRun() { if (run.length) runs.push(run); run = []; }

    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i]).replace(/\s+/g, ' ').trim();
      if (!line) continue;

      // A part or section header ends whatever list was running — numbering
      // restarts underneath it.
      if (RE.part.test(line) || RE.section.test(line)) { closeRun(); continue; }

      // Already labelled by a strict pattern; leave it alone.
      if (RE.number.test(line) || RE.letter.test(line) || RE.letterLoose.test(line)) continue;

      var m = line.match(RE_BARE);
      if (!m) continue;
      var rest = m[2];

      // A clause opens with a capital. A quantity ("2 pumps and a tank")
      // usually does not, and that is the cheapest signal available that
      // tells the two apart mid-sentence.
      if (!/^[A-Z(\u201c"']/.test(rest)) continue;
      if (RE_UNIT.test(rest)) continue;

      var n = parseInt(m[1], 10);
      var cand = { i: i, n: n, sr: m[1], rest: rest };
      if (run.length && n === run[run.length - 1].n + 1) run.push(cand);
      else { closeRun(); run = [cand]; }
    }
    closeRun();

    var out = lines.slice();
    runs.forEach(function (r) {
      // Two or more in sequence is a list. One on its own is a list only if
      // it is the number 1.
      if (r.length < 2 && r[0].n !== 1) return;
      r.forEach(function (c) { out[c.i] = c.sr + '. ' + c.rest; });
    });
    return out;
  }

  // "END OF SECTION" closes a specification section. It is a divider, not a
  // clause — but it arrives at the tail of the last clause's line, where the
  // continuation rule would silently glue it onto that clause's text. So it
  // is split off first and emitted as its own black band row, the same
  // treatment a PART header gets.
  var END_OF_SECTION_RE = /\bend\s+of\s+section\b[.:\s]*$/i;

  // opts.keepBreaks — treat every line as its own row instead of folding
  // unlabeled lines into the clause above. Only the paste path passes this;
  // a PDF's line breaks come from the page layout, not the author, so folding
  // them back together is the only way to recover the real clause there.
  // Control characters a PDF or a Word copy can carry are not text: drop them here so the
  // preview, the library and the Excel all hold the same clause.
  function stripInvalid(s) {
    return window.xlsxWriter && window.xlsxWriter.clean ? window.xlsxWriter.clean(s) : String(s);
  }

  function parseLines(rawLines, opts) {
    var keepBreaks = !!(opts && opts.keepBreaks);
    // Promote bare labels before anything else looks at the lines, so the
    // rest of the parser sees one canonical label shape. The copy also keeps
    // the END OF SECTION splice below from mutating the caller's array.
    rawLines = normaliseBareLabels(rawLines);
    var rows = [];
    for (var i = 0; i < rawLines.length; i++) {
      var line = stripInvalid(rawLines[i]).replace(/\s+/g, ' ').trim();
      if (!line) continue;

      var endMatch = line.match(END_OF_SECTION_RE);
      if (endMatch) {
        // Whatever came before it on the same line is still a real clause,
        // so process that remainder first and let the divider follow.
        var before = line.slice(0, endMatch.index).trim();
        if (before) {
          rawLines.splice(i + 1, 0, 'END OF SECTION');
          line = before;
        } else {
          rows.push({ type: 'part', sr: '', spec: 'END OF SECTION' });
          continue;
        }
      }

      if (startsNewItem(line)) {
        rows.push(classify(line));
      } else if (!keepBreaks && rows.length &&
                 rows[rows.length - 1].type !== 'part' &&
                 rows[rows.length - 1].type !== 'section') {
        // Wrapped continuation of the previous clause — append.
        rows[rows.length - 1].spec =
          (rows[rows.length - 1].spec + ' ' + line).trim();
      } else {
        // Unlabeled paragraph directly after a PART/section header (or at
        // the start) is its own body row — headers never absorb body text.
        rows.push({ type: 'text', sr: '', spec: line });
      }
    }
    rows.forEach(function (r) {
      if (r.type === 'part') {
        r.spec = (r.sr + (r.spec ? ' ' + r.spec : '')).trim();
        r.sr = '';
      }
    });
    return rows;
  }

  /* ======================================================================
     PDF READING
     ====================================================================== */

  function extractLinesFromTextContent(tc) {
    var items = tc.items.filter(function (it) { return it.str !== undefined; });
    var lines = [];
    var currentY = null, buf = [];
    items.forEach(function (it) {
      var y = it.transform[5];
      if (currentY === null || Math.abs(y - currentY) <= 2) {
        buf.push(it.str);
        currentY = currentY === null ? y : currentY;
      } else {
        lines.push(buf.join(''));
        buf = [it.str];
        currentY = y;
      }
    });
    if (buf.length) lines.push(buf.join(''));
    return lines;
  }

  /* Running headers and footers ("SECTION 15720", "Rev 0  12 of 32  Contract No:") sit in
     the first or last few lines of a page and repeat on most pages. Left in, they get glued
     into the middle of a clause that runs over a page break. A line is removed only when
     the same text (digits ignored) is at the top or bottom of at least 3 pages and 40% of
     the pages. Edits pageLines in place and returns how many lines were removed. */
  var EDGE_LINES = 4;
  function dropPageFurniture(pageLines) {
    function key(s) { return s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase(); }
    function edges(lines) {
      var idx = [];
      lines.forEach(function (l, i) { if (l.trim()) idx.push(i); });
      return idx.slice(0, EDGE_LINES).concat(idx.slice(-EDGE_LINES)).filter(function (v, i, a) { return a.indexOf(v) === i; });
    }
    var count = {};
    pageLines.forEach(function (lines) {
      var seen = {};
      edges(lines).forEach(function (i) { var k = key(lines[i]); if (k && !seen[k]) { seen[k] = 1; count[k] = (count[k] || 0) + 1; } });
    });
    var need = Math.max(3, Math.ceil(pageLines.length * 0.4)), removed = 0;
    pageLines.forEach(function (lines, p) {
      var drop = {};
      edges(lines).forEach(function (i) { if (count[key(lines[i])] >= need) drop[i] = 1; });
      pageLines[p] = lines.filter(function (l, i) { if (drop[i]) { removed++; return false; } return true; });
    });
    return removed;
  }

  /* Cover sheets, revision tables and the table of contents come before the specification
     and are not clauses. Lines are dropped from the top of the document only:
       1. up to the first real "PART 1" heading, i.e. one that is not a contents entry
          (a contents entry ends in dot leaders and a page number);
       2. if the document has no PART 1 heading, up to the last contents entry of a table of
          contents that sits in the first third of the document.
     Nothing after that point is touched. Returns { lines, skipped, why }. */
  var TOC_LINE = /\.{5,}\s*\d*\s*$/;
  var PART_ONE = /^\s*PART\s+(1|I|ONE)\b(?!\s*[0-9IVX])/i;
  function skipFrontMatter(lines) {
    var i, start = -1, why = '';
    for (i = 0; i < lines.length; i++) {
      if (PART_ONE.test(lines[i]) && !TOC_LINE.test(lines[i])) { start = i; why = 'before PART 1'; break; }
    }
    if (start < 0) {
      var last = -1, count = 0;
      for (i = 0; i < Math.ceil(lines.length / 3); i++) if (TOC_LINE.test(lines[i])) { last = i; count++; }
      if (count >= 3) { start = last + 1; why = 'up to the end of the contents'; }
    }
    if (start <= 0) return { lines: lines, skipped: 0, why: '' };
    var skipped = lines.slice(0, start).filter(function (l) { return l.trim(); }).length;
    return { lines: lines.slice(start), skipped: skipped, why: why };
  }
  function frontNote(f) {
    return f.skipped ? ' · cover and contents skipped (' + f.skipped + (f.skipped === 1 ? ' line' : ' lines') + ' ' + f.why + ')' : '';
  }

  /* ======================================================================
     BUILD
     ====================================================================== */

  function capText(raw) {
    var cap = MAX_PAGES * CHARS_PER_PAGE, partial = '';
    if (raw.length > cap) {
      var total = raw.split(/\r\n|\r|\n/).length;
      var cut = Math.max(raw.lastIndexOf('\n', cap), raw.lastIndexOf('\r', cap));   // at the end of a line, never inside a clause
      raw = raw.slice(0, cut > 0 ? cut : cap);
      partial = 'Only the first ' + raw.split(/\r\n|\r|\n/).length + ' of ' + total + ' pasted lines were converted (about ' + MAX_PAGES + ' pages of text).';
    }
    return { raw: raw, partial: partial };
  }

  function fromText(text, o) {
    o = o || {};
    var c = capText(String(text || '')), lines = c.raw.split(/\r\n|\r|\n/);
    var front = o.skipFront === false ? { lines: lines, skipped: 0, why: '' } : skipFrontMatter(lines);
    var rows = parseLines(front.lines, { keepBreaks: !!o.keepBreaks }), info = [];
    if (front.skipped) info.push(front.skipped + (front.skipped === 1 ? ' line' : ' lines') + ' of cover and contents skipped');
    return { rows: rows, info: info, partial: c.partial };
  }

  function fromPdf(file, o) {
    o = o || {};
    var say = o.onProgress || function () {};
    return new Promise(function (resolve, reject) {
      if (!window.pdfjsLib) { reject(new Error('The PDF reader did not load. Refresh the page and try again.')); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read the file.')); };
      reader.onload = function () {
        window.pdfjsLib.getDocument({ data: new Uint8Array(reader.result) }).promise.then(function (pdf) {
          var max = Math.min(pdf.numPages, MAX_PAGES), pageLines = [];
          function page(p) {
            if (p > max) return Promise.resolve();
            say('Reading page ' + p + ' of ' + max + '\u2026');
            return pdf.getPage(p).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
              pageLines.push(extractLinesFromTextContent(tc));
              return new Promise(function (r) { setTimeout(r, 0); });           // let the page draw the progress
            }).then(function () { return page(p + 1); });
          }
          return page(1).then(function () {
            var dropped = dropPageFurniture(pageLines), all = [];
            pageLines.forEach(function (pl) { all = all.concat(pl); });
            if (!all.join('').trim()) throw new Error('No text was found in this PDF. It looks like a scan; a scanned PDF cannot be read.');
            say('Sorting the clauses\u2026');
            var front = o.skipFront === false ? { lines: all, skipped: 0, why: '' } : skipFrontMatter(all);
            var rows = parseLines(front.lines), info = [];
            if (dropped) info.push(dropped + ' page header and footer lines removed');
            if (front.skipped) info.push(front.skipped + (front.skipped === 1 ? ' line' : ' lines') + ' of cover and contents skipped');
            resolve({ rows: rows, info: info, partial: pdf.numPages > MAX_PAGES ? 'Only the first ' + MAX_PAGES + ' of ' + pdf.numPages + ' pages were converted.' : '' });
          });
        }).then(null, function (err) {
          reject(err && err.name === 'PasswordException' ? new Error('That PDF is password-protected. Remove the password and try again.')
               : err && /scan|No text/.test(err.message || '') ? err
               : new Error('Could not read that PDF. It may be damaged or not a real PDF file.'));
        });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  window.CMEngine = {
    MAX_PAGES: MAX_PAGES, CHARS_PER_PAGE: CHARS_PER_PAGE,
    parseLines: parseLines, skipFrontMatter: skipFrontMatter, dropPageFurniture: dropPageFurniture,
    extractLinesFromTextContent: extractLinesFromTextContent, frontNote: frontNote,
    fromText: fromText, fromPdf: fromPdf
  };
})();
