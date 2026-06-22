/**
 * The dashboard single-page app, inlined as a string.
 *
 * Inlined (rather than shipped as static files) so tsup bundles it into
 * `dist/cli.js` with zero asset-copying or runtime path resolution. The
 * page is dependency-free vanilla JS: it fetches `/api/usage` and
 * `/api/settings` and renders. Mutations POST back to the same origin.
 */

const STYLES = /* css */ `
:root {
  --bg: #0d1117;
  --bg-elev: #161b22;
  --bg-elev-2: #1c2128;
  --border: #21262d;
  --border-strong: #30363d;
  --text: #e6edf3;
  --muted: #7d8590;
  --muted-2: #545d68;
  --accent: #39d353;
  --accent-dim: #1a7f37;
  --danger: #f85149;
  --warn: #d29922;
  --radius: 10px;
  --hm-0: #21262d;
  --hm-1: #0e4429;
  --hm-2: #006d32;
  --hm-3: #26a641;
  --hm-4: #39d353;
  --hm-size: 13px;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
.layout { display: grid; grid-template-columns: 248px 1fr; min-height: 100vh; }

/* Sidebar */
.sidebar {
  background: var(--bg-elev);
  border-right: 1px solid var(--border);
  padding: 22px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
  height: 100vh;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 4px 10px 22px; }
.brand .glyph { color: var(--accent); font-weight: 800; font-size: 18px; letter-spacing: -1px; }
.brand .name { font-weight: 700; font-size: 16px; }
.brand .ver { color: var(--muted-2); font-size: 11px; margin-left: 2px; }
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: 8px; cursor: pointer;
  color: var(--muted); font-weight: 500; user-select: none;
}
.nav-item:hover { background: var(--bg-elev-2); color: var(--text); }
.nav-item.active { background: var(--bg-elev-2); color: var(--text); }
.nav-item .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .5; }
.nav-item.active .dot { background: var(--accent); opacity: 1; }
.sidebar .spacer { flex: 1; }
.sidebar .footer { color: var(--muted-2); font-size: 11px; padding: 8px 12px; border-top: 1px solid var(--border); }

/* Main */
.main { padding: 32px 48px 80px; width: 100%; max-width: 1600px; margin: 0 auto; }
.page-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
h1 { font-size: 22px; font-weight: 700; margin: 0; }
.subtle { color: var(--muted); font-size: 13px; }
.project-path { color: var(--muted); font-size: 12px; margin: 2px 0 26px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.section { margin-bottom: 34px; }
.section-title { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin: 0 0 14px; }
.section-sub { font-size: 12px; color: var(--muted); margin: -8px 0 14px; }

/* Stat cards */
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.card {
  background: var(--bg-elev); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px 18px;
}
.card .label { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
.card .value { font-size: 26px; font-weight: 700; letter-spacing: -.5px; }
.card .sub { color: var(--muted-2); font-size: 12px; margin-top: 4px; }

/* Heatmap */
.heatmap-wrap {
  background: var(--bg-elev); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 20px 22px;
}
.heatmap-top { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
.heatmap-top .big { font-size: 28px; font-weight: 700; letter-spacing: -.5px; }
.heatmap-scroll { overflow-x: auto; padding-bottom: 4px; }
.heatmap-cal { display: inline-flex; flex-direction: column; gap: 5px; min-width: min-content; }
.hm-months { display: grid; gap: 1px; margin-left: 30px; height: 13px; color: var(--muted); font-size: 11px; }
.hm-month { line-height: 13px; white-space: nowrap; overflow: visible; }
.hm-body { display: flex; gap: 6px; }
.hm-weekdays { display: grid; grid-template-rows: repeat(7, var(--hm-size)); gap: 1px; width: 24px; color: var(--muted); font-size: 10px; }
.hm-weekdays span { line-height: var(--hm-size); height: var(--hm-size); }
.heatmap { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, var(--hm-size)); gap: 1px; }
.hm-cell { width: var(--hm-size); height: var(--hm-size); border-radius: 2px; background: var(--hm-0); }
.hm-cell[data-date] { cursor: pointer; }
.hm-cell[data-date]:hover { outline: 1px solid var(--text); outline-offset: -1px; }
.hm-cell.hm-pad { background: transparent; }
.hm-cell[data-l="1"] { background: var(--hm-1); }
.hm-cell[data-l="2"] { background: var(--hm-2); }
.hm-cell[data-l="3"] { background: var(--hm-3); }
.hm-cell[data-l="4"] { background: var(--hm-4); }
.hm-legend { display: flex; align-items: center; gap: 6px; justify-content: flex-end; margin-top: 12px; color: var(--muted); font-size: 11px; }
.hm-legend .hm-cell { width: 11px; height: 11px; }
.hm-tip {
  position: fixed; z-index: 1000; pointer-events: none; opacity: 0;
  transform: translate(-50%, -100%); transition: opacity .08s ease;
  background: #0b0f14; border: 1px solid var(--border-strong);
  border-radius: 6px; padding: 7px 10px; font-size: 12px; line-height: 1.4;
  color: var(--text); box-shadow: 0 6px 20px rgba(0,0,0,.45); white-space: nowrap;
}
.hm-tip.show { opacity: 1; }
.hm-tip .hm-tip-date { color: var(--muted); font-size: 11px; margin-bottom: 1px; }
.hm-tip .hm-tip-empty { color: var(--muted); }

/* Highlights row */
.highlights { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 16px; }
.highlight .h-label { color: var(--muted); font-size: 12px; }
.highlight .h-value { font-size: 18px; font-weight: 600; margin-top: 2px; }

/* Breakdown bars */
.bars { display: flex; flex-direction: column; gap: 14px; }
.bar-row { display: flex; flex-direction: column; gap: 6px; }
.bar-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.bar-row .bname { color: var(--text); font-size: 13px; word-break: break-word; }
.bar-track { background: var(--bg-elev-2); border-radius: 6px; height: 10px; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent-dim), var(--accent)); border-radius: 6px; }
.bar-row .bval { color: var(--muted); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; flex: none; }

/* Spending meter */
.meter-card { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; }
.meter-top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 12px; flex-wrap: wrap; }
.meter-spent { font-size: 26px; font-weight: 700; letter-spacing: -.5px; }
.meter-spent .of { color: var(--muted); font-size: 16px; font-weight: 500; }
.meter-label { color: var(--muted); font-size: 12px; }
.meter-track { background: var(--bg-elev-2); border-radius: 999px; height: 10px; overflow: hidden; }
.meter-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--accent-dim), var(--accent)); transition: width .3s ease; }
.meter-fill.warn { background: linear-gradient(90deg, #9e6a00, var(--warn)); }
.meter-fill.over { background: linear-gradient(90deg, #a32820, var(--danger)); }
.meter-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; color: var(--muted); font-size: 12px; }
.meter-foot .pct { font-variant-numeric: tabular-nums; }
.meter-foot .pct.over { color: var(--danger); }
.limit-form { display: flex; align-items: center; gap: 8px; }
.limit-form .input { width: 130px; }
.no-limit { color: var(--muted); font-size: 13px; }

/* Table */
.table { width: 100%; border-collapse: collapse; }
.table th { text-align: left; color: var(--muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.table td { padding: 11px 12px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: top; }
.table tr:hover td { background: var(--bg-elev); }
.table .prompt { color: var(--text); max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); }
.num { font-variant-numeric: tabular-nums; text-align: right; }
.panel { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }

/* Badges */
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; border: 1px solid transparent; }
.badge.success { color: var(--accent); border-color: var(--accent-dim); background: rgba(57,211,83,.08); }
.badge.failed { color: var(--danger); border-color: rgba(248,81,73,.4); background: rgba(248,81,73,.08); }
.badge.partial { color: var(--warn); border-color: rgba(210,153,34,.4); background: rgba(210,153,34,.08); }
.badge.mode { color: var(--muted); border-color: var(--border-strong); background: var(--bg-elev-2); text-transform: lowercase; }

/* Settings */
.setting-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 16px 18px; border-bottom: 1px solid var(--border);
}
.setting-row:last-child { border-bottom: none; }
.setting-row .meta .title { font-weight: 600; }
.setting-row .meta .desc { color: var(--muted); font-size: 12px; margin-top: 2px; }
.setting-row .meta .key { color: var(--muted-2); font-size: 12px; margin-top: 4px; font-family: ui-monospace, Menlo, monospace; }
.pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border-strong); color: var(--muted); }
.pill.on { color: var(--accent); border-color: var(--accent-dim); }
.saved-tag { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 500; color: var(--accent); }
.saved-tag.muted { color: var(--muted); }
.btn {
  background: var(--bg-elev-2); color: var(--text); border: 1px solid var(--border-strong);
  padding: 6px 14px; border-radius: 7px; cursor: pointer; font-size: 13px; font-weight: 500;
}
.btn:hover { border-color: var(--muted); }
.btn.primary { background: var(--accent-dim); border-color: var(--accent-dim); color: #fff; }
.btn.primary:hover { background: var(--accent); }
.btn.danger { color: var(--danger); }
.btn.danger:hover { border-color: var(--danger); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.input {
  background: var(--bg); color: var(--text); border: 1px solid var(--border-strong);
  padding: 7px 10px; border-radius: 7px; font-size: 13px; width: 280px;
  font-family: ui-monospace, Menlo, monospace;
}
.input:focus { outline: none; border-color: var(--accent-dim); }
.row-actions { display: flex; gap: 8px; align-items: center; }
.select {
  background: var(--bg); color: var(--text); border: 1px solid var(--border-strong);
  padding: 7px 10px; border-radius: 7px; font-size: 13px; min-width: 300px; cursor: pointer;
  font-family: ui-monospace, Menlo, monospace;
}
.select:focus { outline: none; border-color: var(--accent-dim); }
.intro { color: var(--muted); font-size: 13px; line-height: 1.55; max-width: 660px; margin: -4px 0 4px; }

/* Searchable model combobox */
.panel.picker { overflow: visible; }
.combo { position: relative; }
.combo-input { width: 420px; padding-right: 30px; cursor: text; }
.combo-input::placeholder { color: var(--muted-2); }
.combo-caret { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--muted-2); font-size: 10px; pointer-events: none; }
.combo-menu {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40;
  max-height: 340px; overflow-y: auto; background: var(--bg-elev);
  border: 1px solid var(--border-strong); border-radius: 9px;
  box-shadow: 0 12px 34px rgba(0,0,0,.5); padding: 5px;
}
.combo-menu.hidden { display: none; }
.combo-item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  font-size: 13px; font-family: ui-monospace, Menlo, monospace;
}
.combo-item:hover, .combo-item.active { background: var(--bg-elev-2); }
.combo-item .ci-main { display: flex; align-items: center; gap: 7px; min-width: 0; }
.combo-item .ci-id { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.combo-item.auto .ci-id, .combo-item.custom .ci-id { color: var(--muted); }
.combo-item.selected .ci-id { color: var(--accent); }
.combo-item .ci-meta { color: var(--muted-2); font-size: 11px; white-space: nowrap; flex: none; }
.combo-cap { font-size: 9px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border-strong); color: var(--muted); flex: none; }
.combo-cap.tools { color: #7fd6a3; border-color: rgba(110,200,150,.35); }
.combo-cap.vision { color: #c8a8ff; border-color: rgba(186,140,255,.35); }
.combo-cap.q-frontier { color: #ffd27f; border-color: rgba(255,200,110,.4); }
.combo-cap.q-strong { color: #c8a8ff; border-color: rgba(186,140,255,.35); }
.combo-cap.q-mid { color: #7fc2d6; border-color: rgba(110,180,200,.35); }
.combo-cap.q-small { color: var(--muted); border-color: var(--border-strong); }
.combo-note { padding: 9px 11px; color: var(--muted); font-size: 12px; }
.combo-foot { padding: 7px 11px 4px; color: var(--muted-2); font-size: 11px; border-top: 1px solid var(--border); margin-top: 4px; }
.tier-badge { display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 5px; margin-left: 8px; }
.tier-badge.strong { background: rgba(186,140,255,.14); color: #c8a8ff; }
.tier-badge.cheap { background: rgba(110,200,150,.14); color: #7fd6a3; }

/* Toggle */
.toggle { width: 38px; height: 22px; border-radius: 999px; background: var(--bg-elev-2); border: 1px solid var(--border-strong); position: relative; cursor: pointer; flex: none; }
.toggle .knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--muted); transition: all .15s ease; }
.toggle.on { background: var(--accent-dim); border-color: var(--accent-dim); }
.toggle.on .knob { left: 18px; background: #fff; }

/* Customize (rules / skills / subagents) */
.scope-pill { font-size: 10px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border-strong); color: var(--muted); margin-left: 8px; }
.scope-pill.project { color: #7fd6a3; border-color: rgba(110,200,150,.35); }
.scope-pill.global { color: #c8a8ff; border-color: rgba(186,140,255,.35); }
.chip { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 5px; border: 1px solid var(--border-strong); color: var(--muted); margin-right: 6px; margin-top: 4px; font-family: ui-monospace, Menlo, monospace; }
.chip.on { color: var(--accent); border-color: var(--accent-dim); }
.asset-body { color: var(--muted); font-size: 12px; margin-top: 6px; white-space: pre-wrap; max-height: 60px; overflow: hidden; font-family: ui-monospace, Menlo, monospace; }
.editor { background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 18px 20px; margin-bottom: 20px; }
.editor h3 { margin: 0 0 14px; font-size: 15px; }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.field label { font-size: 12px; color: var(--muted); font-weight: 600; }
.field .input, .field .select { width: 100%; }
.field-row { display: flex; gap: 14px; }
.field-row .field { flex: 1; }
.textarea {
  background: var(--bg); color: var(--text); border: 1px solid var(--border-strong);
  padding: 10px 12px; border-radius: 7px; font-size: 13px; width: 100%; min-height: 150px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; resize: vertical;
}
.textarea:focus, .field .input:focus, .field .select:focus { outline: none; border-color: var(--accent-dim); }
.editor-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.check { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; font-size: 13px; }
.check input { width: 15px; height: 15px; accent-color: var(--accent); }

.empty { color: var(--muted); padding: 40px; text-align: center; border: 1px dashed var(--border-strong); border-radius: var(--radius); }
.toast { position: fixed; bottom: 22px; right: 22px; background: var(--bg-elev-2); border: 1px solid var(--border-strong); padding: 12px 16px; border-radius: 8px; opacity: 0; transform: translateY(8px); transition: all .2s ease; pointer-events: none; }
.toast.show { opacity: 1; transform: translateY(0); }
.hidden { display: none !important; }
.tabs { display: flex; gap: 4px; background: var(--bg-elev-2); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
.tab { padding: 4px 12px; border-radius: 6px; cursor: pointer; color: var(--muted); font-size: 12px; font-weight: 500; }
.tab.active { background: var(--bg); color: var(--text); }

/* Marketplace / plugins */
.plugin-toolbar { display: flex; gap: 10px; align-items: center; margin: 4px 0 20px; flex-wrap: wrap; }
.plugin-search { flex: 1 1 280px; width: auto; }
.plugin-layout { display: grid; grid-template-columns: 168px 1fr; gap: 26px; align-items: start; }
.cat-list { display: flex; flex-direction: column; gap: 1px; position: sticky; top: 18px; }
.cat-item { padding: 6px 11px; border-radius: 6px; cursor: pointer; color: var(--muted); font-size: 12.5px; }
.cat-item:hover { background: var(--bg-elev-2); color: var(--text); }
.cat-item.active { background: var(--bg-elev-2); color: var(--text); font-weight: 600; }
.plugin-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.plugin-card { background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 15px 17px; display: flex; flex-direction: column; gap: 9px; cursor: pointer; transition: border-color .15s ease; min-height: 132px; }
.plugin-card:hover { border-color: var(--muted); }
.plugin-card .prow { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.plugin-card .prow.bottom { margin-top: auto; align-items: flex-end; }
.plugin-card .pname { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.plugin-card .pdesc { color: var(--muted); font-size: 12.5px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.plugin-card .pmeta { display: flex; flex-wrap: wrap; gap: 0; }
.muted-sm { color: var(--muted-2); font-size: 12px; }
.modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 24px; }
.modal { background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: 12px; max-width: 580px; width: 100%; max-height: 86vh; overflow: auto; padding: 22px 26px 26px; }
.modal h2 { margin: 0 0 4px; font-size: 18px; }
.asset-line { display: flex; gap: 10px; align-items: baseline; padding: 10px 0; border-top: 1px solid var(--border); }
.asset-line:first-of-type { border-top: none; }
.asset-line .asset-kind { font-size: 10px; text-transform: uppercase; font-weight: 700; letter-spacing: .04em; padding: 2px 7px; border-radius: 5px; border: 1px solid var(--border-strong); color: var(--muted); flex: 0 0 auto; }
.asset-line .title { font-weight: 600; font-size: 13px; }
.asset-line .key { color: var(--muted-2); font-size: 12px; margin-top: 3px; font-family: ui-monospace, Menlo, monospace; }
.mp-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.mp-row .mp-name { font-size: 12.5px; font-weight: 600; }
.mp-add { display: flex; gap: 6px; margin-top: 10px; }
.mp-add .input { width: 100%; flex: 1; min-width: 0; }
.btn-x { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 13px; padding: 2px 6px; border-radius: 5px; }
.btn-x:hover { color: var(--danger); background: var(--bg-elev-2); }
.chip.danger-chip { color: var(--danger); border-color: rgba(248,81,73,.4); }

@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; }
  .sidebar .spacer, .sidebar .footer { display: none; }
  .main { padding: 24px 20px 60px; }
  .cards, .highlights { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 520px) {
  .cards, .highlights { grid-template-columns: 1fr; }
}
`;

