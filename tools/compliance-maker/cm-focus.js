/* ============================================================
   Compliance - full-screen reading and filling, one clause at a time.
   Made for a phone held in one hand: big text, answer with one tap,
   swipe or tap to the next clause. Used by the project record page
   (tools/projects/record.html) and by Compliance review (library.html).

   CMFocus.open({
     title,                         name shown at the top
     items: [{ part, section, sr, spec, compliance, remarks,
               comments,            undefined = no Internal Comments box
               info,                small line under the answer ("From the library")
               lib,                 true = the answer shown is the library's (green)
               others: [text] }],   read-only lines, e.g. what users filled
     start,                         index to open on
     choices: [text],               one-tap answers
     save(item, { compliance, remarks, comments }) -> Promise of { info, lib }
                                    must update the item itself
     onClose()
   })
   Colours come from the theme tokens. Text is written with textContent.
   ============================================================ */
(function () {
  'use strict';
  var el = window.Hub.el, STYLE = 'cm-focus-style', open = null;

  var CSS = [
    '.cf { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; background: var(--bg); color: var(--text); }',
    '.cf-top { display: flex; align-items: center; gap: 10px; padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 10px; background: var(--surface); border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent); }',
    '.cf-top h2 { flex: 1 1 auto; min-width: 0; font-size: 15px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0; }',
    '.cf-count { font-size: 13px; color: var(--text-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }',
    '.cf-bar { height: 4px; background: var(--surface-2); } .cf-bar i { display: block; height: 100%; width: 0; background: var(--ok); transition: width .3s; }',
    '.cf-body { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 16px 16px 24px; }',
    '.cf-in { max-width: 760px; margin: 0 auto; display: grid; gap: 14px; }',
    '.cf-where { display: flex; gap: 6px; flex-wrap: wrap; }',
    '.cf-where span { font-size: 12px; font-weight: 650; padding: 3px 10px; border-radius: 999px; }',
    '.cf-where .p { background: var(--text); color: var(--bg); } .cf-where .s { background: color-mix(in srgb, var(--brand-sky) 38%, var(--surface)); }',
    '.cf-card { background: var(--surface); border: 1px solid color-mix(in srgb, var(--border) 55%, transparent); border-radius: 18px; box-shadow: var(--shadow); padding: 20px; display: grid; grid-template-columns: auto 1fr; gap: 12px; }',
    '.cf-sr { min-width: 34px; height: 34px; padding: 0 8px; border-radius: 10px; display: grid; place-items: center; background: var(--surface-2); color: var(--brand); font-weight: 700; }',
    '.cf-spec { font-size: 19px; line-height: 1.5; letter-spacing: -.01em; overflow-wrap: anywhere; }',
    '.cf-spec .hl-red { color: var(--danger); } .cf-spec .hl-redbold { color: var(--danger); font-weight: 700; } .cf-spec .hl-underline { text-decoration: underline; } .cf-spec .hl-colon { color: var(--warn); font-weight: 700; }',
    '.cf-label { font-size: 13px; font-weight: 650; margin-bottom: 6px; }',
    '.cf-chips { display: flex; flex-wrap: wrap; gap: 8px; }',
    '.cf-chip { font: inherit; font-size: 15px; font-weight: 600; min-height: 44px; padding: 0 16px; border-radius: 999px; cursor: pointer; background: var(--surface); color: var(--text); border: 1.5px solid var(--border); transition: transform .1s, background .15s, border-color .15s; }',
    '.cf-chip:hover { border-color: var(--brand); } .cf-chip:active { transform: scale(.96); }',
    '.cf-chip[aria-pressed="true"] { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }',
    '.cf .input { font-size: 16px; }',                                   /* 16px: a phone does not zoom in on focus */
    '.cf textarea.input { min-height: 84px; resize: vertical; }',
    '.cf.lib .cf-answer .input { background: var(--ok-bg); }',
    '.cf-state { min-height: 20px; font-size: 13px; color: var(--text-soft); } .cf-state.ok { color: var(--ok); font-weight: 600; } .cf-state.err { color: var(--danger); font-weight: 600; }',
    '.cf-others { display: grid; gap: 6px; } .cf-others div { padding: 8px 10px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 13px; overflow-wrap: anywhere; }',
    '.cf-nav { display: grid; grid-template-columns: 1fr 1.4fr 1fr; gap: 8px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)); background: var(--surface); border-top: 1px solid var(--border); }',
    '.cf-nav .btn { min-height: 48px; font-size: 15px; justify-content: center; }',
    '.cf-done { text-align: center; padding: 14px; border-radius: var(--radius); background: var(--ok-bg); color: var(--ok); font-weight: 650; }',
    '.cf-slide { animation: cf-in .18s ease-out; } .cf-slide.back { animation-name: cf-back; }',
    '@keyframes cf-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }',
    '@keyframes cf-back { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }',
    '@media (prefers-reduced-motion: reduce) { .cf-slide { animation: none; } .cf-chip, .cf-bar i { transition: none; } }',
    '@media (max-width: 560px) { .cf-spec { font-size: 17px; } .cf-card { padding: 14px; } .cf-body { padding: 12px 12px 20px; } }',
    'body.cf-open { overflow: hidden; }'
  ].join('\n');

  function filled(it) { return !!(it.compliance || it.remarks); }

  function start(o) {
    if (open) return;
    if (!document.getElementById(STYLE)) document.head.appendChild(el('style', { id: STYLE, text: CSS }));
    var items = o.items || [], i = Math.max(0, Math.min(o.start || 0, items.length - 1));
    if (!items.length) { window.Hub.toast('There is no clause to fill here.'); return; }

    var count = el('span', { 'class': 'cf-count' }), bar = el('i'), inner = el('div', { 'class': 'cf-in' });
    var body = el('div', { 'class': 'cf-body' }, [inner]);
    var prev = el('button', { type: 'button', 'class': 'btn ghost', text: 'Previous' });
    var next = el('button', { type: 'button', 'class': 'btn ghost', text: 'Next' });
    var todo = el('button', { type: 'button', 'class': 'btn', text: 'Next to fill' });
    var root = el('div', { 'class': 'cf', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title }, [
      el('div', { 'class': 'cf-top' }, [
        el('button', { type: 'button', 'class': 'btn ghost sm', text: 'Done', onclick: function () { leave(close); } }),
        el('h2', { text: o.title }), count]),
      el('div', { 'class': 'cf-bar' }, [bar]), body,
      el('div', { 'class': 'cf-nav' }, [prev, todo, next])
    ]);

    var comp, rem, note, state, saving = Promise.resolve();

    function progress() {
      var done = items.filter(filled).length;
      count.textContent = (i + 1) + ' of ' + items.length + ' · ' + done + ' filled';
      bar.style.width = Math.round(100 * done / items.length) + '%';
      prev.disabled = i === 0; next.disabled = i === items.length - 1;
      var more = items.some(function (it, k) { return k !== i && !filled(it); });
      todo.disabled = !more; todo.textContent = more ? 'Next to fill' : filled(items[i]) ? 'All filled' : 'Last one to fill';
    }

    /* Save what is in the boxes if it differs from the item. Resolves when the save is over. */
    function commit() {
      var it = items[i];
      var v = { compliance: comp.value.trim(), remarks: rem.value.trim(), comments: note ? note.value.trim() : undefined };
      if (v.compliance === (it.compliance || '') && v.remarks === (it.remarks || '') && (!note || v.comments === (it.comments || ''))) return saving;
      var st = state, at = i;
      st.className = 'cf-state'; st.textContent = 'Saving…';
      saving = saving.then(function () { return o.save(it, v); }).then(function (res) {
        if (at === i) {
          st.className = 'cf-state ok'; st.textContent = 'Saved' + (res && res.info ? ' · ' + res.info : '');
          root.classList.toggle('lib', !!(res && res.lib));
          comp.value = it.compliance || ''; rem.value = it.remarks || ''; chips();
        }
        progress();
      }, function (err) {
        if (at === i) { st.className = 'cf-state err'; st.textContent = 'Not saved: ' + ((err && err.message) || err); }
      });
      return saving;
    }
    function leave(then) { commit().then(then, then); }

    var chipBox;
    function chips() {
      [].forEach.call(chipBox.children, function (b) { b.setAttribute('aria-pressed', b.textContent.toLowerCase() === comp.value.trim().toLowerCase() ? 'true' : 'false'); });
    }

    function draw(back) {
      var it = items[i];
      inner.textContent = '';
      inner.className = 'cf-in cf-slide' + (back ? ' back' : '');
      root.classList.toggle('lib', !!it.lib);
      inner.appendChild(el('div', { 'class': 'cf-where' }, [it.part ? el('span', { 'class': 'p', text: it.part }) : null, it.section ? el('span', { 'class': 's', text: it.section }) : null]));
      var runs = window.CMHighlight ? window.CMHighlight.runs(it.spec) : [{ text: it.spec, style: '' }];
      inner.appendChild(el('div', { 'class': 'cf-card' }, [
        el('div', { 'class': 'cf-sr', text: it.sr || '•' }),
        el('div', { 'class': 'cf-spec' }, runs.map(function (r) { return r.style ? el('span', { 'class': 'hl-' + r.style, text: r.text }) : r.text; }))]));

      comp = el('input', { 'class': 'input', maxlength: '200', placeholder: 'Or type another answer', 'aria-label': 'Compliance' }); comp.value = it.compliance || '';
      rem = el('textarea', { 'class': 'input', maxlength: '4000', placeholder: 'Remarks (optional)', 'aria-label': 'Remarks' }); rem.value = it.remarks || '';
      note = it.comments === undefined ? null : el('textarea', { 'class': 'input', maxlength: '4000', placeholder: 'Internal comments, for the library team only', 'aria-label': 'Internal Comments' });
      if (note) note.value = it.comments || '';
      state = el('div', { 'class': 'cf-state', role: 'status', 'aria-live': 'polite', text: it.info || '' });
      chipBox = el('div', { 'class': 'cf-chips' }, (o.choices || []).map(function (c) {
        return el('button', { type: 'button', 'class': 'cf-chip', text: c, 'aria-pressed': 'false', onclick: function () {
          comp.value = comp.value.trim().toLowerCase() === c.toLowerCase() ? '' : c;      // a second tap takes the answer off
          try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* no haptics */ }
          chips(); commit();
        } });
      }));
      chips();
      comp.addEventListener('input', chips);
      [comp, rem, note].forEach(function (b) { if (b) b.addEventListener('change', commit); });
      inner.appendChild(el('div', { 'class': 'cf-answer' }, [el('div', { 'class': 'cf-label', text: 'Compliance' }), chipBox,
        el('div', { style: 'height:8px' }), comp, el('div', { style: 'height:10px' }), el('div', { 'class': 'cf-label', text: 'Remarks' }), rem,
        note ? el('div', { style: 'height:10px' }) : null, note ? el('div', { 'class': 'cf-label', text: 'Internal Comments' }) : null, note, state]));
      if (it.others && it.others.length) inner.appendChild(el('div', { 'class': 'cf-others' }, it.others.map(function (t) { return el('div', { text: t }); })));
      if (items.every(filled)) inner.appendChild(el('div', { 'class': 'cf-done', text: 'All ' + items.length + ' clauses are filled. Press Done.' }));
      body.scrollTop = 0; progress();
    }

    function go(to, back) { if (to < 0 || to >= items.length || to === i) return; leave(function () { i = to; draw(back); }); }
    function nextOpen() {
      leave(function () {
        for (var k = 1; k <= items.length; k++) { var j = (i + k) % items.length; if (j !== i && !filled(items[j])) { var back = j < i; i = j; draw(back); return; } }
        draw(false);
      });
    }
    prev.addEventListener('click', function () { go(i - 1, true); });
    next.addEventListener('click', function () { go(i + 1, false); });
    todo.addEventListener('click', nextOpen);

    // swipe left = next, right = previous (not while selecting text in a box)
    var sx = 0, sy = 0, tracking = false;
    body.addEventListener('touchstart', function (e) { var t = e.touches[0]; tracking = e.touches.length === 1 && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName); sx = t.clientX; sy = t.clientY; }, { passive: true });
    body.addEventListener('touchend', function (e) {
      if (!tracking) return; tracking = false;
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) { if (dx < 0) go(i + 1, false); else go(i - 1, true); }
    }, { passive: true });

    function key(e) {
      var typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === 'Escape') { e.preventDefault(); leave(close); }
      else if (!typing && e.key === 'ArrowRight') go(i + 1, false);
      else if (!typing && e.key === 'ArrowLeft') go(i - 1, true);
      else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); nextOpen(); }
    }
    function close() {
      document.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', commit);
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* not in full screen */ }
      root.remove(); document.body.classList.remove('cf-open'); open = null;
      if (o.onClose) o.onClose();
    }
    // the phone is put down or another app comes up: what is typed is saved first
    function hide() { if (document.visibilityState === 'hidden') commit(); }
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', commit);
    document.addEventListener('keydown', key);
    document.body.appendChild(root); document.body.classList.add('cf-open'); open = root;
    // real full screen where the browser has it (a phone browser or the installed app already fills the screen)
    try { if (root.requestFullscreen && window.matchMedia('(min-width: 700px)').matches) root.requestFullscreen().then(null, function () { /* stays as an overlay */ }); } catch (e) { /* overlay */ }
    draw(false);
  }

  window.CMFocus = { open: start, isOpen: function () { return !!open; } };
})();
