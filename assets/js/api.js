/* ============================================================
   DAME Tools Hub - data layer.
   Pages never talk to the database directly; they call Api.*.
   Two back ends behind the same functions:
     - Supabase: calls the app_* functions from db/schema.sql
     - Demo:     in-browser stand-in so the site can be previewed
   ============================================================ */
(function () {
  "use strict";
  var cfg = window.HUB_CONFIG || {};
  var DEMO = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY;

  // ---------- Supabase back end ----------
  function rpc(fn, args) {
    return fetch(cfg.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + cfg.SUPABASE_ANON_KEY
      },
      body: JSON.stringify(args || {})
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok) {
          var msg = (body && (body.message || body.error)) || ("Request failed (" + res.status + ")");
          throw new Error(msg);
        }
        if (body && body.ok === false) throw new Error(body.error || "Request failed");
        return body;
      });
    }, function () {
      throw new Error("Cannot reach the database. Check your network connection.");
    });
  }

  var supabaseApi = {
    register: function (d) { return rpc("app_register", { p_username: d.username, p_full_name: d.fullName, p_password: d.password, p_team_note: d.teamNote || "" }); },
    login: function (u, p) { return rpc("app_login", { p_username: u, p_password: p }); },
    me: function (t) { return rpc("app_me", { p_token: t }); },
    logout: function (t) { return rpc("app_logout", { p_token: t }); },
    changePassword: function (t, o, n) { return rpc("app_change_password", { p_token: t, p_old: o, p_new: n }); },
    adminOverview: function (t) { return rpc("app_admin_overview", { p_token: t }); },
    adminSetUser: function (t, d) { return rpc("app_admin_set_user", { p_token: t, p_user_id: d.id, p_status: d.status, p_role: d.role, p_categories: d.categories }); },
    adminResetPassword: function (t, id, pw) { return rpc("app_admin_reset_password", { p_token: t, p_user_id: id, p_new_password: pw }); },
    adminDeleteUser: function (t, id) { return rpc("app_admin_delete_user", { p_token: t, p_user_id: id }); },
    adminSaveTool: function (t, d) { return rpc("app_admin_save_tool", { p_token: t, p_id: d.id, p_category_id: d.category_id, p_name: d.name, p_description: d.description, p_path: d.path, p_status: d.status, p_sort: d.sort }); },
    adminSaveCategory: function (t, d) { return rpc("app_admin_save_category", { p_token: t, p_id: d.id, p_name: d.name, p_description: d.description, p_sort: d.sort, p_is_default: d.is_default }); }
  };

  // ---------- Demo back end (preview only, NOT secure) ----------
  var KEY = "dame_hub_demo_db", mem = null;
  function seed() {
    return {
      users: [
        { id: "u1", username: "admin", full_name: "Demo Admin", team_note: "", password: "admin12345", role: "admin", status: "approved", created_at: new Date().toISOString(), last_login_at: null, categories: [] },
        { id: "u2", username: "sales.user", full_name: "Sales User", team_note: "Sales", password: "sales12345", role: "user", status: "approved", created_at: new Date().toISOString(), last_login_at: null, categories: ["sales"] },
        { id: "u3", username: "new.joiner", full_name: "New Joiner", team_note: "SBU", password: "joiner12345", role: "user", status: "pending", created_at: new Date().toISOString(), last_login_at: null, categories: [] }
      ],
      categories: [
        { id: "general", name: "General", description: "Tools open to every approved user", sort: 10, is_default: true },
        { id: "sales", name: "Sales", description: "Costing, selection and quotation tools", sort: 20, is_default: false },
        { id: "sbu", name: "SBU", description: "Tools for the SBU team", sort: 30, is_default: false }
      ],
      tools: [
        { id: "compliance-maker", category_id: "general", name: "Compliance Maker", description: "Turn a specification into a clause-by-clause compliance statement.", path: "tools/compliance-maker/", status: "soon", sort: 10 }
      ],
      sessions: {}
    };
  }
  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY)); } catch (e) { mem = null; }
    if (!mem || !mem.users) mem = seed();
    return mem;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* memory only */ } }
  function fail(m) { throw new Error(m); }
  function bySort(a, b) { return (a.sort - b.sort) || a.name.localeCompare(b.name); }
  function sessionUser(db, token) {
    var u = db.users.filter(function (x) { return x.id === db.sessions[token]; })[0];
    if (!u || u.status !== "approved") fail("SESSION_EXPIRED");
    return u;
  }
  function admin(db, token) { var u = sessionUser(db, token); if (u.role !== "admin") fail("Admin access required."); return u; }
  function profile(db, u) {
    return {
      user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role },
      categories: db.categories.slice().sort(bySort).map(function (c) {
        var allowed = u.role === "admin" || c.is_default || u.categories.indexOf(c.id) >= 0;
        return {
          id: c.id, name: c.name, description: c.description, allowed: allowed,
          tools: allowed ? db.tools.filter(function (t) { return t.category_id === c.id && t.status !== "hidden"; }).sort(bySort) : []
        };
      })
    };
  }
  function checkPw(p) { if (!p || p.length < 8) fail("Password must be at least 8 characters."); }
  function demo(fn) {
    return function () {
      var args = arguments;
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try { var db = load(); var out = fn.apply(null, [db].concat([].slice.call(args))); save(); resolve(out); }
          catch (e) { reject(e); }
        }, 120);
      });
    };
  }
  var demoApi = {
    register: demo(function (db, d) {
      var name = (d.username || "").trim();
      if (!/^[A-Za-z0-9._-]{3,30}$/.test(name)) fail("Username must be 3-30 characters: letters, numbers, dot, dash or underscore.");
      if ((d.fullName || "").trim().length < 2) fail("Please enter your full name.");
      checkPw(d.password);
      if (db.users.some(function (u) { return u.username.toLowerCase() === name.toLowerCase(); })) fail("That username is already taken.");
      db.users.push({ id: "u" + Date.now(), username: name, full_name: d.fullName.trim(), team_note: (d.teamNote || "").trim(), password: d.password, role: "user", status: "pending", created_at: new Date().toISOString(), last_login_at: null, categories: [] });
      return { ok: true };
    }),
    login: demo(function (db, username, password) {
      var u = db.users.filter(function (x) { return x.username.toLowerCase() === (username || "").trim().toLowerCase(); })[0];
      if (!u || u.password !== password) fail("Wrong username or password.");
      if (u.status === "pending") fail("Your account is waiting for admin approval.");
      if (u.status !== "approved") fail("This account is not active. Please contact the admin.");
      var token = "demo-" + Math.random().toString(36).slice(2) + Date.now();
      db.sessions[token] = u.id; u.last_login_at = new Date().toISOString();
      var p = profile(db, u); p.ok = true; p.token = token; return p;
    }),
    me: demo(function (db, t) { return profile(db, sessionUser(db, t)); }),
    logout: demo(function (db, t) { delete db.sessions[t]; return { ok: true }; }),
    changePassword: demo(function (db, t, o, n) {
      var u = sessionUser(db, t); if (u.password !== o) fail("Current password is wrong."); checkPw(n); u.password = n; return { ok: true };
    }),
    adminOverview: demo(function (db, t) {
      admin(db, t);
      return {
        users: db.users.map(function (u) { var c = {}; for (var k in u) if (k !== "password") c[k] = u[k]; return c; })
          .sort(function (a, b) { return (b.status === "pending") - (a.status === "pending") || b.created_at.localeCompare(a.created_at); }),
        categories: db.categories.slice().sort(bySort),
        tools: db.tools.slice().sort(bySort)
      };
    }),
    adminSetUser: demo(function (db, t, d) {
      admin(db, t);
      var u = db.users.filter(function (x) { return x.id === d.id; })[0]; if (!u) fail("User not found.");
      var others = db.users.filter(function (x) { return x.role === "admin" && x.status === "approved" && x.id !== u.id; }).length;
      if (u.role === "admin" && u.status === "approved" && (d.role !== "admin" || d.status !== "approved") && !others) fail("You cannot remove the last active admin.");
      u.status = d.status; u.role = d.role; u.categories = d.categories || [];
      return { ok: true };
    }),
    adminResetPassword: demo(function (db, t, id, pw) {
      admin(db, t); checkPw(pw);
      var u = db.users.filter(function (x) { return x.id === id; })[0]; if (!u) fail("User not found."); u.password = pw; return { ok: true };
    }),
    adminDeleteUser: demo(function (db, t, id) {
      var a = admin(db, t); var u = db.users.filter(function (x) { return x.id === id; })[0];
      if (!u) fail("User not found."); if (u.id === a.id) fail("You cannot delete your own account.");
      if (u.status === "approved") fail("Disable the user first, then delete.");
      db.users = db.users.filter(function (x) { return x.id !== id; }); return { ok: true };
    }),
    adminSaveTool: demo(function (db, t, d) {
      admin(db, t);
      if (!/^[a-z0-9-]{2,40}$/.test(d.id || "")) fail("Tool id must be lowercase letters, numbers and dashes.");
      if ((d.name || "").trim().length < 2) fail("Tool name is required.");
      if (d.path && !/^tools\/[a-z0-9-]+\/$/.test(d.path)) fail("Path must look like tools/my-tool/");
      db.tools = db.tools.filter(function (x) { return x.id !== d.id; }); db.tools.push(d); return { ok: true };
    }),
    adminSaveCategory: demo(function (db, t, d) {
      admin(db, t);
      if (!/^[a-z0-9-]{2,30}$/.test(d.id || "")) fail("Category id must be lowercase letters, numbers and dashes.");
      if ((d.name || "").trim().length < 2) fail("Category name is required.");
      db.categories = db.categories.filter(function (x) { return x.id !== d.id; }); db.categories.push(d); return { ok: true };
    })
  };

  window.Api = DEMO ? demoApi : supabaseApi;
  window.Api.isDemo = DEMO;
})();
