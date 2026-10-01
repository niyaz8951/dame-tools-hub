/* Standards library - shared helpers for index.html and standard.html. */
(function () {
  "use strict";
  var TOOL_ID = "standards";
  var PRODUCT = { ahu: "AHU", fcu: "FCU", chiller: "Chiller" };
  var byId = {}, groupName = {};
  window.STD.ITEMS.forEach(function (s) { byId[s.id] = s; });
  window.STD.GROUPS.forEach(function (g) { groupName[g.id] = g.name; });

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"); }
  // "EN 1886" also finds "EN1886", "EN-1886" and "EN 1886:2007", but not "EN 18860".
  function keyRegex(key) {
    var src = esc(key).replace(/\s+/g, "[\\s\\-]*");
    return new RegExp("(^|[^A-Za-z0-9])" + src + (/\d$/.test(key) ? "(?!\\d)" : ""), "i");
  }
  var compiled = window.STD.ITEMS.map(function (s) { return { item: s, res: (s.keys || []).map(keyRegex) }; });

  // Any text that looks like a standard number, to report the ones the library does not hold.
  var GENERIC = /\b(BS EN|ASHRAE|AHRI|ARI|AMCA|ASTM|ASME|ANSI|NFPA|UL|ISO|IEC|EN|BS|DIN|VDI|NEMA|SASO|ABMA|AFBMA|HTM|IEEE|AWS|CIBSE|GB\/T|GB)[ \t\-\/]{0,3}(?:Standard |Std\.? )?([A-Z]{0,2} ?\d{1,5}(?:[.\/\-]\d{1,4})*[A-Z]?)/g;

  function known(text) { return compiled.some(function (c) { return c.res.some(function (r) { return r.test(text); }); }); }

  /* Reads pasted specification text. Returns the library standards named in it and
     the standard numbers found that the library does not hold. */
  function scan(text) {
    var found = [], missing = [], seen = {}, m;
    compiled.forEach(function (c) { if (c.res.some(function (r) { return r.test(text); })) found.push(c.item); });
    GENERIC.lastIndex = 0;
    while ((m = GENERIC.exec(text))) {
      var num = m[2].replace(/[\-\/](19|20)\d\d$/, "").replace(/\s+/g, " ").trim();
      var name = m[1] + " " + num;
      if (/^(19|20)\d\d$/.test(num)) continue;                // "ISO 2016" style years
      if (known(" " + name + " ")) continue;
      var k = name.toUpperCase().replace(/\s+/g, "");
      if (!seen[k]) { seen[k] = true; missing.push(name); }
    }
    return { found: found, missing: missing };
  }

  // The tile this tool sits in decides the back link (an admin can move the tool).
  function backLink(profile) {
    var cat = profile.categories.filter(function (c) { return c.tools.some(function (t) { return t.id === TOOL_ID; }); })[0];
    return cat ? { href: Hub.url("dashboard.html#" + encodeURIComponent(cat.id)), text: cat.name + " tools" }
               : { href: Hub.url("dashboard.html"), text: "Dashboard" };
  }

  function badges(s) {
    var out = [Hub.el("span", { "class": "badge", text: s.body })];
    (s.products || []).forEach(function (p) { out.push(Hub.el("span", { "class": "badge ok", text: PRODUCT[p] })); });
    return out;
  }

  function tile(s, href) {
    return Hub.el("a", { "class": "tile st-tile", href: href }, [
      Hub.el("h3", { text: s.code }),
      Hub.el("p", { text: s.title }),
      Hub.el("span", { "class": "meta" }, badges(s))
    ]);
  }

  window.Std = { TOOL_ID: TOOL_ID, PRODUCT: PRODUCT, byId: byId, groupName: groupName, scan: scan, backLink: backLink, badges: badges, tile: tile };
})();
