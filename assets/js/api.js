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
    updateProfile: function (t, d) { return rpc("app_update_profile", { p_token: t, p_full_name: d.fullName, p_avatar: d.avatar || "" }); },
    adminOverview: function (t) { return rpc("app_admin_overview", { p_token: t }); },
    adminSetUser: function (t, d) { return rpc("app_admin_set_user", { p_token: t, p_user_id: d.id, p_status: d.status, p_role: d.role, p_categories: d.categories, p_edit_tools: d.editTools || [] }); },
    adminResetPassword: function (t, id, pw) { return rpc("app_admin_reset_password", { p_token: t, p_user_id: id, p_new_password: pw }); },
    adminDeleteUser: function (t, id) { return rpc("app_admin_delete_user", { p_token: t, p_user_id: id }); },
    adminSaveTool: function (t, d) { return rpc("app_admin_save_tool", { p_token: t, p_id: d.id, p_category_id: d.category_id, p_name: d.name, p_description: d.description, p_path: d.path, p_status: d.status, p_sort: d.sort, p_editable: !!d.editable }); },
    // Compliance Maker library
    cmOptions: function (t) { return rpc("cm_options", { p_token: t }); },
    cmSaveRun: function (t, d) { return rpc("cm_save_run", { p_token: t, p_factory_id: d.factoryId, p_source: d.source, p_file_name: d.fileName || "", p_lines: d.lines }); },
    cmAdminLines: function (t, d) { return rpc("cm_admin_lines", { p_token: t, p_factory_id: d.factoryId, p_status: d.status || "open", p_search: d.search || "", p_limit: d.limit || 50, p_offset: d.offset || 0 }); },
    cmAdminSaveAnswer: function (t, id, c, r) { return rpc("cm_admin_save_answer", { p_token: t, p_line_id: id, p_compliance: c, p_remarks: r }); },
    cmAdminDeleteLine: function (t, id) { return rpc("cm_admin_delete_line", { p_token: t, p_line_id: id }); },
    cmAdminImport: function (t, d) { return rpc("cm_admin_import", { p_token: t, p_factory_id: d.factoryId, p_file_name: d.fileName || "", p_rows: d.rows }); },
    cmAdminRuns: function (t, d) { return rpc("cm_admin_runs", { p_token: t, p_limit: (d && d.limit) || 50, p_offset: (d && d.offset) || 0 }); },
    cmAdminExport: function (t, factoryId) { return rpc("cm_admin_export", { p_token: t, p_factory_id: factoryId }); },
    // Datasheet Notes row mapping
    dnRules: function (t, productId) { return rpc("dn_get_rules", { p_token: t, p_product_id: productId }); },
    dnAddRows: function (t, d) { return rpc("dn_add_rows", { p_token: t, p_product_id: d.productId, p_rows: d.rows || [] }); },
    dnAdminSaveRules: function (t, d) { return rpc("dn_admin_save_rules", { p_token: t, p_product_id: d.productId, p_show_unmapped: d.showUnmapped !== false, p_rules: d.rules || [], p_remove: d.remove || [] }); },
    adminSaveCategory: function (t, d) { return rpc("app_admin_save_category", { p_token: t, p_id: d.id, p_name: d.name, p_description: d.description, p_sort: d.sort, p_is_default: d.is_default }); }
  };

  // ---------- Demo back end (preview only, NOT secure) ----------
  var KEY = "dame_hub_demo_db_v5", mem = null;
  function seed() {
    return {
      users: [
        { id: "u1", username: "admin", full_name: "Demo Super User", team_note: "", password: "admin12345", role: "superuser", status: "approved", created_at: new Date().toISOString(), last_login_at: null, categories: [], edit_tools: [] },
        { id: "u4", username: "team.admin", full_name: "Team Admin", team_note: "Sales", password: "admin12345", role: "admin", status: "approved", created_at: new Date().toISOString(), last_login_at: null, categories: [], edit_tools: [] },
        { id: "u2", username: "sales.user", full_name: "Sales User", team_note: "Sales", password: "sales12345", role: "user", status: "approved", created_at: new Date().toISOString(), last_login_at: null, categories: ["sales"], edit_tools: ["compliance-maker"] },
        { id: "u3", username: "new.joiner", full_name: "New Joiner", team_note: "SBU", password: "joiner12345", role: "user", status: "pending", created_at: new Date().toISOString(), last_login_at: null, categories: [], edit_tools: [] }
      ],
      categories: [
        { id: "general", name: "General", description: "Everyday productivity tools", sort: 10, is_default: true },
        { id: "sales", name: "Sales", description: "Costing, selection and quotation tools", sort: 20, is_default: false },
        { id: "sbu", name: "SBU", description: "Specialised SBU tools", sort: 30, is_default: false }
      ],
      tools: [
        { id: "compliance-maker", category_id: "general", name: "Compliance Maker", description: "Turn a specification PDF into a ready-to-fill compliance matrix in Excel.", path: "tools/compliance-maker/", status: "live", sort: 10, editable: true },
        { id: "datasheet-notes", category_id: "general", name: "Datasheet Notes", description: "Turn a product datasheet PDF into an Excel table of unit data, sections and options.", path: "tools/datasheet-notes/", status: "live", sort: 15, editable: true },
        { id: "coil-data-extractor", category_id: "general", name: "Coil Data Extractor", description: "Turn coil selection quotations in Word or PDF into one Excel table, one row per coil.", path: "tools/coil-data-extractor/", status: "live", sort: 20 },
        { id: "container-calculator", category_id: "general", name: "Container Calculator", description: "Work out how many containers or trailers a shipment needs, with a load plan and PDF report.", path: "tools/container-calculator/", status: "live", sort: 30 },
        { id: "centre-of-gravity", category_id: "general", name: "Centre of Gravity", description: "Build a unit from blocks, find its centre of gravity and the load on every mounting foot.", path: "tools/centre-of-gravity/", status: "live", sort: 40 }
      ],
      sessions: {},
      cm: {
        products: [
          { id: "ahu", name: "AHU", factories: [{ id: "ahu-dubai", name: "Dubai" }, { id: "ahu-riyadh", name: "Riyadh" }] },
          { id: "fcu", name: "FCU", factories: [{ id: "fcu-shenzhen", name: "Shenzhen" }, { id: "fcu-riyadh", name: "Riyadh" }] },
          { id: "chiller", name: "Chiller", factories: [{ id: "chiller-italy", name: "Italy" }, { id: "chiller-jeddah", name: "Jeddah" }] }
        ],
        lines: [], runs: []
      }
    };
  }
  function load() {
    // Re-read every time so two tabs (for example a user and an admin) see each other's changes.
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(KEY)); } catch (e) { stored = null; }
    if (stored && stored.users && stored.cm) mem = stored;
    if (!mem) mem = seed();
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
  function isAdminRole(u) { return u.role === "admin" || u.role === "superuser"; }
  function admin(db, token) { var u = sessionUser(db, token); if (!isAdminRole(u)) fail("Admin access required."); return u; }
  function superUser(db, token) { var u = sessionUser(db, token); if (u.role !== "superuser") fail("Only the super user can do this."); return u; }
  function canOpen(db, u, c) { return isAdminRole(u) || c.is_default || u.categories.indexOf(c.id) >= 0; }
  // same rule as app__can_edit in schema.sql
  function canEdit(db, u, toolId) {
    var t = db.tools.filter(function (x) { return x.id === toolId; })[0];
    if (!t || !t.editable) return false;
    if (isAdminRole(u)) return true;
    var c = db.categories.filter(function (x) { return x.id === t.category_id; })[0];
    return (u.edit_tools || []).indexOf(toolId) >= 0 && !!c && canOpen(db, u, c);
  }
  function editor(db, token, toolId) { var u = sessionUser(db, token); if (!canEdit(db, u, toolId)) fail("Edit access for this tool is required."); return u; }
  function profile(db, u) {
    return {
      user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, avatar: u.avatar || null,
              created_at: u.created_at, last_login_at: u.last_login_at,
              edit_tools: db.tools.filter(function (t) { return canEdit(db, u, t.id); }).map(function (t) { return t.id; }).sort() },
      // only the tiles this user may open are returned
      categories: db.categories.slice().sort(bySort).filter(function (c) { return canOpen(db, u, c); }).map(function (c) {
        return {
          id: c.id, name: c.name, description: c.description, allowed: true,
          tools: db.tools.filter(function (t) { return t.category_id === c.id && t.status !== "hidden"; }).sort(bySort)
                 .map(function (t) { var o = {}; for (var k in t) o[k] = t[k]; o.can_edit = canEdit(db, u, t.id); return o; })
        };
      })
    };
  }
  function cmNorm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function cmFactory(db, id) {
    var out = null;
    db.cm.products.forEach(function (p) { p.factories.forEach(function (f) { if (f.id === id) out = { id: f.id, name: f.name, product: p.name }; }); });
    if (!out) fail("Choose a product and factory first.");
    return out;
  }
  function dnProduct(db, id) {      // the row mapping is kept per product, one for all factories
    var p = db.cm.products.filter(function (x) { return x.id === id; })[0];
    if (!p) fail("Choose a product first.");
    return p;
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
      db.users.push({ id: "u" + Date.now(), username: name, full_name: d.fullName.trim(), team_note: (d.teamNote || "").trim(), password: d.password, role: "user", status: "pending", created_at: new Date().toISOString(), last_login_at: null, categories: [], edit_tools: [] });
      return { ok: true };
    }),
    login: demo(function (db, username, password) {
      var u = db.users.filter(function (x) { return x.username.toLowerCase() === (username || "").trim().toLowerCase(); })[0];
      if (!u || u.password !== password) fail("Wrong username or password.");
      if (u.status === "pending") fail("Your account is waiting for admin approval.");
      if (u.status !== "approved") fail("This account is not active. Please contact the admin.");
      var token = "demo-" + Math.random().toString(36).slice(2) + Date.now();
      Object.keys(db.sessions).forEach(function (k) { if (db.sessions[k] === u.id) delete db.sessions[k]; });   // one session per user
      db.sessions[token] = u.id; u.last_login_at = new Date().toISOString();
      var p = profile(db, u); p.ok = true; p.token = token; return p;
    }),
    me: demo(function (db, t) { return profile(db, sessionUser(db, t)); }),
    logout: demo(function (db, t) { delete db.sessions[t]; return { ok: true }; }),
    changePassword: demo(function (db, t, o, n) {
      var u = sessionUser(db, t); if (u.password !== o) fail("Current password is wrong."); checkPw(n); u.password = n; return { ok: true };
    }),
    updateProfile: demo(function (db, t, d) {
      var u = sessionUser(db, t), name = (d.fullName || "").trim();
      if (name.length < 2 || name.length > 60) fail("Please enter your name (2 to 60 characters).");
      if (d.avatar && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(d.avatar)) fail("That picture format is not supported.");
      if (d.avatar && d.avatar.length > 60000) fail("That picture is too large.");
      u.full_name = name; u.avatar = d.avatar || null;
      var p = profile(db, u); p.ok = true; return p;
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
      var a = admin(db, t);
      var u = db.users.filter(function (x) { return x.id === d.id; })[0]; if (!u) fail("User not found.");
      var role = d.role || u.role;
      if (a.role !== "superuser") {
        if (u.role !== "user") fail("Only the super user can change an admin account.");
        if (role !== u.role) fail("Only the super user can change roles.");
      }
      if (role === "superuser" && u.role !== "superuser") fail("The super user is set in the database, not from this page.");
      if (u.role === "superuser" && (role !== "superuser" || d.status !== "approved")) fail("The super user account cannot be demoted or disabled.");
      u.status = d.status; u.role = role; u.categories = d.categories || [];
      u.edit_tools = role === "user" ? (d.editTools || []).filter(function (id) { return db.tools.some(function (x) { return x.id === id && x.editable; }); }) : [];
      return { ok: true };
    }),
    adminResetPassword: demo(function (db, t, id, pw) {
      var a = admin(db, t); checkPw(pw);
      var u = db.users.filter(function (x) { return x.id === id; })[0]; if (!u) fail("User not found.");
      if (a.role !== "superuser" && u.role !== "user") fail("Only the super user can reset an admin password.");
      u.password = pw; return { ok: true };
    }),
    adminDeleteUser: demo(function (db, t, id) {
      var a = superUser(db, t); var u = db.users.filter(function (x) { return x.id === id; })[0];
      if (!u) fail("User not found."); if (u.id === a.id) fail("You cannot delete your own account.");
      if (u.status === "approved") fail("Disable the user first, then delete.");
      db.users = db.users.filter(function (x) { return x.id !== id; }); return { ok: true };
    }),
    adminSaveTool: demo(function (db, t, d) {
      superUser(db, t); d.editable = !!d.editable;
      if (!/^[a-z0-9-]{2,40}$/.test(d.id || "")) fail("Tool id must be lowercase letters, numbers and dashes.");
      if ((d.name || "").trim().length < 2) fail("Tool name is required.");
      if (d.path && !/^tools\/[a-z0-9-]+\/$/.test(d.path)) fail("Path must look like tools/my-tool/");
      db.tools = db.tools.filter(function (x) { return x.id !== d.id; }); db.tools.push(d); return { ok: true };
    }),
    // ---- Compliance Maker library (same rules as db/schema.sql) ----
    cmOptions: demo(function (db, t) { sessionUser(db, t); return { products: db.cm.products }; }),
    cmSaveRun: demo(function (db, t, d) {
      var u = sessionUser(db, t), f = cmFactory(db, d.factoryId), seen = {}, answers = [], matched = 0;
      if (!d.lines || !d.lines.length) fail("There are no lines to save.");
      d.lines.forEach(function (ln, i) {
        if (["letter", "number", "text"].indexOf(ln.type) < 0) return;
        var n = cmNorm(ln.spec); if (n.length < 8) return;
        var line = db.cm.lines.filter(function (x) { return x.factory_id === f.id && x.norm_text === n; })[0];
        if (!line) { line = { id: "l" + Date.now() + "_" + i, factory_id: f.id, norm_text: n, spec_text: ln.spec, compliance: "", remarks: "", status: "open", times_seen: 0, last_seen_at: "", answered_at: null, answered_by: null, answer_source: "" }; db.cm.lines.push(line); }
        if (!seen[n]) { seen[n] = 1; line.times_seen++; line.last_seen_at = new Date().toISOString(); }
        if (line.status === "answered") { matched++; answers.push({ i: i, compliance: line.compliance, remarks: line.remarks }); }
      });
      var run = { id: "r" + Date.now(), kind: "conversion", created_at: new Date().toISOString(), user: u.full_name, username: u.username, product: f.product, factory: f.name, source: d.source, file_name: d.fileName || "", line_count: d.lines.length, unique_count: Object.keys(seen).length, matched_count: matched };
      db.cm.runs.unshift(run);
      return { ok: true, run_id: run.id, lines: d.lines.length, unique_lines: run.unique_count, matched: matched, answers: answers };
    }),
    cmAdminLines: demo(function (db, t, d) {
      editor(db, t, "compliance-maker"); var f = cmFactory(db, d.factoryId), q = (d.search || "").trim().toLowerCase(), st = d.status || "open";
      var all = db.cm.lines.filter(function (x) { return x.factory_id === f.id; });
      var list = all.filter(function (x) { return (st === "all" || x.status === st) && x.spec_text.toLowerCase().indexOf(q) >= 0; })
        .sort(function (a, b) { return (b.status === "open") - (a.status === "open") || b.times_seen - a.times_seen; });
      var off = d.offset || 0;
      return { counts: { all: all.length, open: all.filter(function (x) { return x.status === "open"; }).length, answered: all.filter(function (x) { return x.status === "answered"; }).length },
               total: list.length, lines: list.slice(off, off + (d.limit || 50)) };
    }),
    cmAdminSaveAnswer: demo(function (db, t, id, c, r) {
      var a = editor(db, t, "compliance-maker"), l = db.cm.lines.filter(function (x) { return x.id === id; })[0]; if (!l) fail("That line no longer exists.");
      l.compliance = (c || "").trim(); l.remarks = (r || "").trim(); l.status = (l.compliance || l.remarks) ? "answered" : "open";
      l.answered_by = a.full_name; l.answered_at = new Date().toISOString(); l.answer_source = "admin";
      return { ok: true, status: l.status };
    }),
    cmAdminDeleteLine: demo(function (db, t, id) { editor(db, t, "compliance-maker"); db.cm.lines = db.cm.lines.filter(function (x) { return x.id !== id; }); return { ok: true }; }),
    cmAdminImport: demo(function (db, t, d) {
      var a = editor(db, t, "compliance-maker"), f = cmFactory(db, d.factoryId), uniq = {}, added = 0, updated = 0, n = 0;
      if (!d.rows || !d.rows.length) fail("No rows were found in that file.");
      d.rows.forEach(function (row) {
        var c = (row.compliance || "").trim(), r = (row.remarks || "").trim(), k = cmNorm(row.spec);
        if ((c || r) && k.length >= 8) uniq[k] = { spec: String(row.spec).trim(), c: c, r: r };
      });
      Object.keys(uniq).forEach(function (k) {
        n++; var v = uniq[k], l = db.cm.lines.filter(function (x) { return x.factory_id === f.id && x.norm_text === k; })[0];
        if (!l) { added++; l = { id: "l" + Date.now() + "_" + n, factory_id: f.id, norm_text: k, spec_text: v.spec, times_seen: 0, last_seen_at: "" }; db.cm.lines.push(l); }
        else if (l.compliance !== v.c || l.remarks !== v.r) updated++; else return;
        l.compliance = v.c; l.remarks = v.r; l.status = "answered"; l.answered_by = a.full_name; l.answered_at = new Date().toISOString(); l.answer_source = "upload";
      });
      db.cm.runs.unshift({ id: "r" + Date.now(), kind: "library-upload", created_at: new Date().toISOString(), user: a.full_name, username: a.username, product: f.product, factory: f.name, source: "xlsx", file_name: d.fileName || "", line_count: d.rows.length, unique_count: n, matched_count: added + updated });
      return { ok: true, rows: d.rows.length, unique_lines: n, added: added, updated: updated, unchanged: n - added - updated, skipped: d.rows.length - n };
    }),
    cmAdminRuns: demo(function (db, t) { editor(db, t, "compliance-maker"); return { total: db.cm.runs.length, runs: db.cm.runs.slice(0, 50) }; }),
    cmAdminExport: demo(function (db, t, factoryId) {
      editor(db, t, "compliance-maker"); var f = cmFactory(db, factoryId);
      return { lines: db.cm.lines.filter(function (x) { return x.factory_id === f.id; }) };
    }),
    // ---- Datasheet Notes row mapping (same rules as db/schema.sql) ----
    dnRules: demo(function (db, t, productId) {
      sessionUser(db, t); var f = dnProduct(db, productId), m = (db.dn || {})[f.id] || { show_unmapped: true, rules: [] };
      return { show_unmapped: m.show_unmapped, rules: m.rules };
    }),
    dnAddRows: demo(function (db, t, d) {
      sessionUser(db, t); var f = dnProduct(db, d.productId), added = 0;
      db.dn = db.dn || {}; var m = db.dn[f.id] || { show_unmapped: true, rules: [] };
      (d.rows || []).forEach(function (r) {
        var k = String(r.key || "").trim();
        if (!k || k.length > 300 || m.rules.some(function (x) { return x.key === k; })) return;
        added++; m.rules.push({ key: k, section: String(r.section || "").trim(), sub: String(r.sub || "").trim(), component: String(r.component || "").trim(),
                                show: m.show_unmapped, label: "", strip: "", response: "", "new": true });
      });
      db.dn[f.id] = m; return { ok: true, added: added };
    }),
    dnAdminSaveRules: demo(function (db, t, d) {
      editor(db, t, "datasheet-notes"); var f = dnProduct(db, d.productId), rules = d.rules || [], remove = d.remove || [], seen = {}, saved = 0;
      if (rules.length > 3000) fail("Too many rows to save in one go (more than 3000).");
      rules.forEach(function (r) {
        var k = String(r.key || "").trim();
        if (!k || k.length > 300) fail("A row has no name and cannot be saved.");
        if (String(r.label || "").length > 120 || String(r.response || "").length > 1000 || String(r.strip || "").length > 300) fail("A name is longer than 120 characters, a \"remove from value\" text is longer than 300, or a response is longer than 1000.");
      });
      db.dn = db.dn || {};
      var m = db.dn[f.id] || { show_unmapped: true, rules: [] }, before = m.rules.length;
      m.rules = m.rules.filter(function (r) { return remove.indexOf(r.key) < 0; });
      var removed = before - m.rules.length;
      rules.forEach(function (r) {
        var k = String(r.key).trim(); if (seen[k]) return; seen[k] = 1; saved++;
        var row = { key: k, section: String(r.section || "").trim(), sub: String(r.sub || "").trim(), component: String(r.component || "").trim(),
                    show: r.show !== false, label: String(r.label || "").trim(), strip: String(r.strip || "").trim(), response: String(r.response || "").trim(), "new": false };
        m.rules = m.rules.filter(function (x) { return x.key !== k; }); m.rules.push(row);
      });
      m.show_unmapped = d.showUnmapped !== false; db.dn[f.id] = m;
      return { ok: true, saved: saved, removed: removed };
    }),
    adminSaveCategory: demo(function (db, t, d) {
      superUser(db, t);
      if (!/^[a-z0-9-]{2,30}$/.test(d.id || "")) fail("Category id must be lowercase letters, numbers and dashes.");
      if ((d.name || "").trim().length < 2) fail("Category name is required.");
      db.categories = db.categories.filter(function (x) { return x.id !== d.id; }); db.categories.push(d); return { ok: true };
    })
  };

  window.Api = DEMO ? demoApi : supabaseApi;
  window.Api.isDemo = DEMO;
})();
