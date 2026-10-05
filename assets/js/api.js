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
    cmSaveRun: function (t, d) { return rpc("cm_save_run", { p_token: t, p_factory_id: d.factoryId, p_source: d.source, p_file_name: d.fileName || "", p_lines: d.lines, p_project_id: d.projectId || null }); },
    cmAdminLines: function (t, d) { return rpc("cm_admin_lines", { p_token: t, p_factory_id: d.factoryId, p_status: d.status || "open", p_search: d.search || "", p_limit: d.limit || 100, p_offset: d.offset || 0,
      p_part: d.part === "" || d.part == null ? null : +d.part, p_topic: d.topic || "", p_client_type: d.clientType || "", p_client_name: d.clientName || "" }); },
    cmAdminSaveAnswer: function (t, id, c, r, comments) { return rpc("cm_admin_save_answer", { p_token: t, p_line_id: id, p_compliance: c, p_remarks: r, p_comments: comments == null ? null : comments }); },
    cmAdminDeleteLine: function (t, id) { return rpc("cm_admin_delete_line", { p_token: t, p_line_id: id }); },
    cmAdminImport: function (t, d) { return rpc("cm_admin_import", { p_token: t, p_factory_id: d.factoryId, p_file_name: d.fileName || "", p_rows: d.rows }); },
    cmAdminRuns: function (t, d) { return rpc("cm_admin_runs", { p_token: t, p_limit: (d && d.limit) || 50, p_offset: (d && d.offset) || 0 }); },
    cmAdminExport: function (t, factoryId) { return rpc("cm_admin_export", { p_token: t, p_factory_id: factoryId }); },
    // Datasheet Notes row mapping
    dnRules: function (t, productId) { return rpc("dn_get_rules", { p_token: t, p_product_id: productId }); },
    dnAddRows: function (t, d) { return rpc("dn_add_rows", { p_token: t, p_product_id: d.productId, p_rows: d.rows || [] }); },
    dnAdminSaveRules: function (t, d) { return rpc("dn_admin_save_rules", { p_token: t, p_product_id: d.productId, p_show_unmapped: d.showUnmapped !== false, p_rules: d.rules || [], p_remove: d.remove || [] }); },
    // Product Options (tree of sections, options and notes per factory)
    poCollect: function (t, d) { return rpc("po_collect", { p_token: t, p_product_id: d.productId, p_items: d.items || [] }); },
    poTree: function (t, factoryId) { return rpc("po_get_tree", { p_token: t, p_factory_id: factoryId }); },
    poAdminSaveExtra: function (t, d) { return rpc("po_admin_save_extra", { p_token: t, p_factory_id: d.factoryId, p_id: d.id || null, p_section: d.section, p_row_key: d.key || "", p_kind: d.kind, p_body: d.body }); },
    poAdminDeleteExtra: function (t, id) { return rpc("po_admin_delete_extra", { p_token: t, p_id: id }); },
    poAdminSetHidden: function (t, d) { return rpc("po_admin_set_hidden", { p_token: t, p_factory_id: d.factoryId, p_row_key: d.key, p_value_key: d.valueKey || "", p_hidden: !!d.hidden, p_model: d.model || "" }); },
    // Projects (every piece of work is saved under one) and the review of users' compliance answers
    prOptions: function (t) { return rpc("pr_options", { p_token: t }); },
    prList: function (t) { return rpc("pr_list", { p_token: t }); },
    prSave: function (t, d) { return rpc("pr_save", { p_token: t, p_id: d.id || null, p_name: d.name, p_client_type: d.clientType, p_client_name: d.clientName, p_region: d.region }); },
    prGet: function (t, id) { return rpc("pr_get", { p_token: t, p_id: id }); },
    prExport: function (t, id) { return rpc("pr_export", { p_token: t, p_id: id }); },
    prNoteSave: function (t, d) { return rpc("pr_note_save", { p_token: t, p_project_id: d.projectId, p_product_id: d.productId, p_file_names: d.fileNames || "", p_columns: d.columns, p_rows: d.rows }); },
    prNoteGet: function (t, id) { return rpc("pr_note_get", { p_token: t, p_note_id: id }); },
    prRunGet: function (t, id) { return rpc("pr_run_get", { p_token: t, p_run_id: id }); },
    prRunSaveLine: function (t, d) { return rpc("pr_run_save_line", { p_token: t, p_run_id: d.run, p_seq: d.seq, p_compliance: d.compliance || "", p_remarks: d.remarks || "" }); },
    prDeleteRecord: function (t, kind, id) { return rpc("pr_delete_record", { p_token: t, p_kind: kind, p_id: id }); },
    prSubmitAnswers: function (t, runId, rows) { return rpc("pr_submit_answers", { p_token: t, p_run_id: runId, p_rows: rows }); },
    prReviewList: function (t, d) { return rpc("pr_review_list", { p_token: t, p_status: (d && d.status) || "pending", p_limit: (d && d.limit) || 100, p_offset: (d && d.offset) || 0 }); },
    prReviewDecide: function (t, d) { return rpc("pr_review_decide", { p_token: t, p_run_id: d.run, p_seq: d.seq, p_decision: d.decision, p_compliance: d.compliance == null ? null : d.compliance, p_remarks: d.remarks == null ? null : d.remarks }); },
    prAdminSummary: function (t) { return rpc("pr_admin_summary", { p_token: t }); },
    adminSaveCategory: function (t, d) { return rpc("app_admin_save_category", { p_token: t, p_id: d.id, p_name: d.name, p_description: d.description, p_sort: d.sort, p_is_default: d.is_default }); }
  };

  // ---------- Demo back end (preview only, NOT secure) ----------
  var KEY = "dame_hub_demo_db_v9", mem = null;
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
        { id: "projects", category_id: "general", name: "Projects", description: "Open a project to convert specifications and read datasheets. Everything is saved under it.", path: "tools/projects/", status: "live", sort: 5 },
        { id: "compliance-maker", project_tool: true, category_id: "general", name: "Compliance Maker", description: "Turn a specification PDF into a ready-to-fill compliance matrix in Excel.", path: "tools/compliance-maker/", status: "live", sort: 10, editable: true },
        { id: "datasheet-notes", project_tool: true, category_id: "general", name: "Datasheet Notes", description: "Turn a product datasheet PDF into an Excel table of unit data, sections and options.", path: "tools/datasheet-notes/", status: "live", sort: 15, editable: true },
        { id: "product-options", project_tool: true, category_id: "general", name: "Product Options", description: "See the sections, options and notes each factory offers, built from the datasheets run so far.", path: "tools/product-options/", status: "live", sort: 17, editable: true },
        { id: "coil-data-extractor", category_id: "general", name: "Coil Data Extractor", description: "Turn coil selection quotations in Word or PDF into one Excel table, one row per coil.", path: "tools/coil-data-extractor/", status: "live", sort: 20 },
        { id: "container-calculator", category_id: "general", name: "Container Calculator", description: "Work out how many containers or trailers a shipment needs, with a load plan and PDF report.", path: "tools/container-calculator/", status: "live", sort: 30 },
        { id: "centre-of-gravity", category_id: "general", name: "Centre of Gravity", description: "Build a unit from blocks, find its centre of gravity and the load on every mounting foot.", path: "tools/centre-of-gravity/", status: "live", sort: 40 },
        { id: "psychrometric-chart", category_id: "general", name: "Psychrometric Chart", description: "Plot air states on an ASHRAE-style chart and read coil loads, SHR and mixing.", path: "tools/psychrometric-chart/", status: "live", sort: 50 },
        { id: "standards", category_id: "general", name: "Standards", description: "Short summaries of the standards named in AHU, FCU and chiller specifications.", path: "tools/standards/", status: "live", sort: 60 }
      ],
      sessions: {},
      cm: {
        products: [
          { id: "ahu", name: "AHU", factories: [{ id: "ahu-dubai", name: "Dubai" }, { id: "ahu-riyadh", name: "Riyadh" }] },
          { id: "fcu", name: "FCU", factories: [{ id: "fcu-shenzhen", name: "Shenzhen" }, { id: "fcu-riyadh", name: "Riyadh" }] },
          { id: "chiller", name: "Chiller", factories: [{ id: "chiller-italy", name: "Italy" }, { id: "chiller-jeddah", name: "Jeddah" }] }
        ],
        lines: [], runs: []
      },
      pr: {
        client_types: ["Consultant", "Contractor", "Developer / Owner", "Distributor / Dealer", "Government", "Other"],
        regions: ["UAE", "Saudi Arabia", "Qatar", "Kuwait", "Bahrain", "Oman", "Egypt", "Other Middle East", "Africa", "Other"],
        projects: [], notes: [], log: []
      }
    };
  }
  function load() {
    // Re-read every time so two tabs (for example a user and an admin) see each other's changes.
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(KEY)); } catch (e) { stored = null; }
    if (stored && stored.users && stored.cm && stored.pr) mem = stored;
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
  // mirrors cm__part_no and cm__topic in db/schema.sql
  function cmPartNo(t) {
    var m = /^\s*PART\s+([0-9]{1,2}|I{1,3})\b/i.exec(t || "");
    return !m ? 0 : ({ I: 1, II: 2, III: 3 })[m[1].toUpperCase()] || Math.min(parseInt(m[1], 10) || 0, 9);
  }
  var CM_TOPICS = [
    ["Installation and testing", "field quality|install|examin|prepar|adjust|clean|demonstrat|commission|start.?up|testing|connection|training"],
    ["Submittals", "submittal|shop drawing|closeout"],
    ["Standards and quality", "quality|warrant|regulat|certif|standard|reference|performance|health|safety|code"],
    ["Filters", "filter"], ["Humidifier", "humidif|dehumidif"],
    ["Heat recovery", "heat recovery|recovery wheel|heat wheel|heat pipe|recuperator|run.?around"],
    ["Coils", "coil|heat exchanger|eliminator|drain pan"],
    ["Dampers and mixing", "damper|mixing|plenum|louv|economi"],
    ["Sound and vibration", "sound|noise|acoustic|attenuat|silencer|vibration"],
    ["Fans and drives", "fan|blower|motor|drive|bearing|belt"],
    ["Controls and electrical", "control|electric|wiring|starter|variable frequency|vfd|instrument|sensor"],
    ["Casing and base", "casing|cabinet|enclosure|panel|housing|construction|gasket|door|insulat|base|frame|support|roof"],
    ["Delivery and spares", "deliver|storage|extra material|spare|maintenance"],
    ["General", "general|summary|description|scope|includes|related|definition|coordination|manufacturer|material"]
  ].map(function (t) { return [t[0], new RegExp("\\b(" + t[1] + ")")]; });
  function cmTopic(section) {
    var s = String(section || "").toLowerCase();
    if (!s) return "";
    for (var i = 0; i < CM_TOPICS.length; i++) if (CM_TOPICS[i][1].test(s)) return CM_TOPICS[i][0];
    return "Other";
  }
  // mirrors cm__library_order: Part, then section title (groups by their lowest section number),
  // then one block per conversion the lines were first seen in, then the order in that specification
  function cmLibraryOrder(lines) {
    function num(sr) { var m = /^(\d{1,2})\.(\d{1,2})$/.exec(sr || ""); return m ? +m[1] * 1000 + +m[2] : 99999; }
    var gsort = {};
    lines.forEach(function (x) { var k = (x.part || 0) + "|" + String(x.section || "").toLowerCase(); gsort[k] = Math.min(gsort[k] == null ? 99999 : gsort[k], num(x.section_sr)); });
    return lines.slice().sort(function (a, b) {
      var pa = a.part || 0, pb = b.part || 0, sa = String(a.section || "").toLowerCase(), sb = String(b.section || "").toLowerCase();
      return (pa === 0) - (pb === 0) || pa - pb || gsort[pa + "|" + sa] - gsort[pb + "|" + sb] || sa.localeCompare(sb) ||
             String(a.home_run || "~").localeCompare(String(b.home_run || "~")) || (a.home_seq == null ? 1e9 : a.home_seq) - (b.home_seq == null ? 1e9 : b.home_seq);
    });
  }
  function cmNorm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function cmFactory(db, id) {
    var out = null;
    db.cm.products.forEach(function (p) { p.factories.forEach(function (f) { if (f.id === id) out = { id: f.id, name: f.name, product: p.name, product_id: p.id }; }); });
    if (!out) fail("Choose a product and factory first.");
    return out;
  }
  function dnProduct(db, id) {      // the row mapping is kept per product, one for all factories
    var p = db.cm.products.filter(function (x) { return x.id === id; })[0];
    if (!p) fail("Choose a product first.");
    return p;
  }
  // mirror po__skip and po__value in db/schema.sql
  var PO_SKIP = ["project", "reference", "material name", "selection software", "report date", "product", "factory", "unit"];
  function poSkip(key) { return /^general\|\|/.test(key) && PO_SKIP.indexOf(key.slice(9)) >= 0; }
  // the series of a unit model = the model without its size figure (FWW600VA -> FWWVA); mirrors po__series
  function poModel(model) { return String(model || "").replace(/\s+/g, " ").trim().slice(0, 60).replace(/N$/i, ""); }   // mirrors po__model
  function poSeries(model) { return poModel(model).replace(/\d+/g, ""); }
  function poValue(key, value) {
    var v = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    if (/\|options\|option$/.test(key)) v = v.replace(/^\d+\s*x\s+/i, "");
    return v.trim().slice(0, 300);
  }
  // ---- project helpers (mirror pr__project, pr__log, pr__name in schema.sql) ----
  function prProject(db, u, id) {
    var p = db.pr.projects.filter(function (x) { return x.id === id; })[0];
    if (!p || !(isAdminRole(u) || p.created_by === u.id)) fail("That project is not available. Choose a project first.");
    return p;
  }
  function prLog(db, projectId, u, action, detail) { db.pr.log.push({ project_id: projectId, user_id: u.id, action: action, detail: String(detail || "").slice(0, 400), at: new Date().toISOString() }); }
  function prName(db, id) { var x = db.users.filter(function (y) { return y.id === id; })[0]; return x ? x.full_name : "(deleted user)"; }
  function prProductName(db, id) { var x = db.cm.products.filter(function (y) { return y.id === id; })[0]; return x ? x.name : id; }
  function prRuns(db, p) { return db.cm.runs.filter(function (r) { return r.project_id === p.id; }); }
  function prCard(db, u, p) {
    var runs = prRuns(db, p), notes = db.pr.notes.filter(function (n) { return n.project_id === p.id; }), pending = 0, last = p.updated_at;
    runs.forEach(function (r) { (r.rows || []).forEach(function (x) { if (x.review === "pending") pending++; }); if (r.created_at > last) last = r.created_at; });
    notes.forEach(function (n) { if (n.created_at > last) last = n.created_at; });
    return { id: p.id, name: p.name, client_type: p.client_type, client_name: p.client_name, region: p.region, created_at: p.created_at,
             created_by: prName(db, p.created_by), mine: p.created_by === u.id, compliance: runs.length, notes: notes.length, pending: pending, last_at: last };
  }
  function prDetail(db, u, p) {
    function n(rows, test) { return (rows || []).filter(test).length; }
    return {
      project: { id: p.id, name: p.name, client_type: p.client_type, client_name: p.client_name, region: p.region, created_at: p.created_at,
                 created_by: prName(db, p.created_by), updated_at: p.updated_at, updated_by: prName(db, p.updated_by) },
      runs: prRuns(db, p).map(function (r) {
        return { id: r.id, created_at: r.created_at, user: r.user, product_id: r.product_id, product: r.product, factory: r.factory, source: r.source, file_name: r.file_name,
                 lines: r.line_count, from_library: r.matched_count,
                 answered: n(r.rows, function (x) { return x.compliance || x.remarks; }), pending: n(r.rows, function (x) { return x.review === "pending"; }),
                 approved: n(r.rows, function (x) { return x.review === "approved"; }), rejected: n(r.rows, function (x) { return x.review === "rejected"; }) };
      }),
      notes: db.pr.notes.filter(function (x) { return x.project_id === p.id; }).map(function (x) {
        return { id: x.id, created_at: x.created_at, user: prName(db, x.user_id), product_id: x.product_id, product: prProductName(db, x.product_id), file_names: x.file_names, units: x.units, rows: x.row_count };
      }).reverse(),
      log: db.pr.log.filter(function (g) { return g.project_id === p.id; }).map(function (g) { return { at: g.at, user: prName(db, g.user_id), action: g.action, detail: g.detail }; }).reverse().slice(0, 200)
    };
  }
  function checkPw(p) {
    if (!p || p.length < 8) fail("Password must be at least 8 characters.");
    if (!/\S/.test(p)) fail("Password cannot be only spaces.");
  }
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
      var u = sessionUser(db, t), f = cmFactory(db, d.factoryId), seen = {}, answers = [], matched = 0, kept = [];
      if (!d.lines || !d.lines.length) fail("There are no lines to save.");
      if (d.projectId) prProject(db, u, d.projectId);
      var part = 0, section = "", sectionSr = "", runId = "r" + Date.now();
      d.lines.forEach(function (ln, i) {
        kept.push({ seq: i, type: ln.type || "", sr: ln.sr || "", spec: ln.spec || "", line_id: null, compliance: "", remarks: "", review: "" });
        if (ln.type === "part") { var pn = cmPartNo(ln.spec); if (pn) { part = pn; section = ""; sectionSr = ""; } return; }
        if (ln.type === "section") { if (!/\.{5,}/.test(ln.spec) && !/^0\./.test(ln.sr || "")) { section = String(ln.spec || "").trim().slice(0, 120); sectionSr = String(ln.sr || "").trim(); } return; }
        if (["letter", "number", "text"].indexOf(ln.type) < 0) return;
        var n = cmNorm(ln.spec); if (n.length < 8 || /\.{5,}/.test(ln.spec)) return;
        var line = db.cm.lines.filter(function (x) { return x.factory_id === f.id && x.norm_text === n; })[0];
        if (!line) { line = { id: "l" + Date.now() + "_" + i, factory_id: f.id, norm_text: n, spec_text: ln.spec, compliance: "", remarks: "", status: "open", times_seen: 0, last_seen_at: "", answered_at: null, answered_by: null, answer_source: "" }; db.cm.lines.push(line); }
        if (!seen[n]) { seen[n] = 1; line.times_seen++; line.last_seen_at = new Date().toISOString(); }
        kept[kept.length - 1].line_id = line.id;
        if (!line.part && part) line.part = part;
        if (!line.section && section) line.section = section;
        if (!line.home_run) { line.home_run = runId; line.home_seq = i; line.sr = String(ln.sr || "").replace(/[.)]\s*$/, ""); line.row_type = ln.type; line.section_sr = sectionSr; line.file_name = d.fileName || ""; }
        if (line.status === "answered") { matched++; answers.push({ i: i, compliance: line.compliance, remarks: line.remarks }); }
      });
      var run = { id: runId, kind: "conversion", created_at: new Date().toISOString(), user: u.full_name, username: u.username, product: f.product, factory: f.name, source: d.source, file_name: d.fileName || "", line_count: d.lines.length, unique_count: Object.keys(seen).length, matched_count: matched };
      run.user_id = u.id; run.product_id = f.product_id; run.project_id = d.projectId || null; run.rows = d.projectId ? kept : [];
      db.cm.runs.unshift(run);
      if (d.projectId) prLog(db, d.projectId, u, "Specification converted", d.fileName || "");
      return { ok: true, run_id: run.id, lines: d.lines.length, unique_lines: run.unique_count, matched: matched, answers: answers };
    }),
    cmAdminLines: demo(function (db, t, d) {
      editor(db, t, "compliance-maker"); var f = cmFactory(db, d.factoryId), q = (d.search || "").trim().toLowerCase(), st = d.status || "open";
      var all = db.cm.lines.filter(function (x) { return x.factory_id === f.id; });
      all.forEach(function (x) { x.part = x.part || 0; x.section = x.section || ""; x.topic = cmTopic(x.section); });
      var wantPart = d.part === "" || d.part == null ? null : +d.part, groups = {};
      all.forEach(function (x) {
        var k = x.part + "|" + x.topic, g = groups[k] || (groups[k] = { part: x.part, topic: x.topic, all: 0, open: 0 });
        g.all++; if (x.status === "open") g.open++;
      });
      // answers users filled in their projects, per library line (mirrors project_answers in cm_admin_lines)
      var pa = {}, types = {}, names = {};
      db.cm.runs.forEach(function (r) {
        var pj = db.pr.projects.filter(function (p) { return p.id === r.project_id; })[0];
        if (!pj || r.factory !== f.name || r.product !== f.product) return;
        types[pj.client_type] = 1; if (!d.clientType || pj.client_type === d.clientType) names[pj.client_name] = 1;
        (r.rows || []).forEach(function (x) {
          if (!x.line_id) return;
          var e = pa[x.line_id] || (pa[x.line_id] = { list: [], clients: [] });
          e.clients.push(pj);
          if (x.compliance || x.remarks) e.list.push({ run: r.id, seq: x.seq, compliance: x.compliance, remarks: x.remarks, review: x.review, by: prName(db, x.answered_by), at: x.answered_at,
            project: pj.name, client: pj.client_name, client_type: pj.client_type, region: pj.region });
        });
      });
      all.forEach(function (x) {
        x.project_answers = ((pa[x.id] || {}).list || []).sort(function (a, b) { return (a.review !== "pending") - (b.review !== "pending") || String(b.at).localeCompare(String(a.at)); }).slice(0, 6);
      });
      function waiting(x) { return x.project_answers.some(function (y) { return y.review === "pending"; }); }
      var list = all.filter(function (x) {
        return (st === "all" || x.status === st || (st === "review" && waiting(x))) && x.spec_text.toLowerCase().indexOf(q) >= 0 &&
               (wantPart === null || x.part === wantPart) && (!d.topic || x.topic === d.topic) &&
               ((!d.clientType && !d.clientName) || ((pa[x.id] || {}).clients || []).some(function (pj) { return (!d.clientType || pj.client_type === d.clientType) && (!d.clientName || pj.client_name === d.clientName); }));
      });
      var orderOf = {}; cmLibraryOrder(all).forEach(function (x, k) { orderOf[x.id] = k; });
      list.sort(function (a, b) { return orderOf[a.id] - orderOf[b.id]; });
      var off = d.offset || 0;
      return { groups: Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return (a.part === 0) - (b.part === 0) || a.part - b.part || a.topic.localeCompare(b.topic); }),
               counts: { all: all.length, open: all.filter(function (x) { return x.status === "open"; }).length, answered: all.filter(function (x) { return x.status === "answered"; }).length, review: all.filter(waiting).length },
               client_types: Object.keys(types).sort(), client_names: Object.keys(names).sort(),
               total: list.length, lines: list.slice(off, off + (d.limit || 50)) };
    }),
    cmAdminSaveAnswer: demo(function (db, t, id, c, r, comments) {
      var a = editor(db, t, "compliance-maker"), l = db.cm.lines.filter(function (x) { return x.id === id; })[0]; if (!l) fail("That line no longer exists.");
      if (comments != null) l.comments = String(comments).trim().slice(0, 4000);
      if ((l.compliance || "") === (c || "").trim() && (l.remarks || "") === (r || "").trim()) return { ok: true, status: l.status };   // only the comments changed
      l.compliance = (c || "").trim(); l.remarks = (r || "").trim(); l.status = (l.compliance || l.remarks) ? "answered" : "open";
      l.answered_by = a.full_name; l.answered_at = new Date().toISOString(); l.answer_source = "admin";
      return { ok: true, status: l.status };
    }),
    cmAdminDeleteLine: demo(function (db, t, id) { editor(db, t, "compliance-maker"); db.cm.lines = db.cm.lines.filter(function (x) { return x.id !== id; }); return { ok: true }; }),
    cmAdminImport: demo(function (db, t, d) {
      var a = editor(db, t, "compliance-maker"), f = cmFactory(db, d.factoryId), uniq = {}, added = 0, updated = 0, kept = 0, n = 0, n0 = 0, runId = "r" + Date.now();
      if (!d.rows || !d.rows.length) fail("No rows were found in that file.");
      d.rows.forEach(function (row) {
        var c = (row.compliance || "").trim(), r = (row.remarks || "").trim(), cm = (row.comments || "").trim(), k = cmNorm(row.spec);
        if ((c || r || cm) && k.length >= 8) uniq[k] = { spec: String(row.spec).trim(), c: c, r: r, cm: cm, row: row, ord: n0++ };
      });
      Object.keys(uniq).forEach(function (k) {
        var v = uniq[k], has = !!(v.c || v.r), l = db.cm.lines.filter(function (x) { return x.factory_id === f.id && x.norm_text === k; })[0];
        if (has) n++;
        if (l && v.cm) l.comments = v.cm;                                   // the file's internal comments replace the old ones
        if (!l) {
          l = { id: "l" + Date.now() + "_" + v.ord, factory_id: f.id, norm_text: k, spec_text: v.spec, times_seen: 0, last_seen_at: "", compliance: "", remarks: "", status: "open", comments: v.cm,
                part: +v.row.part || 0, section: v.row.section || "", sr: v.row.sr || "", row_type: v.row.type || "text", section_sr: v.row.section_sr || "", home_run: runId, home_seq: v.ord, file_name: d.fileName || "" };
          db.cm.lines.push(l); if (!has) return; added++;
        }
        else if (!has) return;
        else if (l.status === "answered") { if (l.compliance === v.c && l.remarks === v.r) return; kept++; }   // an uploaded file replaces an existing answer
        else updated++;
        l.compliance = v.c; l.remarks = v.r; l.status = "answered"; l.answered_by = a.full_name; l.answered_at = new Date().toISOString(); l.answer_source = "upload";
      });
      db.cm.runs.unshift({ id: runId, kind: "library-upload", created_at: new Date().toISOString(), user: a.full_name, username: a.username, product: f.product, factory: f.name, source: "xlsx", file_name: d.fileName || "", line_count: d.rows.length, unique_count: n, matched_count: added + updated });
      return { ok: true, rows: d.rows.length, unique_lines: n, added: added, updated: updated, replaced: kept, unchanged: n - added - updated - kept, skipped: d.rows.length - n };
    }),
    cmAdminRuns: demo(function (db, t) { editor(db, t, "compliance-maker"); return { total: db.cm.runs.length, runs: db.cm.runs.slice(0, 50) }; }),
    cmAdminExport: demo(function (db, t, factoryId) {
      editor(db, t, "compliance-maker"); var f = cmFactory(db, factoryId);
      return { lines: cmLibraryOrder(db.cm.lines.filter(function (x) { return x.factory_id === f.id; })).map(function (x) {
        return { spec_text: x.spec_text, compliance: x.compliance, remarks: x.remarks, comments: x.comments || "", times_seen: x.times_seen,
                 part: x.part || 0, section: x.section || "", topic: cmTopic(x.section),
                 sr: x.sr || "", row_type: x.row_type || "", section_sr: x.section_sr || "", home_run: x.home_run || null, file_name: x.file_name || "" };
      }) };
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
                                show: m.show_unmapped, label: "", strip: "", response: "", keywords: "", "new": true });
      });
      db.dn[f.id] = m; return { ok: true, added: added };
    }),
    dnAdminSaveRules: demo(function (db, t, d) {
      editor(db, t, "datasheet-notes"); var f = dnProduct(db, d.productId), rules = d.rules || [], remove = d.remove || [], seen = {}, saved = 0;
      if (rules.length > 3000) fail("Too many rows to save in one go (more than 3000).");
      rules.forEach(function (r) {
        var k = String(r.key || "").trim();
        if (!k || k.length > 300) fail("A row has no name and cannot be saved.");
        if (String(r.label || "").length > 120 || String(r.response || "").length > 1000 || String(r.strip || "").length > 300 || String(r.keywords || "").length > 600) fail("A name is longer than 120 characters, a \"remove from value\" text is longer than 300, or a response is longer than 1000.");
      });
      db.dn = db.dn || {};
      var m = db.dn[f.id] || { show_unmapped: true, rules: [] }, before = m.rules.length;
      m.rules = m.rules.filter(function (r) { return remove.indexOf(r.key) < 0; });
      var removed = before - m.rules.length;
      rules.forEach(function (r) {
        var k = String(r.key).trim(); if (seen[k]) return; seen[k] = 1; saved++;
        var row = { key: k, section: String(r.section || "").trim(), sub: String(r.sub || "").trim(), component: String(r.component || "").trim(),
                    show: r.show !== false, label: String(r.label || "").trim(), strip: String(r.strip || "").trim(), response: String(r.response || "").trim(), keywords: String(r.keywords || "").trim(), "new": false };
        var was = m.rules.filter(function (x) { return x.key === k; })[0];
        if (was && was.in_tree === false) row.in_tree = false;       // "left out of the tree" is kept (Product Options)
        m.rules = m.rules.filter(function (x) { return x.key !== k; }); m.rules.push(row);
      });
      m.show_unmapped = d.showUnmapped !== false; db.dn[f.id] = m;
      return { ok: true, saved: saved, removed: removed };
    }),
    // ---- Product Options (same rules as po_* in db/schema.sql) ----
    poCollect: demo(function (db, t, d) {
      sessionUser(db, t); var p = dnProduct(db, d.productId), saved = 0;
      var rules = ((db.dn || {})[p.id] || { rules: [] }).rules;
      db.po = db.po || { values: {}, extras: [] };
      (d.items || []).forEach(function (it) {
        var f = p.factories.filter(function (x) { return x.name.toLowerCase() === String(it.factory || "").trim().toLowerCase(); })[0];
        var key = String(it.key || "").trim(), m = rules.filter(function (r) { return r.key === key; })[0];
        if (!f || !m || m.show === false || m.in_tree === false || poSkip(key)) return;
        var v = poValue(key, it.value), model = poModel(it.model), k = model + "\u0001" + v.toLowerCase();
        if (!v || v === "-") return;
        var row = (db.po.values[f.id] = db.po.values[f.id] || {})[key] = (db.po.values[f.id][key] || {});
        if (row[k]) row[k].n++; else if (Object.keys(row).filter(function (x) { return x.split("\u0001")[0] === model; }).length < 300) row[k] = { v: v, n: 1, hidden: false, model: model }; else return;
        saved++;
      });
      db.po.updated = new Date().toISOString();
      return { ok: true, saved: saved };
    }),
    poTree: demo(function (db, t, factoryId) {
      var u = sessionUser(db, t), f = cmFactory(db, factoryId), edit = canEdit(db, u, "product-options");
      var p = db.cm.products.filter(function (x) { return x.factories.some(function (y) { return y.id === f.id; }); })[0];
      var rules = ((db.dn || {})[p.id] || { rules: [] }).rules, po = db.po || { values: {}, extras: [] };
      var vals = po.values[f.id] || {}, extras = po.extras.filter(function (x) { return x.factory_id === f.id; }), sections = [];
      var rows = [];
      rules.forEach(function (m) {
        if (m.show === false || poSkip(m.key)) return;
        if (m.section && m.section.toLowerCase() !== "general" && sections.indexOf(m.section) < 0) sections.push(m.section);
        if (!edit && m.in_tree === false) return;
        var list = Object.keys(vals[m.key] || {}).map(function (k) { var x = vals[m.key][k]; return { k: k.split("\u0001")[1], v: x.v, n: x.n, hidden: !!x.hidden, model: x.model || "" }; })
          .filter(function (x) { return edit || !x.hidden; })
          .sort(function (a, b) { return a.model.localeCompare(b.model) || b.n - a.n || a.k.localeCompare(b.k); });
        if (!list.length && !extras.some(function (x) { return x.key === m.key; })) return;
        rows.push({ key: m.key, section: m.section, sub: m.sub, component: m.label || m.component, hidden: m.in_tree === false, values: list });
      });
      var models = {};
      Object.keys(vals).forEach(function (key) { var per = {}; Object.keys(vals[key]).forEach(function (k) { var x = vals[key][k]; if (x.model) per[x.model] = (per[x.model] || 0) + x.n; });
        Object.keys(per).forEach(function (mo) { models[mo] = Math.max(models[mo] || 0, per[mo]); }); });
      var modelList = Object.keys(models).map(function (mo) { return { model: mo, series: poSeries(mo), units: models[mo] }; })
        .sort(function (a, b) { return a.series.localeCompare(b.series) || b.units - a.units || a.model.localeCompare(b.model); });
      return { factory: { id: f.id, name: f.name, product_id: p.id, product: p.name }, can_edit: edit, updated: po.updated || null,
               rows: rows, models: modelList, extras: extras.map(function (x) { return { id: x.id, section: x.section, key: x.key, kind: x.kind, body: x.body, at: x.at, by: x.by }; }),
               sections: edit ? sections : [] };
    }),
    poAdminSaveExtra: demo(function (db, t, d) {
      var u = editor(db, t, "product-options"), f = cmFactory(db, d.factoryId);
      var section = String(d.section || "").replace(/\s+/g, " ").trim(), body = String(d.body || "").trim();
      if (d.kind !== "option" && d.kind !== "note") fail("Choose special option or note.");
      if (!section || section.length > 120) fail("Give the section a name of up to 120 characters.");
      if (!body) fail("Type the text first.");
      if (body.length > 1000) fail("The text is longer than 1000 characters.");
      db.po = db.po || { values: {}, extras: [] };
      var x;
      if (d.id) {
        x = db.po.extras.filter(function (e) { return e.id === d.id && e.factory_id === f.id; })[0];
        if (!x) fail("That entry no longer exists. Refresh the page.");
        x.kind = d.kind; x.body = body;
      } else {
        x = { id: "x" + Date.now() + Math.random().toString(36).slice(2, 7), factory_id: f.id, section: section, key: String(d.key || "").trim(), kind: d.kind, body: body };
        db.po.extras.push(x);
      }
      x.by = u.full_name; x.at = new Date().toISOString();
      return { ok: true, id: x.id };
    }),
    poAdminDeleteExtra: demo(function (db, t, id) {
      editor(db, t, "product-options");
      if (db.po) db.po.extras = db.po.extras.filter(function (e) { return e.id !== id; });
      return { ok: true };
    }),
    poAdminSetHidden: demo(function (db, t, d) {
      editor(db, t, "product-options"); var f = cmFactory(db, d.factoryId), found = false;
      var p = db.cm.products.filter(function (x) { return x.factories.some(function (y) { return y.id === f.id; }); })[0];
      if (!d.valueKey) {
        (((db.dn || {})[p.id] || { rules: [] }).rules).forEach(function (r) { if (r.key === d.key) { r.in_tree = !d.hidden; found = true; } });
      } else {
        var v = (((db.po || { values: {} }).values[f.id] || {})[d.key] || {})[String(d.model || "") + "\u0001" + d.valueKey];
        if (v) { v.hidden = !!d.hidden; found = true; }
      }
      if (!found) fail("That row no longer exists. Refresh the page.");
      return { ok: true };
    }),
    // ---- Projects (same rules as the PROJECTS part of db/schema.sql) ----
    prOptions: demo(function (db, t) { sessionUser(db, t); return { client_types: db.pr.client_types, regions: db.pr.regions }; }),
    prList: demo(function (db, t) {
      var u = sessionUser(db, t), all = isAdminRole(u);
      return { all: all, projects: db.pr.projects.filter(function (p) { return all || p.created_by === u.id; }).map(function (p) { return prCard(db, u, p); })
        .sort(function (a, b) { return String(b.last_at).localeCompare(String(a.last_at)); }) };
    }),
    prSave: demo(function (db, t, d) {
      var u = sessionUser(db, t), name = String(d.name || "").replace(/\s+/g, " ").trim().slice(0, 120), client = String(d.clientName || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (name.length < 2) fail("Project name is required.");
      if (db.pr.client_types.indexOf(d.clientType) < 0) fail("Choose the client type.");
      if (client.length < 2) fail("Client name is required.");
      if (db.pr.regions.indexOf(d.region) < 0) fail("Choose the region.");
      var now = new Date().toISOString(), p;
      if (!d.id) {
        if (db.pr.projects.some(function (x) { return x.created_by === u.id && x.name.toLowerCase() === name.toLowerCase(); })) fail("You already have a project with this name. Open it from the list, or use another name.");
        p = { id: "p" + Date.now(), name: name, client_type: d.clientType, client_name: client, region: d.region, created_by: u.id, created_at: now, updated_by: u.id, updated_at: now };
        db.pr.projects.push(p); prLog(db, p.id, u, "Project created", name);
      } else {
        p = prProject(db, u, d.id);
        p.name = name; p.client_type = d.clientType; p.client_name = client; p.region = d.region; p.updated_by = u.id; p.updated_at = now;
        prLog(db, p.id, u, "Project details changed", "");
      }
      return { ok: true, id: p.id };
    }),
    prGet: demo(function (db, t, id) { var u = sessionUser(db, t); return prDetail(db, u, prProject(db, u, id)); }),
    prExport: demo(function (db, t, id) {
      var u = sessionUser(db, t), p = prProject(db, u, id), out = prDetail(db, u, p);
      out.compliance = []; out.tables = [];
      db.cm.runs.filter(function (r) { return r.project_id === p.id; }).reverse().forEach(function (r) {
        (r.rows || []).forEach(function (x) {
          var l = db.cm.lines.filter(function (y) { return y.id === x.line_id; })[0], own = !!(x.compliance || x.remarks);
          out.compliance.push({ run: r.id, seq: x.seq, type: x.type, sr: x.sr, spec: x.spec,
            compliance: own ? x.compliance : (l ? l.compliance : ""), remarks: own ? x.remarks : (l ? l.remarks : ""),
            source: own ? ({ pending: "Project answer, waiting for review", approved: "Project answer, approved for the library", rejected: "Project answer, not taken into the library" }[x.review] || "Same as the library")
                        : (l && l.status === "answered" ? "From the library" : ""), by: own ? prName(db, x.answered_by) : "" });
        });
      });
      db.pr.notes.filter(function (n) { return n.project_id === p.id; }).forEach(function (n) {
        out.tables.push({ id: n.id, product: prProductName(db, n.product_id), file_names: n.file_names, created_at: n.created_at, columns: n.columns, rows: n.rows });
      });
      prLog(db, p.id, u, "Project downloaded", "");
      return out;
    }),
    prNoteSave: demo(function (db, t, d) {
      var u = sessionUser(db, t), p = prProject(db, u, d.projectId);
      if (!d.columns || !d.rows || !d.rows.length) fail("There is no table to save.");
      var n = { id: "n" + Date.now(), project_id: p.id, user_id: u.id, product_id: d.productId, file_names: String(d.fileNames || "").slice(0, 400), units: d.columns.length,
                row_count: d.rows.filter(function (r) { return (r.kind || "row") === "row"; }).length, columns: d.columns, rows: d.rows, created_at: new Date().toISOString() };
      db.pr.notes.push(n);
      prLog(db, p.id, u, "Datasheet notes saved", n.units + (n.units === 1 ? " unit" : " units") + ", " + n.file_names);
      return { ok: true, id: n.id };
    }),
    prNoteGet: demo(function (db, t, id) {
      var u = sessionUser(db, t), n = db.pr.notes.filter(function (x) { return x.id === id; })[0];
      if (!n) fail("That table no longer exists."); prProject(db, u, n.project_id);
      var np = db.pr.projects.filter(function (x) { return x.id === n.project_id; })[0];
      return { id: n.id, file_names: n.file_names, columns: n.columns, rows: n.rows, created_at: n.created_at, user: prName(db, n.user_id),
               project_id: n.project_id, project: np ? np.name : "", product: prProductName(db, n.product_id) };
    }),
    prRunGet: demo(function (db, t, id) {
      var u = sessionUser(db, t), r = db.cm.runs.filter(function (x) { return x.id === id; })[0];
      if (!r || !r.project_id) fail("That compliance record is not in a project.");
      var p = prProject(db, u, r.project_id);
      return { run: { id: r.id, file_name: r.file_name, created_at: r.created_at, user: r.user, product: r.product, factory: r.factory, project_id: p.id, project: p.name, client: p.client_name },
        lines: (r.rows || []).map(function (x) {
          var l = db.cm.lines.filter(function (y) { return y.id === x.line_id; })[0], ans = l && l.status === "answered";
          return { seq: x.seq, type: x.type, sr: x.sr, spec: x.spec, can: !!x.line_id, own: !!(x.compliance || x.remarks), compliance: x.compliance, remarks: x.remarks, review: x.review,
                   by: x.answered_by ? prName(db, x.answered_by) : "", lib_compliance: ans ? l.compliance : "", lib_remarks: ans ? l.remarks : "" };
        }) };
    }),
    prRunSaveLine: demo(function (db, t, d) {
      var u = sessionUser(db, t), r = db.cm.runs.filter(function (x) { return x.id === d.run; })[0];
      if (!r || !r.project_id) fail("That compliance record is not in a project.");
      prProject(db, u, r.project_id);
      var x = (r.rows || []).filter(function (y) { return y.seq === d.seq; })[0];
      if (!x || !x.line_id) fail("That row cannot be answered.");
      var l = db.cm.lines.filter(function (y) { return y.id === x.line_id; })[0], c = String(d.compliance || "").trim().slice(0, 200), m = String(d.remarks || "").trim().slice(0, 4000);
      x.compliance = c; x.remarks = m; x.reviewed_by = null; x.reviewed_at = null;
      if (!c && !m) { x.answered_by = null; x.answered_at = null; x.review = ""; }
      else { x.answered_by = u.id; x.answered_at = new Date().toISOString(); x.review = l && l.status === "answered" && l.compliance === c && l.remarks === m ? "" : "pending"; }
      var name = r.file_name || "pasted text", hour = new Date(Date.now() - 3600000).toISOString();
      if (!db.pr.log.some(function (g) { return g.project_id === r.project_id && g.user_id === u.id && g.action === "Compliance filled online" && g.detail === name && g.at > hour; })) prLog(db, r.project_id, u, "Compliance filled online", name);
      return { ok: true, review: x.review };
    }),
    prDeleteRecord: demo(function (db, t, kind, id) {
      var u = sessionUser(db, t), rec;
      if (kind === "note") {
        rec = db.pr.notes.filter(function (x) { return x.id === id; })[0]; if (!rec) fail("That record no longer exists.");
        prProject(db, u, rec.project_id); db.pr.notes = db.pr.notes.filter(function (x) { return x.id !== id; });
        prLog(db, rec.project_id, u, "Datasheet notes deleted", rec.file_names);
      } else if (kind === "run") {
        rec = db.cm.runs.filter(function (x) { return x.id === id; })[0]; if (!rec || !rec.project_id) fail("That record no longer exists.");
        prProject(db, u, rec.project_id); prLog(db, rec.project_id, u, "Compliance record removed", rec.file_name);
        (rec.rows || []).forEach(function (x) { if (x.review === "pending") x.review = ""; }); rec.project_id = null;
      } else fail("Unknown record type.");
      return { ok: true };
    }),
    prSubmitAnswers: demo(function (db, t, runId, rows) {
      var u = sessionUser(db, t), r = db.cm.runs.filter(function (x) { return x.id === runId; })[0], src = {}, stored = 0, pending = 0;
      if (!r || !r.project_id) fail("That compliance record is not in a project.");
      prProject(db, u, r.project_id);
      if (!rows || !rows.length) fail("No rows were found in that file.");
      rows.forEach(function (x) { var c = String(x.compliance || "").trim(), m = String(x.remarks || "").trim(); if (c || m) src[cmNorm(x.spec)] = { c: c, r: m }; });
      (r.rows || []).forEach(function (x) {
        var s = src[cmNorm(x.spec)]; if (!s || !x.line_id || (x.compliance === s.c && x.remarks === s.r)) return;
        var l = db.cm.lines.filter(function (y) { return y.id === x.line_id; })[0];
        x.compliance = s.c; x.remarks = s.r; x.answered_by = u.id; x.answered_at = new Date().toISOString();
        x.review = l && l.status === "answered" && l.compliance === s.c && l.remarks === s.r ? "" : "pending"; x.reviewed_by = null; x.reviewed_at = null;
        stored++; if (x.review === "pending") pending++;
      });
      prLog(db, r.project_id, u, "Filled compliance uploaded", stored + " answers saved, " + pending + " sent for review (" + (r.file_name || "pasted text") + ")");
      return { ok: true, rows: rows.length, stored: stored, pending: pending };
    }),
    prReviewList: demo(function (db, t, d) {
      editor(db, t, "compliance-maker");
      var st = d && ["pending", "approved", "rejected", "all"].indexOf(d.status) >= 0 ? d.status : "pending", counts = { pending: 0, approved: 0, rejected: 0, all: 0 }, items = [];
      db.cm.runs.slice().reverse().forEach(function (r) {
        var p = db.pr.projects.filter(function (x) { return x.id === r.project_id; })[0];
        (r.rows || []).forEach(function (x) {
          var filled = !!(p && (x.compliance || x.remarks));
          if (filled) counts.all++;
          if (x.review) counts[x.review]++;
          if (!(x.review === st || (st === "all" && filled))) return;
          var l = db.cm.lines.filter(function (y) { return y.id === x.line_id; })[0] || {};
          items.push({ run: r.id, seq: x.seq, sr: x.sr, spec: x.spec, compliance: x.compliance, remarks: x.remarks, review: x.review, by: prName(db, x.answered_by), at: x.answered_at,
            project: p ? p.name : "(removed from its project)", client: p ? p.client_name : "", region: p ? p.region : "", product: r.product, factory: r.factory, file_name: r.file_name,
            lib_compliance: l.compliance || "", lib_remarks: l.remarks || "", lib_answered: l.status === "answered",
            reviewed_by: x.reviewed_by ? prName(db, x.reviewed_by) : "", reviewed_at: x.reviewed_at || null });
        });
      });
      items.sort(function (a, b) { return a.project.localeCompare(b.project); });
      var off = (d && d.offset) || 0;
      return { counts: counts, total: items.length, items: items.slice(off, off + ((d && d.limit) || 100)) };
    }),
    prReviewDecide: demo(function (db, t, d) {
      var a = editor(db, t, "compliance-maker"), r = db.cm.runs.filter(function (x) { return x.id === d.run; })[0];
      var x = r && (r.rows || []).filter(function (y) { return y.seq === d.seq; })[0], now = new Date().toISOString();
      if (!x || !x.line_id || !x.review) fail("That answer is no longer waiting for review.");
      if (d.decision === "approve") {
        var c = String(d.compliance == null ? x.compliance : d.compliance).trim(), m = String(d.remarks == null ? x.remarks : d.remarks).trim();
        if (!c && !m) fail("An approved answer cannot be empty.");
        var l = db.cm.lines.filter(function (y) { return y.id === x.line_id; })[0];
        if (l && l.status === "answered" && (l.compliance !== c || l.remarks !== m)) fail("The library already has an answer for this clause, so it was kept. Change it in the Compliance and Remarks boxes if it needs correcting.");
        if (l) { l.compliance = c; l.remarks = m; l.status = "answered"; l.answered_by = a.full_name; l.answered_at = now; l.answer_source = "approved"; }
        db.cm.runs.forEach(function (rr) { (rr.rows || []).forEach(function (y) {
          if (y.line_id === x.line_id && y.review === "pending" && (y === x || (y.compliance === c && y.remarks === m))) { y.review = "approved"; y.reviewed_by = a.id; y.reviewed_at = now; }
        }); });
        if (r.project_id) prLog(db, r.project_id, a, "Answer approved for the library", x.spec.slice(0, 200));
      } else if (d.decision === "reject") {
        x.review = "rejected"; x.reviewed_by = a.id; x.reviewed_at = now;
        if (r.project_id) prLog(db, r.project_id, a, "Answer not taken into the library", x.spec.slice(0, 200));
      } else fail("Unknown decision.");
      return { ok: true };
    }),
    prAdminSummary: demo(function (db, t) {
      admin(db, t);
      function tally(key) { var m = {}; db.pr.projects.forEach(function (p) { m[p[key]] = (m[p[key]] || 0) + 1; }); return Object.keys(m).map(function (k) { return { name: k, n: m[k] }; }).sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); }); }
      var pending = 0, prod = {};
      db.cm.runs.forEach(function (r) { (r.rows || []).forEach(function (x) { if (x.review === "pending") pending++; }); if (r.project_id) (prod[r.product] = prod[r.product] || {})[r.project_id] = 1; });
      db.pr.notes.forEach(function (n) { var nm = prProductName(db, n.product_id); (prod[nm] = prod[nm] || {})[n.project_id] = 1; });
      var newRows = 0; Object.keys(db.dn || {}).forEach(function (k) { ((db.dn[k] || {}).rules || []).forEach(function (r) { if (r["new"]) newRows++; }); });
      return { pending_users: db.users.filter(function (x) { return x.status === "pending"; }).length, pending_answers: pending, new_rows: newRows,
               projects: db.pr.projects.length, by_region: tally("region"), by_client_type: tally("client_type"),
               by_product: Object.keys(prod).map(function (k) { return { name: k, n: Object.keys(prod[k]).length }; }).sort(function (a, b) { return b.n - a.n; }) };
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
