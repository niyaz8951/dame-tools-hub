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
    checklist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17M11 6h10M11 12h10M11 18h10"/></svg>',
    table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/></svg>',
    tree: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/></svg>',
    coil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7c3-3 6 3 9 0s6 3 9 0M3 12c3-3 6 3 9 0s6 3 9 0M3 17c3-3 6 3 9 0s6 3 9 0"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></svg>',
    curve: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 17c6-1 10-4 12-11"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
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
  // One session per user. The sign-in is kept in localStorage so every tab of this browser
  // shares it; signing in anywhere else ends it (the database keeps one session per user).
  var SIGNED_OUT = "You were signed out. This account signed in somewhere else, or the session ended.";
  function token() { return sget(localStorage, TOKEN_KEY); }
  function setToken(t) { sset(localStorage, TOKEN_KEY, t); sset(sessionStorage, TOKEN_KEY, null); }
  function onLoginPage() { var here = window.location.href.split(/[?#]/)[0]; return here === url("index.html") || here === url(""); }
  function expired() {
    setToken(null);
    if (onLoginPage()) return;
    sset(sessionStorage, "dame_hub_msg", SIGNED_OUT);
    go("index.html");
  }
  // Another tab signed out or signed in: this tab follows.
  window.addEventListener("storage", function (e) {
    if (e.key !== TOKEN_KEY || e.newValue === e.oldValue || leaving) return;
    if (!e.newValue) { if (!onLoginPage()) go("index.html"); }
    else window.location.reload();
  });
  // Any database call that finds the session ended sends the user to the sign-in page
  // instead of showing a raw error in the middle of a tool.
  Object.keys(window.Api || {}).forEach(function (name) {
    var fn = window.Api[name];
    if (typeof fn !== "function" || name === "login" || name === "register") return;
    window.Api[name] = function () {
      return fn.apply(window.Api, arguments).then(null, function (err) {
        if (err && err.message === "SESSION_EXPIRED" && !leaving) { expired(); return new Promise(function () {}); }
        throw err;
      });
    };
  });
  function logout() {
    var t = token(); setToken(null);
    var done = function () { go("index.html"); };
    if (t) window.Api.logout(t).then(done, done); else done();
  }

  // ---------- roles ----------
  // superuser: the site owner (one account). admin: approves users and may edit every tool's data.
  // user: runs the tools; may be given edit access to single tools (profile.user.edit_tools).
  var ROLE_LABEL = { superuser: "Super user", admin: "Admin", user: "User" };
  function roleLabel(role) { return ROLE_LABEL[role] || "User"; }
  function isAdmin(user) { return !!user && (user.role === "admin" || user.role === "superuser"); }
  function isSuper(user) { return !!user && user.role === "superuser"; }
  // The database decides; this only mirrors it so pages can show or hide buttons.
  function canEdit(profile, toolId) {
    var u = profile && profile.user;
    return !!u && (u.edit_tools || []).indexOf(toolId) >= 0;
  }

  /* Guard for every protected page.
       Hub.requireLogin()                      - any approved user
       Hub.requireLogin({ admin: true })       - admins and the super user
       Hub.requireLogin({ super: true })       - the super user only
       Hub.requireLogin({ tool: "tool-id" })   - only users whose team has this tool
       Hub.requireLogin({ edit: "tool-id" })   - only users who may edit this tool's data
     Resolves with the profile { user, categories } and draws the top bar. */
  // No access to this page: back to the dashboard, which says so once.
  var NO_ACCESS_KEY = "dame_hub_no_access";
  function noAccess() { sset(sessionStorage, NO_ACCESS_KEY, "1"); go("dashboard.html"); return new Promise(function () {}); }
  function requireLogin(opts) {
    opts = opts || {};
    var t = token();
    if (!t) { go("index.html"); return new Promise(function () {}); }
    return window.Api.me(t).then(function (profile) {
      if (opts.admin && !isAdmin(profile.user)) return noAccess();
      if (opts["super"] && !isSuper(profile.user)) return noAccess();
      if (opts.edit && !canEdit(profile, opts.edit)) return noAccess();
      if (opts.tool) {
        var ok = profile.categories.some(function (c) {
          return c.allowed && c.tools.some(function (x) { return x.id === opts.tool; });
        });
        if (!ok) return noAccess();
      }
      renderTopbar(profile);
      document.documentElement.removeAttribute("data-loading");
      // an edit screen opened from the Admin page goes back to the Admin page
      if (param("from") === "admin" && isAdmin(profile.user)) setBack("Admin", url("admin.html"));
      setTimeout(autoBack, 0);                              // after the page's own code has run
      if (sget(sessionStorage, NO_ACCESS_KEY)) { sset(sessionStorage, NO_ACCESS_KEY, null); toast("That page is not available for your account."); }
      return profile;
    }, function (err) {
      // Leaving the page cancels the check. That is not a sign-out.
      if (leaving) return new Promise(function () {});
      if (err && err.message === "SESSION_EXPIRED") { expired(); return new Promise(function () {}); }
      // Network or database problem: keep the session, keep the page hidden, offer a retry.
      showBlocked((err && err.message) || "Cannot reach the database.");
      return new Promise(function () {});
    });
  }

  var leaving = false;
  window.addEventListener("pagehide", function () { leaving = true; });
  window.addEventListener("beforeunload", function () { leaving = true; });
  window.addEventListener("pageshow", function () { leaving = false; });

  function showBlocked(message) {
    if (document.getElementById("hubBlocked")) return;
    var box = el("div", { id: "hubBlocked", role: "alert",
      style: "visibility:visible;position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:24px;" +
             "background:var(--bg);color:var(--text);font:15px/1.5 var(--font);text-align:center" }, [
      el("div", {}, [
        el("p", { style: "font-weight:650;font-size:18px;margin:0 0 6px", text: "Could not check your sign-in" }),
        el("p", { style: "margin:0 0 16px;color:var(--text-soft)", text: message }),
        el("button", { type: "button", text: "Try again",
          style: "font:600 14px var(--font);min-height:38px;padding:0 16px;border:0;border-radius:8px;background:var(--brand);color:#fff;cursor:pointer",
          onclick: function () { window.location.reload(); } })
      ])
    ]);
    document.body.appendChild(box);
  }

  // ---------- top bar ----------
  function themeButton(extra) {
    return el("button", { "class": "btn ghost icon" + (extra || ""), type: "button", "data-theme-toggle": true, onclick: toggleTheme });
  }
  // Round profile picture, or the person's initials when there is none.
  function avatar(user, size) {
    size = size || 32;
    var box = el("span", { "class": "avatar", style: "width:" + size + "px;height:" + size + "px;font-size:" + Math.round(size * 0.4) + "px", "aria-hidden": "true" });
    if (user.avatar && /^data:image\/(jpeg|png|webp);base64,/.test(user.avatar)) {
      box.appendChild(el("img", { src: user.avatar, alt: "" }));
    } else {
      var parts = String(user.full_name || user.username || "?").trim().split(/\s+/);
      box.textContent = (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")).toUpperCase();
    }
    return box;
  }

  function renderTopbar(profile) {
    var host = document.getElementById("topbar");
    if (!host) return;
    var user = profile.user;
    host.className = "topbar"; host.textContent = "";
    host.appendChild(el("a", { "class": "brand", href: url("dashboard.html") }, [
      el("span", { "class": "brand-mark", "aria-hidden": "true" }), cfg.SITE_NAME || "Tools Hub"
    ]));
    // Back button: always in the same place, on every page that has somewhere to go back to.
    host.appendChild(el("a", { "class": "back-btn", id: "hubBack", href: "#", hidden: true }, [
      el("span", { "aria-hidden": "true", html: ICON.back }),
      el("span", { "class": "back-long" }), el("span", { "class": "back-short", text: "Back" })
    ]));
    host.appendChild(el("span", { "class": "spacer" }));
    host.appendChild(themeButton());

    // account menu
    var menu = el("div", { "class": "menu", role: "menu", hidden: true }, [
      el("div", { "class": "menu-head" }, [
        el("b", { text: user.full_name }),
        el("span", { text: user.username + (isAdmin(user) ? " \u00b7 " + roleLabel(user.role) : "") })
      ]),
      el("a", { role: "menuitem", href: url("dashboard.html"), text: "Dashboard" }),
      el("a", { role: "menuitem", href: url("profile.html"), text: "My profile" }),
      el("a", { role: "menuitem", href: url("profile.html#password"), text: "Change password" }),
      isAdmin(user) ? el("a", { role: "menuitem", href: url("admin.html"), text: "Admin" }) : null,
      el("button", { role: "menuitem", type: "button", text: "Log out", onclick: logout })
    ]);
    var trigger = el("button", { "class": "account", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Account menu for " + user.full_name }, [
      avatar(user, 32), el("span", { "class": "account-name", text: String(user.full_name).split(" ")[0] }),
      el("span", { "class": "caret", "aria-hidden": "true" })
    ]);
    function setOpen(open) { menu.hidden = !open; trigger.setAttribute("aria-expanded", open ? "true" : "false"); }
    trigger.addEventListener("click", function (e) { e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener("click", function (e) { if (!menu.contains(e.target)) setOpen(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { setOpen(false); trigger.focus(); } });
    host.appendChild(el("div", { "class": "account-wrap" }, [trigger, menu]));

    if (window.Api.isDemo && !document.querySelector(".demo-bar")) {
      host.parentNode.insertBefore(el("div", { "class": "demo-bar", text: "Demo mode: no database connected. Data stays in this browser only." }), host);
    }
    applyTheme(currentTheme());
  }

  /* The back button in the top bar.
       Hub.setBack("General", url)      show "Back to General" leading to url
       Hub.setBack("General", fn)       same, but run fn on click (views inside one page)
       Hub.setBack(null)                no back button
     Pages need not call it: the first back link of a page (".hub-back a", or the link in
     ".page-head p.small") is picked up after the sign-in check and moved up here. A page whose
     target depends on what is open (dashboard, a tool opened from a project) calls it itself. */
  var backAction = null;
  function setBack(label, target) {
    var btn = document.getElementById("hubBack");
    if (!btn) return;
    backAction = typeof target === "function" ? target : null;
    btn.hidden = !label;
    if (!label) return;
    btn.href = typeof target === "string" ? target : "#";
    btn.querySelector(".back-long").textContent = "Back to " + label;
    btn.setAttribute("aria-label", "Back to " + label);
    if (!btn.dataset.wired) {
      btn.dataset.wired = "1";
      btn.addEventListener("click", function (e) { if (backAction) { e.preventDefault(); backAction(); } });
    }
  }
  function autoBack() {
    var btn = document.getElementById("hubBack");
    if (!btn || !btn.hidden) return;                       // the page set it already
    var link = document.querySelector(".hub-back a, main .page-head p.small > a, p.small > a#back, a.psy-back");
    if (!link || link.closest("[hidden]")) return;
    var label = link.textContent.replace(/^[\s\u2190<-]+/, "").trim();
    if (!label) return;
    setBack(label, function () { link.click(); });        // the link keeps deciding where it goes
    btn.href = link.href;
    var row = link.closest("p"); if (row) row.hidden = true;
  }
  function param(name) { try { return new URLSearchParams(window.location.search).get(name) || ""; } catch (e) { return ""; } }

  window.Hub = {
    setBack: setBack, param: param,
    ICON: ICON, el: el, toast: toast, url: url, go: go,
    token: token, setToken: setToken, logout: logout,
    requireLogin: requireLogin, themeButton: themeButton, avatar: avatar, renderTopbar: renderTopbar,
    roleLabel: roleLabel, isAdmin: isAdmin, isSuper: isSuper, canEdit: canEdit,
    applyTheme: applyTheme, currentTheme: currentTheme,
    takeMessage: function () { var m = sget(sessionStorage, "dame_hub_msg"); sset(sessionStorage, "dame_hub_msg", null); return m; }
  };
})();
