/* ============================================================
   Datasheet Notes - open a datasheet PDF in the browser.
   DSRead.file(file) -> Promise of the structured data from DSParse.parse().
   Rejects with an Error whose message can be shown to the user as it is.
   Needs assets/vendor/pdfjs/pdf.min.js and ds-parse.js loaded first.
   ============================================================ */
(function () {
  'use strict';
  var MAX_MB = 25;
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = '../../assets/vendor/pdfjs/pdf.worker.min.js';

  function file(f) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') return Promise.reject(new Error('"' + f.name + '" is not a PDF. Choose the datasheet PDF.'));
    if (f.size > MAX_MB * 1024 * 1024) return Promise.reject(new Error('This file is larger than ' + MAX_MB + ' MB. Choose the datasheet PDF for one unit.'));
    if (!window.pdfjsLib) return Promise.reject(new Error('The PDF reader did not load. Refresh the page and try again.'));

    return f.arrayBuffer().then(function (buf) {
      return window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (pdf) {
      var pages = [], chain = Promise.resolve();
      for (var n = 1; n <= pdf.numPages; n++) (function (n) {
        chain = chain.then(function () { return pdf.getPage(n); })
          .then(function (page) { return page.getTextContent(); })
          .then(function (tc) { pages.push(window.DSParse.lines(tc.items, n)); });
      })(n);
      return chain.then(function () { return pages; });
    }).then(function (pages) {
      if (!pages.reduce(function (s, p) { return s + p.length; }, 0)) {
        throw new Error('This PDF has no text to read. It looks like a scan. Export the datasheet from the selection software as PDF.');
      }
      var data = window.DSParse.parse(pages);
      if (!data.unit.rows.length && !data.sections.length) {
        throw new Error('No "Unit Data" or numbered sections were found. This tool reads the Daikin AHU technical report (ASTRAWEB).');
      }
      return data;
    }, function (err) {
      throw new Error(err && err.name === 'PasswordException' ? 'This PDF is password protected. Remove the password and try again.'
        : err && err.name === 'InvalidPDFException' ? 'This file could not be opened as a PDF.'
        : (err && err.message) || 'The datasheet could not be read.');
    });
  }

  window.DSRead = { file: file };
})();
