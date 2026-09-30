/* ============================================================
   Datasheet Notes - Excel writer (no library).
   DSXlsx.build(rows, sheetName) -> Blob of a one-sheet .xlsx

   rows: [{ section, component, specs, kind }] from DSParse.table().
   Sheet: Section | Component | Specs | Remarks, header row filled,
   every cell bordered and wrapped, Remarks left empty to fill in.
   ============================================================ */
(function () {
  'use strict';

  var HEADER_FILL = 'FF773562';   // header colour of the owner's compliance table format
  var SUB_FILL    = 'FFF4ECF1';
  var LINE        = 'FF8C8C8C';
  var WIDTHS = [26, 36, 56, 36];
  var HEAD = ['Section', 'Component', 'Specs', 'Remarks'];

  var CRC = (function () {
    var t = [], n, c, k;
    for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF, i; for (i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  /* zip, stored (no compression) */
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = enc.encode(f[0]), data = enc.encode(f[1]), crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var size = central.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]),
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function esc(s) {
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function cell(col, row, style, text) {
    var ref = 'ABCD'.charAt(col) + row;
    if (text === '' || text == null) return '<c r="' + ref + '" s="' + style + '"/>';
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + esc(text) + '</t></is></c>';
  }

  var X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  var NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

  /* cell styles: 1 header, 2 section name, 3 body, 4 sub-heading */
  function stylesXml() {
    var side = '<left style="thin"><color rgb="' + LINE + '"/></left><right style="thin"><color rgb="' + LINE + '"/></right>' +
               '<top style="thin"><color rgb="' + LINE + '"/></top><bottom style="thin"><color rgb="' + LINE + '"/></bottom><diagonal/>';
    function xf(font, fill) {
      return '<xf numFmtId="0" fontId="' + font + '" fillId="' + fill + '" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
             '<alignment vertical="center" wrapText="1"/></xf>';
    }
    return X + '<styleSheet xmlns="' + NS + '">' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="' + HEADER_FILL + '"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="' + SUB_FILL + '"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>' + side + '</border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        xf(2, 2) + xf(1, 0) + xf(0, 0) + xf(1, 3) + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }

  function sheetXml(rows) {
    var out = ['<row r="1" ht="24" customHeight="1">' + HEAD.map(function (h, i) { return cell(i, 1, 1, h); }).join('') + '</row>'];
    rows.forEach(function (r, i) {
      var n = i + 2, sub = r.kind === 'sub';
      out.push('<row r="' + n + '">' + cell(0, n, 2, r.section) + cell(1, n, sub ? 4 : 3, r.component) +
               cell(2, n, sub ? 4 : 3, r.specs) + cell(3, n, sub ? 4 : 3, '') + '</row>');
    });
    return X + '<worksheet xmlns="' + NS + '">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +      // prints one page wide
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      '<cols>' + WIDTHS.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' +
      '<sheetData>' + out.join('') + '</sheetData>' +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>';
  }

  function build(rows, sheetName) {
    var name = esc(String(sheetName || 'Datasheet Notes').replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31));
    return zip([
      ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', X + '<workbook xmlns="' + NS + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + name + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', stylesXml()],
      ['xl/worksheets/sheet1.xml', sheetXml(rows)]
    ]);
  }

  window.DSXlsx = { build: build };
})();
