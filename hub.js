/* ============================================================
   DAME Tools Hub - shared shell.
   Gives every page: day/night theme, session handling, the top
   bar, and the access guard. Load order on every page:
       config.js  ->  api.js  ->  hub.js
   ============================================================ */
(function () {
  "use strict";
  var cfg = window.HUB_CONFIG || {};
  var ROOT = new URL("../../", document.currentScript.src).href;   // site root, works from any folder depth
  var TOKEN_KEY = "dame_hub_token", THEME_KEY = "dame_hub_theme";

  // ---------- small storage helpers (storage can be blocked) ----------
  function sget(store, k) { try { return store.getItem(k); } catch (e) { return null; } }
  function sset(store, k, v) { try { v === null ? store.removeItem(k) : store.setItem(k, v); } catch (e) { /* ignore */ } }

  // ---------- theme (applied before first paint) ----------
  function systemTheme() { return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  function currentTheme() { return document.documentElement.getAttribute("data-theme"); }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    var btns = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].innerHTML = t === "dark" ? ICON.sun : ICON.moon;
      btns[i].setAttribute("aria-label", t === "dark" ? "Switch to day mode" : "Switch to night mode");
      btns[i].title = btns[i].getAttribute("aria-label");
    }
  }
  function toggleTheme() { var t = currentTheme() === "dark" ? "light" : "dark"; sset(localStorage, THEME_KEY, t); applyTheme(t); }

  var ICON = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3z"/><path d="M14.7 6.3 17 4a5 5 0 0 0-6.6 6.6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>'
  };

  applyTheme(sget(localStorage, THEME_KEY) || systemTheme());

  // ---------- helpers ----------
  function el(tag, attrs, children) {
    var n = document.createElement(tag), k;
    for (k in (attrs || {})) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];            // only ever used with the ICON constants above
      else if (k.indexOf("on") === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    }
    [].concat(children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  var toastTimer;
  function toast(msg, isError) {
    var t = document.querySelector(".toast") || document.body.appendChild(el("div", { "class": "toast", role: "status" }));
    t.textContent = msg; t.className = "toast" + (isError ? " error" : ""); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function url(path) { return ROOT + (path || ""); }
  function go(path) { window.location.href = url(path); }

  // ---------- session ----------
  function token() { return sget(sessionStorage, TOKEN_KEY); }
  function setToken(t) { sset(sessionStorage, TOKEN_KEY, t); }
  function logout() {
    var t = token(); setToken(null);
    var done = function () { go("index.html"); };
    if (t) window.Api.logout(t).then(done, done); else done();
  }

  /* Guard for every protected page.
       Hub.requireLogin()                      - any approved user
       Hub.requireLogin({ admin: true })       - admins only
       Hub.requireLogin({ tool: "tool-id" })   - only users whose team has this tool
     Resolves with the profile { user, categories } and draws the top bar. */
  function requireLogin(opts) {
    opts = opts || {};
    var t = token();
    if (!t) { go("index.html"); return new Promise(function () {}); }
    return window.Api.me(t).then(function (profile) {
      if (opts.admin && profile.user.role !== "admin") { go("dashboard.html"); return new Promise(function () {}); }
      if (opts.tool) {
        var ok = profile.categories.some(function (c) {
          return c.allowed && c.tools.some(function (x) { return x.id === opts.tool; });
        });
        if (!ok) { go("dashboard.html"); return new Promise(function () {}); }
      }
      renderTopbar(profile);
      document.documentElement.removeAttribute("data-loading");
      return profile;
    }, function (err) {
      setToken(null);
      if (err && err.message !== "SESSION_EXPIRED") sset(sessionStorage, "dame_hub_msg", err.message);
      go("index.html");
      return new Promise(function () {});
    });
  }

  // ---------- top bar ----------
  function themeButton(extra) {
    return el("button", { "class": "btn ghost icon" + (extra || ""), type: "button", "data-theme-toggle": true, onclick: toggleTheme });
  }
  function renderTopbar(profile) {
    var host = document.getElementById("topbar");
    if (!host) return;
    host.className = "topbar"; host.textContent = "";
    host.appendChild(el("a", { "class": "brand", href: url("dashboard.html") }, [
      el("span", { "class": "brand-mark", "aria-hidden": "true" }), cfg.SITE_NAME || "Tools Hub"
    ]));
    host.appendChild(el("span", { "class": "spacer" }));
    host.appendChild(el("span", { "class": "who" }, [
      el("b", { text: profile.user.full_name }),
      el("span", { text: profile.user.role === "admin" ? "Admin" : profile.user.username })
    ]));
    if (profile.user.role === "admin") host.appendChild(el("a", { "class": "btn ghost sm", href: url("admin.html"), text: "Admin" }));
    host.appendChild(themeButton());
    host.appendChild(el("button", { "class": "btn ghost sm", type: "button", text: "Log out", onclick: logout }));
    if (window.Api.isDemo && !document.querySelector(".demo-bar")) {
      host.parentNode.insertBefore(el("div", { "class": "demo-bar", text: "Demo mode: no database connected. Data stays in this browser only." }), host);
    }
    applyTheme(currentTheme());
  }

  window.Hub = {
    ICON: ICON, el: el, toast: toast, url: url, go: go,
    token: token, setToken: setToken, logout: logout,
    requireLogin: requireLogin, themeButton: themeButton,
    applyTheme: applyTheme, currentTheme: currentTheme,
    takeMessage: function () { var m = sget(sessionStorage, "dame_hub_msg"); sset(sessionStorage, "dame_hub_msg", null); return m; }
  };
})();