const APP_JS = /* js */ `
const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtNum = (n) => {
  if (n == null) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\\.0$/, '') + 'K';
  return String(Math.round(n));
};
const fmtFull = (n) => Number(n || 0).toLocaleString();
const fmtUsd = (n) => '$' + Number(n || 0).toFixed(2);
const fmtDur = (ms) => { if (!ms) return '—'; const s = ms / 1000; return s < 60 ? s.toFixed(1) + 's' : (s / 60).toFixed(1) + 'm'; };
const fmtPct = (f) => (f * 100).toFixed(0) + '%';
const fmtMonth = (key) => { if (!key) return '—'; const [y, m] = key.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' }); };
const fmtDay = (key) => { if (!key) return '—'; const [y, m, d] = key.split('-'); return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtAgo = (ts) => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};

let usage = null;
let settings = null;
let current = 'overview';
let orCatalog = null;       // { models: [...], error } once loaded
let orCatalogLoading = false;
let assets = null;          // { rules, skills, subagents, roots }
let assetTab = 'rules';
let assetEditor = null;     // { kind, item } when an editor is open, else null
let pluginsData = null;     // { catalog, installedExtra, categories } once loaded
let pluginQuery = '';
let pluginCategory = '';    // '' = all categories
let pluginScope = 'project';
let pluginDetail = null;    // id of the plugin whose detail modal is open
let pluginBusy = false;
let pluginPreview = {};     // { [id]: ResolvedPlugin | { error } } lazy cache
const SUBTASK_KINDS = ['architecture', 'feature', 'bugfix', 'refactor', 'test', 'docs', 'mechanical'];

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(txt || ('HTTP ' + res.status)); }
  return res.status === 204 ? null : res.json();
}

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = el('<div id="toast" class="toast"></div>'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function heatLevel(runs, max) {
  if (!runs) return 0;
  if (max <= 0) return 0;
  const r = runs / max;
  if (r > 0.66) return 4;
  if (r > 0.33) return 3;
  if (r > 0.12) return 2;
  return 1;
}

const HM_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// GitHub-style contribution calendar: weeks are columns, weekdays are rows
// (Sunday on top). Leading blanks pad the first partial week so every cell
// lands on its true weekday. Cells carry data-* used by the hover tooltip.
function renderHeatmap(days) {
  if (!days || !days.length) return '<div class="heatmap-scroll"></div>';
  const max = days.reduce((m, d) => Math.max(m, d.runs), 0);
  const first = new Date(days[0].date + 'T00:00:00');
  const lead = first.getDay();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="hm-cell hm-pad"></div>');
  for (const d of days) {
    cells.push(
      '<div class="hm-cell" data-l="' + heatLevel(d.runs, max) +
      '" data-date="' + esc(d.date) + '" data-runs="' + d.runs + '" data-tokens="' + d.tokens + '"></div>'
    );
  }
  const totalCols = Math.ceil((lead + days.length) / 7);
  const months = [];
  let prev = -1;
  for (let c = 0; c < totalCols; c++) {
    const probe = Math.max(0, c * 7 - lead);
    let label = '';
    if (probe < days.length) {
      const m = new Date(days[probe].date + 'T00:00:00').getMonth();
      if (m !== prev) { if (c < totalCols - 1) label = HM_MONTHS[m]; prev = m; }
    }
    months.push('<div class="hm-month">' + label + '</div>');
  }
  const cols = 'repeat(' + totalCols + ',var(--hm-size))';
  return (
    '<div class="heatmap-scroll"><div class="heatmap-cal">' +
      '<div class="hm-months" style="grid-template-columns:' + cols + '">' + months.join('') + '</div>' +
      '<div class="hm-body">' +
        '<div class="hm-weekdays"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span></div>' +
        '<div class="heatmap" style="grid-template-columns:' + cols + '">' + cells.join('') + '</div>' +
      '</div>' +
    '</div></div>'
  );
}

// Single floating tooltip shared by all heatmap cells, wired once via event
// delegation so it survives section re-renders.
function initHeatmapTooltip() {
  if (window.__hmTipReady) return;
  window.__hmTipReady = true;
  const tip = el('<div class="hm-tip"></div>');
  document.body.appendChild(tip);
  const position = (e) => {
    tip.style.left = e.clientX + 'px';
    tip.style.top = (e.clientY - 10) + 'px';
  };
  document.addEventListener('mouseover', (e) => {
    const cell = e.target.closest && e.target.closest('.hm-cell[data-date]');
    if (!cell) return;
    const runs = Number(cell.dataset.runs || 0);
    const tokens = Number(cell.dataset.tokens || 0);
    const dt = new Date(cell.dataset.date + 'T00:00:00');
    const dateStr = dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const body = runs
      ? '<strong>' + fmtFull(runs) + ' run' + (runs === 1 ? '' : 's') + '</strong> · ' + fmtNum(tokens) + ' tokens'
      : '<span class="hm-tip-empty">No activity</span>';
    tip.innerHTML = '<div class="hm-tip-date">' + esc(dateStr) + '</div>' + body;
    position(e);
    tip.classList.add('show');
  });
  document.addEventListener('mousemove', (e) => {
    if (!tip.classList.contains('show')) return;
    if (e.target.closest && e.target.closest('.hm-cell[data-date]')) position(e);
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest && e.target.closest('.hm-cell[data-date]')) tip.classList.remove('show');
  });
}

function statCard(label, value, sub) {
  return '<div class="card"><div class="label">' + esc(label) + '</div><div class="value">' + value + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
}

function bars(rows, unit) {
  if (!rows.length) return '<div class="empty">No data yet.</div>';
  const metric = (r) => (unit === 'tokens' ? r.tokens : unit === 'cost' ? r.costUsd : r.runs);
  const max = rows.reduce((m, r) => Math.max(m, metric(r)), 0) || 1;
  return '<div class="bars">' + rows.map((r) => {
    const val = unit === 'tokens' ? fmtNum(r.tokens) + ' tok' : unit === 'cost' ? fmtUsd(r.costUsd) : r.runs + ' run' + (r.runs === 1 ? '' : 's');
    return '<div class="bar-row">' +
      '<div class="bar-head"><span class="bname">' + esc(r.label) + '</span><span class="bval">' + val + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(3, (metric(r) / max) * 100) + '%"></div></div>' +
      '</div>';
  }).join('') + '</div>';
}

function runsTable(runs) {
  if (!runs.length) return '<div class="empty">No runs recorded on this machine yet. Run <span class="mono">coderouter</span> in any repo to get started.</div>';
  const rows = runs.map((r) =>
    '<tr>' +
    '<td><span class="badge mode">' + esc(r.mode) + '</span></td>' +
    '<td class="prompt" title="' + esc(r.prompt) + '">' + esc(r.prompt || '—') + '</td>' +
    '<td class="mono">' + esc(r.route) + '</td>' +
    '<td><span class="badge ' + esc(r.status) + '">' + esc(r.status) + '</span></td>' +
    '<td class="num mono">' + fmtNum(r.tokensIn + r.tokensOut) + '</td>' +
    '<td class="num mono">' + fmtUsd(r.costUsd) + '</td>' +
    '<td class="num mono">' + fmtDur(r.durationMs) + '</td>' +
    '<td class="num mono" title="' + new Date(r.createdAt).toLocaleString() + '">' + fmtAgo(r.createdAt) + '</td>' +
    '</tr>'
  ).join('');
  return '<div class="panel"><table class="table"><thead><tr>' +
    '<th>Mode</th><th>Prompt</th><th>Route</th><th>Status</th><th class="num">Tokens</th><th class="num">Cost</th><th class="num">Time</th><th class="num">When</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function scopeLine() {
  const pc = (usage.project && usage.project.projectCount) || 0;
  if (!usage.project.hasData) {
    return '<div class="project-path">No CodeRouter usage on this machine yet · launched from ' + esc(usage.project.cwd) + '</div>';
  }
  return '<div class="project-path">All CodeRouter projects on this machine · ' + pc + ' project' + (pc === 1 ? '' : 's') + ' · launched from ' + esc(usage.project.cwd) + '</div>';
}

function renderOverview() {
  const t = usage.totals;
  const h = usage.highlights;
  const main = $('#view');
  main.innerHTML =
    '<div class="page-head"><h1>Overview</h1><span class="subtle">' + (usage.project.hasData ? usage.totals.runs + ' total runs' : 'No usage yet') + '</span></div>' +
    scopeLine() +
    '<div class="section"><div class="cards">' +
      statCard('Total tokens', fmtNum(t.tokens), fmtFull(t.tokensIn) + ' in · ' + fmtFull(t.tokensOut) + ' out') +
      statCard('Runs', fmtFull(t.runs), fmtPct(t.successRate) + ' success') +
      statCard('Cost', fmtUsd(t.costUsd), 'across all routes') +
      statCard('Avg duration', fmtDur(t.avgDurationMs), t.avgRating != null ? ('rating ' + t.avgRating.toFixed(1) + '/5') : 'per run') +
    '</div></div>' +
    '<div class="section"><div class="heatmap-wrap">' +
      '<div class="heatmap-top"><div><div class="label subtle">Activity</div><div class="big">' + fmtNum(t.tokens) + ' <span class="subtle" style="font-size:14px;font-weight:500">tokens</span></div></div></div>' +
      renderHeatmap(usage.heatmap) +
      '<div class="hm-legend">Less <span class="hm-cell" data-l="0"></span><span class="hm-cell" data-l="1"></span><span class="hm-cell" data-l="2"></span><span class="hm-cell" data-l="3"></span><span class="hm-cell" data-l="4"></span> More</div>' +
    '</div>' +
    '<div class="highlights">' +
      '<div class="card highlight"><div class="h-label">Most active month</div><div class="h-value">' + fmtMonth(h.mostActiveMonth) + '</div></div>' +
      '<div class="card highlight"><div class="h-label">Most active day</div><div class="h-value">' + fmtDay(h.mostActiveDay) + '</div></div>' +
      '<div class="card highlight"><div class="h-label">Longest streak</div><div class="h-value">' + h.longestStreakDays + 'd</div></div>' +
      '<div class="card highlight"><div class="h-label">Current streak</div><div class="h-value">' + h.currentStreakDays + 'd</div></div>' +
    '</div></div>' +
    '<div class="section"><div class="section-title">Recent runs</div>' + runsTable(usage.recentRuns.slice(0, 12)) + '</div>';
}

function spendMeter(opts) {
  const spent = usage.totals.monthCostUsd || 0;
  const limit = settings && settings.limits ? settings.limits.monthlyUsd : null;
  const monthName = fmtMonth(usage.totals.monthKey);
  const editable = opts && opts.editable;

  let body;
  if (limit) {
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    const pctCls = pct >= 100 ? 'over' : '';
    body =
      '<div class="meter-top">' +
        '<div><div class="meter-label">Spending · ' + esc(monthName) + '</div>' +
          '<div class="meter-spent">' + fmtUsd(spent) + ' <span class="of">/ ' + fmtUsd(limit) + '</span></div></div>' +
        (editable ? limitForm(limit) : '') +
      '</div>' +
      '<div class="meter-track"><div class="meter-fill ' + cls + '" style="width:' + Math.min(100, Math.max(2, pct)) + '%"></div></div>' +
      '<div class="meter-foot"><span>' + fmtUsd(Math.max(0, limit - spent)) + ' remaining this month</span>' +
        '<span class="pct ' + pctCls + '">' + pct.toFixed(0) + '%</span></div>';
  } else {
    body =
      '<div class="meter-top">' +
        '<div><div class="meter-label">Spending · ' + esc(monthName) + '</div>' +
          '<div class="meter-spent">' + fmtUsd(spent) + '</div></div>' +
        (editable ? limitForm(null) : '<span class="no-limit">No monthly limit set</span>') +
      '</div>' +
      (editable ? '' : '<div class="meter-foot"><span class="no-limit">Set a limit on the Spending tab to track a budget.</span></div>');
  }
  return '<div class="meter-card">' + body + '</div>';
}

function limitForm(current) {
  return '<div class="limit-form">' +
    '<span class="meter-label">Monthly limit $</span>' +
    '<input class="input" type="number" min="0" step="1" placeholder="none" value="' + (current != null ? esc(current) : '') + '" data-limit-input />' +
    '<button class="btn primary" data-save-limit>Save</button>' +
    (current != null ? '<button class="btn" data-clear-limit>Clear</button>' : '') +
    '</div>';
}

function wireLimitForm(root) {
  const save = root.querySelector('[data-save-limit]');
  if (save) save.addEventListener('click', () => {
    const input = root.querySelector('[data-limit-input]');
    const val = input ? parseFloat(input.value) : NaN;
    saveLimit(Number.isFinite(val) && val > 0 ? val : null);
  });
  const clear = root.querySelector('[data-clear-limit]');
  if (clear) clear.addEventListener('click', () => saveLimit(null));
}

async function saveLimit(monthlyUsd) {
  try {
    await api('/api/settings/limit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ monthlyUsd }) });
    toast(monthlyUsd ? ('Monthly limit set to ' + fmtUsd(monthlyUsd)) : 'Monthly limit cleared');
    await loadSettings();
    if (current === 'spending') renderSpending(); else renderUsage();
  } catch (e) { toast('Failed: ' + e.message); }
}

let usageUnit = 'cost';
function renderUsage() {
  const main = $('#view');
  main.innerHTML =
    '<div class="page-head"><h1>Usage</h1>' +
      '<div class="tabs"><div class="tab ' + (usageUnit === 'cost' ? 'active' : '') + '" data-unit="cost">Cost</div><div class="tab ' + (usageUnit === 'tokens' ? 'active' : '') + '" data-unit="tokens">Tokens</div><div class="tab ' + (usageUnit === 'runs' ? 'active' : '') + '" data-unit="runs">Runs</div></div>' +
    '</div>' +
    scopeLine() +
    '<div class="section">' + spendMeter({ editable: false }) + '</div>' +
    '<div class="section"><div class="section-title">By model / provider</div>' + bars(usage.byProvider, usageUnit) + '</div>' +
    '<div class="section"><div class="section-title">By mode</div>' + bars(usage.byMode, usageUnit) + '</div>' +
    '<div class="section"><div class="section-title">By task type</div>' + bars(usage.byTaskType, usageUnit) + '</div>' +
    '<div class="section"><div class="section-title">All recent runs</div>' + runsTable(usage.recentRuns) + '</div>';
  main.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { usageUnit = tab.dataset.unit; renderUsage(); }));
}

function renderSpending() {
  const main = $('#view');
  const t = usage.totals;
  main.innerHTML =
    '<div class="page-head"><h1>Spending</h1><span class="subtle">' + fmtUsd(t.costUsd) + ' all-time</span></div>' +
    scopeLine() +
    '<div class="section">' + spendMeter({ editable: true }) + '</div>' +
    '<div class="section"><div class="cards">' +
      statCard('This month', fmtUsd(t.monthCostUsd), fmtMonth(t.monthKey)) +
      statCard('All-time cost', fmtUsd(t.costUsd), t.runs + ' runs') +
      statCard('Avg cost / run', fmtUsd(t.runs > 0 ? t.costUsd / t.runs : 0), 'across all routes') +
    '</div></div>' +
    '<div class="section"><div class="section-title">Cost by model / provider</div>' + bars(usage.byProvider, 'cost') + '</div>';
  wireLimitForm(main);
}

function providerRow(p) {
  const right = p.configured
    ? '<div class="row-actions">' +
        (p.source === 'shell'
          ? '<span class="saved-tag muted">set in shell env</span>'
          : '<span class="saved-tag">✓ Saved</span><button class="btn danger" data-remove="' + esc(p.name) + '">Remove</button>')
      + '</div>'
    : '<div class="row-actions"><input class="input" type="password" placeholder="' + esc(p.example) + '" data-key-input="' + esc(p.name) + '" />' +
        '<button class="btn primary" data-save="' + esc(p.name) + '">Save</button></div>';
  return '<div class="setting-row"><div class="meta"><div class="title">' + esc(p.label) + '</div>' +
    '<div class="desc">' + esc(p.envVar) + '</div>' +
    (p.masked ? '<div class="key">' + esc(p.masked) + '</div>' : '') +
    '</div>' + right + '</div>';
}

function hostRow(host) {
  return '<div class="setting-row"><div class="meta"><div class="title">' + esc(host.label) + '</div>' +
    '<div class="desc">' + esc(host.blurb) + '</div>' +
    '<div class="key">' + esc(host.binPath) + '</div></div>' +
    '<div class="toggle ' + (host.enabled ? 'on' : '') + '" data-host="' + esc(host.provider) + '"><div class="knob"></div></div></div>';
}

function renderSettings() {
  const main = $('#view');
  const hosts = settings.hosts.length
    ? '<div class="panel">' + settings.hosts.map(hostRow).join('') + '</div>'
    : '<div class="empty">No local CLIs detected on PATH (codex, claude, ollama).</div>';
  const searchProviders = settings.searchProviders || [];
  const searchSection = searchProviders.length
    ? '<div class="section"><div class="section-title">Web search</div>' +
        '<div class="section-sub">Optional. Web search works keyless via DuckDuckGo; add a key for higher-quality results.</div>' +
        '<div class="panel">' + searchProviders.map(providerRow).join('') + '</div>' +
      '</div>'
    : '';
  main.innerHTML =
    '<div class="page-head"><h1>Settings</h1></div>' +
    '<div class="section"><div class="section-title">API providers</div>' +
      '<div class="panel">' + settings.providers.map(providerRow).join('') + '</div>' +
    '</div>' +
    searchSection +
    '<div class="section"><div class="section-title">Local CLIs</div>' + hosts + '</div>' +
    '<div class="section"><div class="section-title">Locations</div>' +
      '<div class="panel"><div class="setting-row"><div class="meta"><div class="title">Credentials</div><div class="key">' + esc(settings.paths.credentials) + '</div></div></div>' +
      '<div class="setting-row"><div class="meta"><div class="title">Project database</div><div class="key">' + esc(settings.paths.db) + '</div></div></div></div>' +
    '</div>';

  main.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => saveKey(b.dataset.save)));
  main.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => removeKey(b.dataset.remove)));
  main.querySelectorAll('[data-host]').forEach((tg) => tg.addEventListener('click', () => toggleHost(tg.dataset.host, !tg.classList.contains('on'))));
}

async function saveKey(name) {
  const input = $('[data-key-input="' + name + '"]');
  const apiKey = input ? input.value.trim() : '';
  if (!apiKey) { toast('Enter a key first'); return; }
  try {
    await api('/api/settings/key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, apiKey }) });
    toast('Saved ' + name + ' key');
    await loadSettings(); renderSettings();
  } catch (e) { toast('Failed: ' + e.message); }
}

async function removeKey(name) {
  try {
    await api('/api/settings/key', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    toast('Removed ' + name + ' key');
    await loadSettings(); renderSettings();
  } catch (e) { toast('Failed: ' + e.message); }
}

async function toggleHost(provider, enabled) {
  try {
    await api('/api/settings/host', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, enabled }) });
    toast((enabled ? 'Enabled ' : 'Disabled ') + provider);
    await loadSettings(); renderSettings();
  } catch (e) { toast('Failed: ' + e.message); }
}

function prefTierRow(tier, title, desc, current) {
  const val = current && current.model ? current.model : '';
  return '<div class="section">' +
    '<div class="section-title">' + esc(title) + '<span class="tier-badge ' + tier + '">' + tier + '</span></div>' +
    '<div class="panel picker"><div class="setting-row"><div class="meta">' +
      '<div class="title">Preferred model</div><div class="desc">' + esc(desc) + '</div></div>' +
      '<div class="row-actions" style="position:relative">' +
        '<div class="combo" data-combo="' + tier + '">' +
          '<input class="input combo-input" type="text" spellcheck="false" autocomplete="off" ' +
            'placeholder="Automatic — let the router decide" value="' + esc(val) + '" ' +
            'data-combo-input="' + tier + '" />' +
          '<span class="combo-caret">▼</span>' +
          '<div class="combo-menu hidden" data-combo-menu="' + tier + '"></div>' +
        '</div>' +
      '</div>' +
    '</div></div></div>';
}

function priceHint(m) {
  if (!m.pricePer1MIn && !m.pricePer1MOut) return 'free';
  const f = (n) => n >= 1 ? '$' + n.toFixed(2) : '$' + n.toFixed(3).replace(/0+$/, '').replace(/\\.$/, '');
  return f(m.pricePer1MIn) + ' in / ' + f(m.pricePer1MOut) + ' out · 1M tok';
}

function renderModels() {
  const main = $('#view');
  const pref = settings.preferredModels || { strong: null, cheap: null };
  const head = '<div class="page-head"><h1>Models</h1></div>';
  const orReady = (settings.providers || []).some((p) => p.name === 'openrouter' && p.configured);
  const keyNote = orReady ? '' :
    '<p class="intro" style="color:var(--muted-2)">Tip: add an <strong>OpenRouter</strong> API key in Settings so these models can actually be routed to.</p>';
  main.innerHTML = head +
    '<p class="intro">CodeRouter picks a model for every task automatically. Pin a preferred model below and routing will lean on it — your <strong>strong</strong> pick for complex work (deep reasoning, multi-file, huge context) and your <strong>cheap</strong> pick for trivial, cost-sensitive tasks. Search the full OpenRouter catalog, or type any model id. Leave either on <em>Automatic</em> to let the router decide.</p>' +
    keyNote +
    prefTierRow('strong', 'Complex work', 'Used for deep reasoning, multi-file refactors and long-context tasks.', pref.strong) +
    prefTierRow('cheap', 'Trivial work', 'Used for quick edits, docs and other low-effort, cost-sensitive tasks.', pref.cheap);
  main.querySelectorAll('[data-combo]').forEach(wireCombo);
  loadOpenRouterCatalog();
}

async function loadOpenRouterCatalog() {
  if (orCatalog || orCatalogLoading) return;
  orCatalogLoading = true;
  try {
    orCatalog = await api('/api/openrouter-models');
  } catch (e) {
    orCatalog = { models: [], error: e.message };
  } finally {
    orCatalogLoading = false;
    // Refresh any open menu now that data is available.
    document.querySelectorAll('[data-combo]').forEach((c) => {
      const menu = $('.combo-menu', c);
      if (menu && !menu.classList.contains('hidden')) renderComboMenu(c);
    });
  }
}

function wireCombo(combo) {
  const tier = combo.dataset.combo;
  const input = $('.combo-input', combo);
  let activeIdx = -1;

  const open = () => { renderComboMenu(combo); $('.combo-menu', combo).classList.remove('hidden'); };
  const close = () => { $('.combo-menu', combo).classList.add('hidden'); activeIdx = -1; };
  combo._close = close;

  input.addEventListener('focus', () => { input.select(); open(); });
  input.addEventListener('click', () => open());
  input.addEventListener('input', () => { activeIdx = -1; open(); });
  input.addEventListener('keydown', (e) => {
    const menu = $('.combo-menu', combo);
    const items = Array.from(menu.querySelectorAll('.combo-item'));
    if (e.key === 'ArrowDown') { e.preventDefault(); if (menu.classList.contains('hidden')) return open(); activeIdx = Math.min(activeIdx + 1, items.length - 1); paintActive(items, activeIdx); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); paintActive(items, activeIdx); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && items[activeIdx]) {
        const val = items[activeIdx].dataset.val;
        commitCombo(tier, val ? { provider: 'openrouter_agent', model: val } : null);
        return;
      }
      const v = input.value.trim();
      commitCombo(tier, v ? { provider: 'openrouter_agent', model: v } : null);
    }
    else if (e.key === 'Escape') { close(); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(() => {
    if (!combo.matches(':focus-within')) close();
  }, 120));
}

function paintActive(items, idx) {
  items.forEach((it, i) => it.classList.toggle('active', i === idx));
  if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
}

function renderComboMenu(combo) {
  const tier = combo.dataset.combo;
  const input = $('.combo-input', combo);
  const menu = $('.combo-menu', combo);
  const q = input.value.trim().toLowerCase();
  const current = (settings.preferredModels || {})[tier];
  const curModel = current && current.model ? current.model : '';

  let html = '<div class="combo-item auto' + (curModel === '' ? ' selected' : '') +
    '" data-val=""><div class="ci-main"><span class="ci-id">Automatic — let the router decide</span></div></div>';

  if (orCatalogLoading && !orCatalog) {
    html += '<div class="combo-note">Loading the OpenRouter catalog…</div>';
  } else if (orCatalog && orCatalog.error && !orCatalog.models.length) {
    html += '<div class="combo-note">Couldn\\'t reach the OpenRouter catalog. You can still type any model id and press Enter.</div>';
  } else if (orCatalog) {
    const all = orCatalog.models;
    const matches = q
      ? all.filter((m) => (m.id + ' ' + m.label).toLowerCase().includes(q))
      : all;
    const shown = matches.slice(0, 60);
    for (const m of shown) {
      const sel = m.id === curModel ? ' selected' : '';
      const qual = m.tier
        ? '<span class="combo-cap q-' + esc(m.tier) + '">' + esc(m.tier) + ' ' + Math.round(m.coding || 0) + '</span>'
        : '';
      const caps = qual +
        (m.tools ? '<span class="combo-cap tools">tools</span>' : '') +
        (m.vision ? '<span class="combo-cap vision">vision</span>' : '');
      html += '<div class="combo-item' + sel + '" data-val="' + esc(m.id) + '">' +
        '<div class="ci-main"><span class="ci-id">' + esc(m.id) + '</span>' + caps + '</div>' +
        '<span class="ci-meta">' + esc(priceHint(m)) + '</span></div>';
    }
    const exact = all.some((m) => m.id === q || m.id.toLowerCase() === q);
    if (q && !exact) {
      html += '<div class="combo-item custom" data-val="' + esc(input.value.trim()) + '">' +
        '<div class="ci-main"><span class="ci-id">Use "' + esc(input.value.trim()) + '"</span></div>' +
        '<span class="ci-meta">custom id</span></div>';
    }
    if (!shown.length && !q) html += '<div class="combo-note">No models in the catalog.</div>';
    else if (matches.length > shown.length) html += '<div class="combo-foot">' + (matches.length - shown.length) + ' more — keep typing to narrow down</div>';
  }

  menu.innerHTML = html;
  menu.querySelectorAll('.combo-item').forEach((it) => it.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const val = it.dataset.val;
    commitCombo(tier, val ? { provider: 'openrouter_agent', model: val } : null);
  }));
}

function commitCombo(tier, model) {
  const combo = document.querySelector('[data-combo="' + tier + '"]');
  if (combo && combo._close) combo._close();
  savePreferredModel(tier, model);
}

async function savePreferredModel(tier, model) {
  try {
    const body = model ? { tier, provider: model.provider, model: model.model } : { tier };
    await api('/api/settings/preferred-model', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    toast(model ? ('Preferred ' + tier + ' model: ' + model.model) : ('Cleared preferred ' + tier + ' model'));
    await loadSettings(); renderModels();
  } catch (e) { toast('Failed: ' + e.message); }
}

// --- Customize: rules / skills / subagents ---------------------------

async function loadAssets() { assets = await api('/api/assets'); }

function scopePill(scope) {
  return '<span class="scope-pill ' + esc(scope) + '">' + esc(scope) + '</span>';
}

function assetListEmpty(kind) {
  const what = kind === 'rules' ? 'rules' : kind === 'skills' ? 'skills' : 'subagents';
  return '<div class="empty">No ' + what + ' yet. Click <strong>New</strong> to create one.</div>';
}

function ruleItem(r) {
  const flags =
    (r.alwaysApply ? '<span class="chip on">always apply</span>' : '') +
    (r.globs && r.globs.length ? r.globs.map((g) => '<span class="chip">' + esc(g) + '</span>').join('') : '');
  return '<div class="setting-row"><div class="meta" style="min-width:0">' +
    '<div class="title">' + esc(r.description || r.id) + scopePill(r.scope) + '</div>' +
    '<div class="key">' + esc(r.path) + '</div>' +
    '<div>' + (flags || '<span class="chip">manual</span>') + '</div>' +
    (r.body ? '<div class="asset-body">' + esc(r.body) + '</div>' : '') +
    '</div><div class="row-actions">' +
    '<button class="btn" data-edit-rule="' + esc(r.scope) + ':' + esc(r.id) + '">Edit</button>' +
    '<button class="btn danger" data-del-rule="' + esc(r.scope) + ':' + esc(r.id) + '">Delete</button>' +
    '</div></div>';
}

function skillItem(s) {
  return '<div class="setting-row"><div class="meta" style="min-width:0">' +
    '<div class="title">' + esc(s.name) + scopePill(s.scope) + '</div>' +
    '<div class="desc">' + esc(s.description || '(no description)') + '</div>' +
    '<div class="key">' + esc(s.path) + '</div>' +
    (s.body ? '<div class="asset-body">' + esc(s.body) + '</div>' : '') +
    '</div><div class="row-actions">' +
    '<button class="btn" data-edit-skill="' + esc(s.scope) + ':' + esc(s.slug) + '">Edit</button>' +
    '<button class="btn danger" data-del-skill="' + esc(s.scope) + ':' + esc(s.slug) + '">Delete</button>' +
    '</div></div>';
}

function subagentItem(s) {
  const chips =
    (s.kind ? '<span class="chip">' + esc(s.kind) + '</span>' : '') +
    (s.model ? '<span class="chip">' + esc((s.provider ? s.provider + ':' : '') + s.model) + '</span>' : '') +
    (s.effort ? '<span class="chip">' + esc(s.effort) + '</span>' : '');
  return '<div class="setting-row"><div class="meta" style="min-width:0">' +
    '<div class="title">' + esc(s.name) + scopePill(s.scope) + '</div>' +
    '<div class="desc">' + esc(s.description || '(no description)') + '</div>' +
    '<div>' + (chips || '<span class="chip">kind-routed</span>') + '</div>' +
    (s.body ? '<div class="asset-body">' + esc(s.body) + '</div>' : '') +
    '</div><div class="row-actions">' +
    '<button class="btn" data-edit-sub="' + esc(s.scope) + ':' + esc(s.slug) + '">Edit</button>' +
    '<button class="btn danger" data-del-sub="' + esc(s.scope) + ':' + esc(s.slug) + '">Delete</button>' +
    '</div></div>';
}

function scopeSelect(val) {
  return '<select class="select" data-f="scope">' +
    '<option value="project"' + (val === 'global' ? '' : ' selected') + '>Project — .coderouter/ in this repo</option>' +
    '<option value="global"' + (val === 'global' ? ' selected' : '') + '>Global — ~/.coderouter/ (all projects)</option>' +
    '</select>';
}

function ruleEditor(item) {
  const r = item || { scope: 'project', id: '', description: '', globs: [], alwaysApply: false, body: '' };
  const editing = !!item;
  return '<div class="editor"><h3>' + (editing ? 'Edit rule' : 'New rule') + '</h3>' +
    '<div class="field-row">' +
      '<div class="field"><label>Scope</label>' + scopeSelect(r.scope) + '</div>' +
      '<div class="field"><label>Name / id</label><input class="input" data-f="id" ' +
        (editing ? 'readonly ' : '') + 'placeholder="e.g. typescript-style" value="' + esc(r.id) + '" /></div>' +
    '</div>' +
    '<div class="field"><label>Description</label><input class="input" data-f="description" placeholder="When/why this rule applies" value="' + esc(r.description) + '" /></div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Globs (comma-separated, optional)</label><input class="input" data-f="globs" placeholder="src/**/*.ts, *.tsx" value="' + esc((r.globs || []).join(', ')) + '" /></div>' +
      '<div class="field" style="flex:0 0 auto;justify-content:flex-end"><label class="check"><input type="checkbox" data-f="alwaysApply"' + (r.alwaysApply ? ' checked' : '') + ' /> Always apply</label></div>' +
    '</div>' +
    '<div class="field"><label>Rule</label><textarea class="textarea" data-f="body" placeholder="Write the instruction the agent should follow…">' + esc(r.body) + '</textarea></div>' +
    '<div class="editor-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save-rule>Save rule</button></div>' +
    '</div>';
}

function skillEditor(item) {
  const s = item || { scope: 'project', name: '', description: '', body: '', slug: '' };
  const editing = !!item;
  return '<div class="editor"><h3>' + (editing ? 'Edit skill' : 'New skill') + '</h3>' +
    '<div class="field-row">' +
      '<div class="field"><label>Scope</label>' + scopeSelect(s.scope) + '</div>' +
      '<div class="field"><label>Name</label><input class="input" data-f="name" placeholder="e.g. Database migrations" value="' + esc(s.name) + '" /></div>' +
    '</div>' +
    '<div class="field"><label>Description</label><input class="input" data-f="description" placeholder="When the agent should reach for this skill" value="' + esc(s.description) + '" /></div>' +
    '<div class="field"><label>Skill instructions (SKILL.md body)</label><textarea class="textarea" data-f="body" placeholder="Steps / domain knowledge the agent follows when this skill applies…">' + esc(s.body) + '</textarea></div>' +
    (editing ? '<input type="hidden" data-f="slug" value="' + esc(s.slug) + '" />' : '') +
    '<div class="editor-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save-skill>Save skill</button></div>' +
    '</div>';
}

function subagentEditor(item) {
  const s = item || { scope: 'project', name: '', description: '', kind: '', provider: '', model: '', effort: '', body: '', slug: '' };
  const editing = !!item;
  const kindOpts = '<option value="">(route by kind automatically)</option>' +
    SUBTASK_KINDS.map((k) => '<option value="' + k + '"' + (s.kind === k ? ' selected' : '') + '>' + k + '</option>').join('');
  const effortOpts = '<option value="">(default for kind)</option>' +
    ['low', 'medium', 'high', 'max'].map((e) => '<option value="' + e + '"' + (s.effort === e ? ' selected' : '') + '>' + e + '</option>').join('');
  return '<div class="editor"><h3>' + (editing ? 'Edit subagent' : 'New subagent') + '</h3>' +
    '<div class="field-row">' +
      '<div class="field"><label>Scope</label>' + scopeSelect(s.scope) + '</div>' +
      '<div class="field"><label>Name</label><input class="input" data-f="name" placeholder="e.g. Test Author" value="' + esc(s.name) + '" /></div>' +
    '</div>' +
    '<div class="field"><label>Description</label><input class="input" data-f="description" placeholder="What this specialist is good at (shown to the planner)" value="' + esc(s.description) + '" /></div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Specializes in (kind)</label><select class="select" data-f="kind">' + kindOpts + '</select></div>' +
      '<div class="field"><label>Effort</label><select class="select" data-f="effort">' + effortOpts + '</select></div>' +
    '</div>' +
    '<div class="field-row">' +
      '<div class="field"><label>Pinned provider (optional)</label><input class="input" data-f="provider" placeholder="e.g. openrouter_agent" value="' + esc(s.provider || '') + '" /></div>' +
      '<div class="field"><label>Pinned model (optional)</label><input class="input" data-f="model" placeholder="e.g. anthropic/claude-opus-4-5" value="' + esc(s.model || '') + '" /></div>' +
    '</div>' +
    '<div class="field"><label>Instructions</label><textarea class="textarea" data-f="body" placeholder="System instructions injected when this subagent runs a sub-task…">' + esc(s.body) + '</textarea></div>' +
    (editing ? '<input type="hidden" data-f="slug" value="' + esc(s.slug) + '" />' : '') +
    '<div class="editor-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-save-sub>Save subagent</button></div>' +
    '</div>';
}

function renderAssets() {
  const main = $('#view');
  const a = assets || { rules: [], skills: [], subagents: [], roots: { project: '', global: '' } };
  const tabBtn = (id, label, n) => '<div class="tab ' + (assetTab === id ? 'active' : '') + '" data-atab="' + id + '">' + label + ' (' + n + ')</div>';

  let editorHtml = '';
  if (assetEditor) {
    if (assetEditor.kind === 'rule') editorHtml = ruleEditor(assetEditor.item);
    else if (assetEditor.kind === 'skill') editorHtml = skillEditor(assetEditor.item);
    else if (assetEditor.kind === 'subagent') editorHtml = subagentEditor(assetEditor.item);
  }

  let listHtml = '';
  let newKind = 'rule';
  if (assetTab === 'rules') {
    newKind = 'rule';
    listHtml = a.rules.length ? '<div class="panel">' + a.rules.map(ruleItem).join('') + '</div>' : assetListEmpty('rules');
  } else if (assetTab === 'skills') {
    newKind = 'skill';
    listHtml = a.skills.length ? '<div class="panel">' + a.skills.map(skillItem).join('') + '</div>' : assetListEmpty('skills');
  } else {
    newKind = 'subagent';
    listHtml = a.subagents.length ? '<div class="panel">' + a.subagents.map(subagentItem).join('') + '</div>' : assetListEmpty('subagents');
  }

  const intros = {
    rules: 'Rules are persistent instructions injected into the agent\\'s system prompt. <strong>Always apply</strong> rules ride along on every run; rules with <strong>globs</strong> are surfaced as conditional and applied when matching files are touched.',
    skills: 'Skills are capability docs (SKILL.md). The agent sees each skill\\'s name + description and reads the file on demand when a task matches.',
    subagents: 'Subagents are typed execution presets the <span class="mono">orchestrate</span> mode routes sub-tasks to — optionally pinning a model/effort and always injecting their instructions. Match a sub-task <strong>kind</strong> or let the planner pick by name.',
  };

  main.innerHTML =
    '<div class="page-head"><h1>Rules &amp; Skills</h1>' +
      '<div class="tabs">' + tabBtn('rules', 'Rules', a.rules.length) + tabBtn('skills', 'Skills', a.skills.length) + tabBtn('subagents', 'Subagents', a.subagents.length) + '</div>' +
    '</div>' +
    '<p class="intro">' + intros[assetTab] + '</p>' +
    '<div class="section"><div class="page-head" style="margin-bottom:14px"><div class="section-title" style="margin:0">' +
      (assetTab === 'rules' ? 'Rules' : assetTab === 'skills' ? 'Skills' : 'Subagents') + '</div>' +
      '<button class="btn primary" data-new="' + newKind + '">New ' + newKind + '</button></div>' +
      editorHtml +
      listHtml +
    '</div>';

  // Tabs
  main.querySelectorAll('[data-atab]').forEach((t) => t.addEventListener('click', () => {
    assetTab = t.dataset.atab; assetEditor = null; renderAssets();
  }));
  // New / cancel
  const newBtn = main.querySelector('[data-new]');
  if (newBtn) newBtn.addEventListener('click', () => { assetEditor = { kind: newBtn.dataset.new, item: null }; renderAssets(); });
  const cancelBtn = main.querySelector('[data-cancel]');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { assetEditor = null; renderAssets(); });
  // Save handlers
  const sr = main.querySelector('[data-save-rule]'); if (sr) sr.addEventListener('click', () => saveRule(main));
  const ss = main.querySelector('[data-save-skill]'); if (ss) ss.addEventListener('click', () => saveSkill(main));
  const sa = main.querySelector('[data-save-sub]'); if (sa) sa.addEventListener('click', () => saveSubagent(main));
  // Edit handlers
  main.querySelectorAll('[data-edit-rule]').forEach((b) => b.addEventListener('click', () => openEdit('rule', b.dataset.editRule)));
  main.querySelectorAll('[data-edit-skill]').forEach((b) => b.addEventListener('click', () => openEdit('skill', b.dataset.editSkill)));
  main.querySelectorAll('[data-edit-sub]').forEach((b) => b.addEventListener('click', () => openEdit('subagent', b.dataset.editSub)));
  // Delete handlers
  main.querySelectorAll('[data-del-rule]').forEach((b) => b.addEventListener('click', () => delAsset('rule', b.dataset.delRule)));
  main.querySelectorAll('[data-del-skill]').forEach((b) => b.addEventListener('click', () => delAsset('skill', b.dataset.delSkill)));
  main.querySelectorAll('[data-del-sub]').forEach((b) => b.addEventListener('click', () => delAsset('subagent', b.dataset.delSub)));
}

function findAsset(list, scope, key, keyField) {
  return (list || []).find((x) => x.scope === scope && x[keyField] === key) || null;
}

function openEdit(kind, ref) {
  const [scope, key] = ref.split(/:(.+)/);
  if (kind === 'rule') assetEditor = { kind, item: findAsset(assets.rules, scope, key, 'id') };
  else if (kind === 'skill') assetEditor = { kind, item: findAsset(assets.skills, scope, key, 'slug') };
  else assetEditor = { kind, item: findAsset(assets.subagents, scope, key, 'slug') };
  renderAssets();
}

function fieldVal(root, name) {
  const node = root.querySelector('[data-f="' + name + '"]');
  if (!node) return '';
  if (node.type === 'checkbox') return node.checked;
  return node.value.trim();
}

async function saveRule(root) {
  const body = {
    scope: fieldVal(root, 'scope'),
    id: fieldVal(root, 'id'),
    description: fieldVal(root, 'description'),
    globs: fieldVal(root, 'globs'),
    alwaysApply: fieldVal(root, 'alwaysApply'),
    body: root.querySelector('[data-f="body"]').value,
  };
  if (!body.id && !body.description) { toast('Give the rule a name'); return; }
  if (!body.body.trim()) { toast('Rule body is empty'); return; }
  try {
    await api('/api/assets/rule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    toast('Saved rule'); assetEditor = null; await loadAssets(); renderAssets();
  } catch (e) { toast('Failed: ' + e.message); }
}

async function saveSkill(root) {
  const body = {
    scope: fieldVal(root, 'scope'),
    name: fieldVal(root, 'name'),
    slug: fieldVal(root, 'slug'),
    description: fieldVal(root, 'description'),
    body: root.querySelector('[data-f="body"]').value,
  };
  if (!body.name) { toast('Give the skill a name'); return; }
  if (!body.body.trim()) { toast('Skill body is empty'); return; }
  try {
    await api('/api/assets/skill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    toast('Saved skill'); assetEditor = null; await loadAssets(); renderAssets();
  } catch (e) { toast('Failed: ' + e.message); }
}

async function saveSubagent(root) {
  const body = {
    scope: fieldVal(root, 'scope'),
    name: fieldVal(root, 'name'),
    slug: fieldVal(root, 'slug'),
    description: fieldVal(root, 'description'),
    kind: fieldVal(root, 'kind'),
    provider: fieldVal(root, 'provider'),
    model: fieldVal(root, 'model'),
    effort: fieldVal(root, 'effort'),
    body: root.querySelector('[data-f="body"]').value,
  };
  if (!body.name) { toast('Give the subagent a name'); return; }
  if (!body.body.trim()) { toast('Subagent instructions are empty'); return; }
  try {
    await api('/api/assets/subagent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    toast('Saved subagent'); assetEditor = null; await loadAssets(); renderAssets();
  } catch (e) { toast('Failed: ' + e.message); }
}

async function delAsset(kind, ref) {
  const [scope, key] = ref.split(/:(.+)/);
  if (!confirm('Delete this ' + kind + '? This removes the file on disk.')) return;
  const path = '/api/assets/' + kind;
  const body = kind === 'rule' ? { scope, id: key } : { scope, slug: key };
  try {
    await api(path, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    toast('Deleted ' + kind); assetEditor = null; await loadAssets(); renderAssets();
  } catch (e) { toast('Failed: ' + e.message); }
}

// --- Plugins / Marketplace -------------------------------------------
// Plugins come from Claude Code marketplaces (default: anthropics'
// official + community). Installing one resolves the plugin's agents +
// skills and writes them into .coderouter/ via the customize layer.

async function loadPlugins() { pluginsData = await api('/api/plugins'); }

function allPlugins() {
  if (!pluginsData) return [];
  return (pluginsData.catalog || []).concat(pluginsData.orphans || []);
}

function pluginMatches(p, q) {
  if (!q) return true;
  const hay = (p.name + ' ' + p.description + ' ' + (p.category || '') + ' ' + (p.tags || []).join(' ') + ' ' + (p.author || '')).toLowerCase();
  return q.toLowerCase().split(/\\s+/).filter(Boolean).every((t) => hay.includes(t));
}

function isInstalled(p) { return pluginScope === 'global' ? p.installedGlobal : p.installedProject; }

function pluginCard(p) {
  const installed = isInstalled(p);
  const tags = (p.tags || []).slice(0, 3).map((t) => '<span class="chip">' + esc(t) + '</span>').join('');
  return '<div class="plugin-card" data-plugin="' + esc(p.id) + '" data-mp="' + esc(p.marketplace || '') + '">' +
    '<div class="prow"><div class="pname">' + esc(p.name) +
      (installed ? '<span class="badge success">installed</span>' : '') + '</div></div>' +
    '<div class="pdesc">' + esc(p.description || '') + '</div>' +
    (tags ? '<div class="pmeta">' + tags + '</div>' : '') +
    '<div class="prow bottom"><span class="muted-sm">' + esc(p.category || p.marketplace || '') + '</span>' +
      '<button class="btn ' + (installed ? 'danger' : 'primary') + '" data-pinstall="' + esc(p.id) + '">' + (installed ? 'Uninstall' : 'Get') + '</button>' +
    '</div></div>';
}

function assetLine(a) {
  const name = a.type === 'rule' ? (a.description || a.id) : a.name;
  const sub = a.type === 'rule'
    ? ((a.globs && a.globs.length) ? a.globs.join(', ') : (a.alwaysApply ? 'always apply' : 'manual'))
    : a.type === 'subagent'
      ? [a.kind ? 'kind: ' + a.kind : '', a.effort, a.model].filter(Boolean).join(' · ')
      : (a.description || '');
  return '<div class="asset-line"><span class="asset-kind">' + esc(a.type) + '</span>' +
    '<div style="min-width:0;flex:1"><div class="title">' + esc(name) + '</div>' +
    (sub ? '<div class="key">' + esc(sub) + '</div>' : '') +
    (a.body ? '<div class="asset-body">' + esc(a.body) + '</div>' : '') +
    '</div></div>';
}

function skippedLabel(s) {
  if (!s) return '';
  const parts = [];
  if (s.mcpServers) parts.push(s.mcpServers + ' MCP server' + (s.mcpServers > 1 ? 's' : ''));
  if (s.commands) parts.push(s.commands + ' command' + (s.commands > 1 ? 's' : ''));
  if (s.hooks) parts.push('hooks');
  if (s.lspServers) parts.push('LSP server');
  return parts.join(' · ');
}

function pluginModalShell(p, inner) {
  return '<div class="modal-bg" data-modal-bg><div class="modal">' +
    '<div class="page-head" style="align-items:flex-start;margin-bottom:8px"><div style="min-width:0">' +
      '<h2>' + esc(p.name) + '</h2>' +
      '<div class="muted-sm">' + esc(p.marketplace || '') + (p.author ? ' · by ' + esc(p.author) : '') +
        (p.category ? ' · ' + esc(p.category) : '') + '</div></div>' +
      '<button class="btn" data-modal-close>✕</button></div>' +
    '<p class="intro" style="max-width:none">' + esc(p.description || '') + '</p>' +
    inner + '</div></div>';
}

function pluginModalBody(p) {
  const installedHere = isInstalled(p);
  const where = [];
  if (p.installedProject) where.push('project');
  if (p.installedGlobal) where.push('global');
  const prev = pluginPreview[p.id];

  let inside;
  if (!prev) {
    inside = '<div class="section-title" style="margin-top:16px">What\\'s inside</div><div class="empty" style="padding:18px">Loading plugin contents…</div>';
  } else if (prev.error) {
    inside = '<div class="empty" style="padding:18px">Couldn\\'t read plugin: ' + esc(prev.error) + '</div>';
  } else {
    const assets = prev.assets || [];
    const skipped = skippedLabel(prev.skipped);
    inside = '<div class="section-title" style="margin-top:16px">What\\'s inside (' + assets.length + ' importable)</div>' +
      (assets.length ? assets.map(assetLine).join('') : '<div class="empty" style="padding:18px">No agents or skills to import from this plugin.</div>') +
      (skipped ? '<p class="muted-sm" style="margin-top:12px">Also ships (not run by CodeRouter yet): ' + esc(skipped) + '.</p>' : '');
  }

  const canInstall = !prev || prev.error || (prev.assets && prev.assets.length);
  return pluginModalShell(p,
    (where.length ? '<p class="muted-sm">Installed in: <strong>' + where.join('</strong>, <strong>') + '</strong></p>' : '') +
    inside +
    '<div class="editor-actions" style="margin-top:20px">' +
      '<button class="btn" data-modal-close>Close</button>' +
      (canInstall ? '<button class="btn ' + (installedHere ? 'danger' : 'primary') + '" data-modal-install="' + esc(p.id) + '">' +
        (installedHere ? 'Uninstall from ' + pluginScope : 'Install to ' + pluginScope) + '</button>' : '') +
    '</div>');
}

function paintPluginGrid() {
  const wrap = $('#pgrid');
  if (!wrap) return;
  const list = allPlugins().filter((p) =>
    (!pluginCategory || p.category === pluginCategory) && pluginMatches(p, pluginQuery));
  wrap.innerHTML = '<div class="muted-sm" style="margin-bottom:10px">' + list.length + ' plugin' + (list.length === 1 ? '' : 's') + '</div>' +
    (list.length
      ? '<div class="plugin-grid">' + list.slice(0, 300).map(pluginCard).join('') + '</div>'
      : '<div class="empty">No plugins match your search.</div>');
  wrap.querySelectorAll('[data-plugin]').forEach((c) => c.addEventListener('click', (e) => {
    if (e.target.closest('[data-pinstall]')) return;
    openPluginDetail(c.dataset.plugin, c.dataset.mp);
  }));
  wrap.querySelectorAll('[data-pinstall]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); togglePlugin(b.dataset.pinstall);
  }));
}

function marketplacePanel() {
  const mps = (pluginsData && pluginsData.marketplaces) || [];
  const rows = mps.map((m) => {
    const err = m.error ? '<span class="chip danger-chip" title="' + esc(m.error) + '">error</span>' : '';
    const rm = m.source === 'user' ? '<button class="btn-x" data-rm-mp="' + esc(m.name) + '" title="Remove">✕</button>' : '';
    return '<div class="mp-row"><div style="min-width:0"><div class="mp-name">' + esc(m.name) + ' ' + err + '</div>' +
      '<div class="muted-sm">' + esc(m.repo) + ' · ' + m.count + '</div></div>' + rm + '</div>';
  }).join('');
  return '<div class="section-title" style="margin:0 0 8px">Marketplaces</div>' + rows +
    '<div class="mp-add"><input class="input" data-mp-repo placeholder="owner/repo" /><button class="btn" data-mp-add>Add</button></div>' +
    '<button class="btn" data-mp-refresh style="margin-top:6px;width:100%">Refresh</button>';
}

function renderPlugins() {
  const main = $('#view');
  const d = pluginsData || { catalog: [], orphans: [], categories: [], marketplaces: [] };
  const cats = ['All'].concat(d.categories || []);
  const catList = cats.map((c) => {
    const val = c === 'All' ? '' : c;
    return '<div class="cat-item ' + (pluginCategory === val ? 'active' : '') + '" data-cat="' + esc(val) + '">' + esc(c) + '</div>';
  }).join('');

  main.innerHTML =
    '<div class="page-head"><h1>Marketplace</h1>' +
      '<div class="tabs">' +
        '<div class="tab ' + (pluginScope === 'project' ? 'active' : '') + '" data-pscope="project">Project</div>' +
        '<div class="tab ' + (pluginScope === 'global' ? 'active' : '') + '" data-pscope="global">Global</div>' +
      '</div></div>' +
    '<p class="intro">Browse <strong>Claude Code plugins</strong>. Installing one imports its agents &amp; skills as real, editable files in your <span class="mono">.coderouter/</span> (subagents + skills) that take effect immediately. Target scope: <strong>' + esc(pluginScope) + '</strong>.</p>' +
    '<div class="plugin-toolbar">' +
      '<input class="input plugin-search" data-psearch placeholder="Search plugins by name, tag, or description…" value="' + esc(pluginQuery) + '" />' +
    '</div>' +
    '<div class="plugin-layout"><div class="cat-list">' +
        marketplacePanel() +
        '<div class="section-title" style="margin:18px 0 8px">Categories</div>' + catList +
      '</div><div id="pgrid"></div></div>' +
    (pluginDetail ? pluginModalBody(allPlugins().find((x) => x.id === pluginDetail) || { id: pluginDetail, name: pluginDetail }) : '');

  paintPluginGrid();

  main.querySelectorAll('[data-pscope]').forEach((t) => t.addEventListener('click', () => {
    pluginScope = t.dataset.pscope; renderPlugins();
  }));
  const search = main.querySelector('[data-psearch]');
  if (search) search.addEventListener('input', (e) => { pluginQuery = e.target.value; paintPluginGrid(); });
  main.querySelectorAll('[data-cat]').forEach((c) => c.addEventListener('click', () => {
    pluginCategory = c.dataset.cat; renderPlugins();
  }));
  // Marketplace management
  const addBtn = main.querySelector('[data-mp-add]');
  const repoInput = main.querySelector('[data-mp-repo]');
  if (addBtn && repoInput) {
    const add = () => addMarketplace(repoInput.value.trim());
    addBtn.addEventListener('click', add);
    repoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  }
  const refreshBtn = main.querySelector('[data-mp-refresh]');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshPlugins);
  main.querySelectorAll('[data-rm-mp]').forEach((b) => b.addEventListener('click', () => removeMarketplace(b.dataset.rmMp)));
  // Modal
  const bg = main.querySelector('[data-modal-bg]');
  if (bg) bg.addEventListener('click', (e) => { if (e.target === bg) { pluginDetail = null; renderPlugins(); } });
  main.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', () => { pluginDetail = null; renderPlugins(); }));
  const mi = main.querySelector('[data-modal-install]');
  if (mi) mi.addEventListener('click', () => togglePlugin(mi.dataset.modalInstall));
}

async function openPluginDetail(id, marketplace) {
  pluginDetail = id;
  renderPlugins();
  if (!pluginPreview[id]) {
    try {
      pluginPreview[id] = await api('/api/plugins/preview?id=' + encodeURIComponent(id) + (marketplace ? '&marketplace=' + encodeURIComponent(marketplace) : ''));
    } catch (e) { pluginPreview[id] = { error: e.message }; }
    if (pluginDetail === id) renderPlugins();
  }
}

async function togglePlugin(id) {
  const p = allPlugins().find((x) => x.id === id);
  if (!p || pluginBusy) return;
  const installed = isInstalled(p);
  pluginBusy = true;
  try {
    const route = installed ? '/api/plugins/uninstall' : '/api/plugins/install';
    const r = await api(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, marketplace: p.marketplace, scope: pluginScope }) });
    if (!installed && r && r.skipped && skippedLabel(r.skipped)) toast('Installed ' + p.name + ' → ' + pluginScope + ' (skipped: ' + skippedLabel(r.skipped) + ')');
    else toast((installed ? 'Uninstalled ' : 'Installed ') + p.name + (installed ? '' : ' → ' + pluginScope));
    await loadPlugins(); renderPlugins();
  } catch (e) { toast('Failed: ' + e.message); }
  finally { pluginBusy = false; }
}

async function refreshPlugins() {
  if (pluginBusy) return;
  pluginBusy = true;
  toast('Refreshing marketplaces…');
  try {
    pluginsData = await api('/api/plugins/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    pluginPreview = {};
    toast('Marketplaces refreshed');
    renderPlugins();
  } catch (e) { toast('Failed: ' + e.message); }
  finally { pluginBusy = false; }
}

async function addMarketplace(repo) {
  if (!repo) { toast('Enter owner/repo'); return; }
  if (pluginBusy) return;
  pluginBusy = true;
  toast('Adding ' + repo + '…');
  try {
    await api('/api/plugins/marketplace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo }) });
    await loadPlugins(); toast('Added marketplace'); renderPlugins();
  } catch (e) { toast('Failed: ' + e.message); }
  finally { pluginBusy = false; }
}

async function removeMarketplace(name) {
  if (pluginBusy) return;
  if (!confirm('Remove marketplace ' + name + '?')) return;
  pluginBusy = true;
  try {
    await api('/api/plugins/marketplace', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    await loadPlugins(); toast('Removed ' + name); renderPlugins();
  } catch (e) { toast('Failed: ' + e.message); }
  finally { pluginBusy = false; }
}

async function loadUsage() { usage = await api('/api/usage'); }
async function loadSettings() { settings = await api('/api/settings'); }

function setView(name) {
  current = name;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
  if (name === 'overview') renderOverview();
  else if (name === 'usage') renderUsage();
  else if (name === 'spending') renderSpending();
  else if (name === 'models') renderModels();
  else if (name === 'customize') renderCustomize();
  else if (name === 'plugins') renderPluginsView();
  else if (name === 'settings') renderSettings();
}

async function renderPluginsView() {
  if (!pluginsData) {
    $('#view').innerHTML = '<div class="page-head"><h1>Marketplace</h1></div><div class="empty">Loading…</div>';
    try { await loadPlugins(); } catch (e) { $('#view').innerHTML = '<div class="empty">Failed to load: ' + esc(e.message) + '</div>'; return; }
  }
  if (current === 'plugins') renderPlugins();
}

async function renderCustomize() {
  if (!assets) {
    $('#view').innerHTML = '<div class="page-head"><h1>Rules &amp; Skills</h1></div><div class="empty">Loading…</div>';
    try { await loadAssets(); } catch (e) { $('#view').innerHTML = '<div class="empty">Failed to load: ' + esc(e.message) + '</div>'; return; }
  }
  if (current === 'customize') renderAssets();
}

async function boot() {
  initHeatmapTooltip();
  document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => setView(n.dataset.view)));
  try {
    await Promise.all([loadUsage(), loadSettings()]);
    setView('overview');
  } catch (e) {
    $('#view').innerHTML = '<div class="empty">Failed to load: ' + esc(e.message) + '</div>';
  }
}
boot();
`;

export const INDEX_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CodeRouter</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand"><span class="glyph">◢◤</span><span class="name">CodeRouter</span><span class="ver">dashboard</span></div>
      <div class="nav-item active" data-view="overview"><span class="dot"></span>Overview</div>
      <div class="nav-item" data-view="usage"><span class="dot"></span>Usage</div>
      <div class="nav-item" data-view="spending"><span class="dot"></span>Spending</div>
      <div class="nav-item" data-view="models"><span class="dot"></span>Models</div>
      <div class="nav-item" data-view="customize"><span class="dot"></span>Rules &amp; Skills</div>
      <div class="nav-item" data-view="plugins"><span class="dot"></span>Marketplace</div>
      <div class="nav-item" data-view="settings"><span class="dot"></span>Settings</div>
      <div class="spacer"></div>
      <div class="footer">Local · 127.0.0.1<br/>route smarter. build faster.</div>
    </aside>
    <main class="main"><div id="view"></div></main>
  </div>
  <script>${APP_JS}</script>
</body>
</html>`;
