/* ============================================================
   Datasheet Notes - open a datasheet PDF in the browser.
   DSRead.file(file, onProgress)   -> Promise of [unit, ...]: one entry per unit in the PDF (DSParse.parseAll)
   DSRead.files(list, onProgress)  -> the same for several PDFs, units in the order of the files
   onProgress(fileName, pageDone, pageCount) is called after every page, so the page can show
   where it is on a long PDF (an FCU schedule can hold more than a thousand units, one per page).
   Rejects with an Error whose message can be shown to the user as it is.
   Needs assets/vendor/pdfjs/pdf.min.js, ds-parse.js and the readers (ds-fcu.js) loaded first.
   ============================================================ */
(function () {
  'use strict';
  var MAX_MB = 60;
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = '../../assets/vendor/pdfjs/pdf.worker.min.js';

  function readerNames() {
    var r = window.DSParse.readers;
    return Object.keys(r).map(function (k) { return r[k].name; }).join(' or the ');
  }

  function file(f, onProgress) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return Promise.reject(new Error('"' + f.name + '" is not a PDF. Choose the datasheet PDF.'));
    if (f.size > MAX_MB * 1024 * 1024) return Promise.reject(new Error('"' + f.name + '" is larger than ' + MAX_MB + ' MB.'));
    if (!window.pdfjsLib) return Promise.reject(new Error('The PDF reader did not load. Refresh the page and try again.'));

    return f.arrayBuffer().then(function (buf) {
      return window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (pdf) {
      var pages = [], chain = Promise.resolve();
      for (var n = 1; n <= pdf.numPages; n++) (function (n) {
        chain = chain.then(function () { return pdf.getPage(n); })
          .then(function (page) { return page.getTextContent().then(function (tc) { pages.push(window.DSParse.lines(tc.items, n)); page.cleanup(); }); })
          .then(function () { if (onProgress) onProgress(f.name, n, pdf.numPages); });
      })(n);
      return chain.then(function () { pdf.cleanup(); return pages; });
    }).then(function (pages) {
      if (!pages.reduce(function (s, p) { return s + p.length; }, 0)) {
        throw new Error('This PDF has no text to read. It looks like a scan. Export the datasheet from the selection software as PDF.');
      }
      var units = window.DSParse.parseAll(pages).filter(function (d) { return d.unit.rows.length || d.sections.length; });
      if (!units.length) {
        throw new Error('No datasheet was found in "' + f.name + '". This tool reads the ' + readerNames() + '.');
      }
      return units;
    }, function (err) {
      throw new Error(err && err.name === 'PasswordException' ? 'This PDF is password protected. Remove the password and try again.'
        : err && err.name === 'InvalidPDFException' ? 'This file could not be opened as a PDF.'
        : (err && err.message) || 'The datasheet could not be read.');
    });
  }

  function files(list, onProgress) {
    var all = [], chain = Promise.resolve();
    [].forEach.call(list, function (f) { chain = chain.then(function () { return file(f, onProgress); }).then(function (u) { all = all.concat(u); }); });
    return chain.then(function () { return all; });
  }

  /* The datasheet must belong to the chosen product: an FCU report run as AHU would be mapped under
     the wrong product. Throws an Error with a message for the user. */
  function check(units, productId) {
    var id = String(productId || '').toLowerCase();
    var other = units.filter(function (u) { return u.type && u.type !== id; })[0];
    if (!other) return units;
    var r = window.DSParse.readers[other.type];
    throw new Error('"' + (other.hdr.unit || 'This unit') + '" is on a ' + other.type.toUpperCase() + ' datasheet (' + (r ? r.name : other.type) +
                    '). Choose ' + other.type.toUpperCase() + ' as the product, or choose a ' + id.toUpperCase() + ' datasheet.');
  }

  function progress(status) {
    return function (name, done, total) {
      if (total > 20 && (done === total || done % 10 === 0)) status('Reading ' + name + ': page ' + done + ' of ' + total + '\u2026');
    };
  }

  window.DSRead = { file: file, files: files, check: check, progress: progress };
})();
