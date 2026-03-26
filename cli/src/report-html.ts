import { resolve, basename } from "node:path";
import type {
    CliOptions,
    StructuralResult,
    IntegrationResult,
    ResponseLogResult,
} from "./types.js";

interface ReportData {
    meta: {
        date: string;
        target: string;
        mode: string;
        model: string;
        elapsed?: number;
    };
    structural: StructuralResult[];
    integration: IntegrationResult[];
    responseLog: ResponseLogResult[];
}

export function buildHtmlReport(
    opts: CliOptions,
    structResults: StructuralResult[],
    intResults: IntegrationResult[],
    rlResults: ResponseLogResult[] = [],
    elapsed?: number,
): string {
    const data: ReportData = {
        meta: {
            date: new Date().toISOString(),
            target: resolve(process.cwd(), opts.target),
            mode: opts.mode,
            model: opts.model,
            elapsed,
        },
        structural: structResults,
        integration: intResults,
        responseLog: rlResults,
    };

    const targetName = basename(resolve(process.cwd(), opts.target));
    const jsonData = JSON.stringify(data);

    // All data is self-generated from test results — not external user input.
    // The client-side JS uses esc() to HTML-encode all interpolated values.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>conform report — ${escapeHtml(targetName)}</title>
<style>
${CSS}
</style>
</head>
<body>
<div id="app"></div>
<script>
const DATA = ${jsonData};
${JS}
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ── Inline CSS ──────────────────────────────────────────────────────

const CSS = `
:root {
  --bg: #0d1117;
  --surface: #161b22;
  --border: #30363d;
  --text: #e6edf3;
  --text-dim: #8b949e;
  --green: #3fb950;
  --red: #f85149;
  --yellow: #d29922;
  --blue: #58a6ff;
  --purple: #bc8cff;
  --cyan: #39d2c0;
  --magenta: #f778ba;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
h2 { font-size: 1.1rem; color: var(--purple); margin: 1.5rem 0 0.75rem; }

.meta { color: var(--text-dim); font-size: 0.85rem; margin-bottom: 1.5rem; }
.meta span { margin-right: 1.5rem; }
.meta .mode { color: var(--cyan); }

/* Summary cards */
.summary-row {
  display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.5rem;
  min-width: 120px;
  text-align: center;
}
.card .value { font-size: 2rem; font-weight: bold; }
.card .label { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
.card.pass .value { color: var(--green); }
.card.fail .value { color: var(--red); }
.card.warn .value { color: var(--yellow); }
.card.total .value { color: var(--text); }
.card.rate .value { color: var(--blue); }

/* Progress bar */
.progress-bar {
  height: 8px; border-radius: 4px; background: var(--border);
  overflow: hidden; display: flex; margin-bottom: 1.5rem;
}
.progress-bar .seg-pass { background: var(--green); }
.progress-bar .seg-fail { background: var(--red); }
.progress-bar .seg-warn { background: var(--yellow); }
.progress-bar .seg-skip { background: var(--text-dim); }

/* Filter tabs */
.filters {
  display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;
}
.filter-btn {
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text-dim); padding: 0.35rem 0.75rem; cursor: pointer;
  font-size: 0.8rem; transition: all 0.15s;
}
.filter-btn:hover { border-color: var(--text-dim); }
.filter-btn.active { border-color: var(--purple); color: var(--text); background: #1c1e2a; }

/* Results table */
table {
  width: 100%; border-collapse: collapse;
  font-size: 0.85rem;
}
th {
  text-align: left; padding: 0.5rem 0.75rem;
  border-bottom: 2px solid var(--border);
  color: var(--text-dim); font-weight: 600;
  font-size: 0.75rem; text-transform: uppercase;
  letter-spacing: 0.05em;
}
td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
tr:hover td { background: rgba(255,255,255,0.02); }

.verdict-pass { color: var(--green); }
.verdict-fail, .verdict-error { color: var(--red); }
.verdict-warn { color: var(--yellow); }
.verdict-skip { color: var(--text-dim); }

.type-skill { color: var(--cyan); }
.type-command { color: var(--magenta); }
.type-agent { color: var(--purple); }
.type-hook { color: var(--yellow); }
.type-manifest { color: var(--text-dim); }

.detail { color: var(--text-dim); font-size: 0.8rem; }

/* Response log cards */
.rl-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 1rem;
  overflow: hidden;
}
.rl-card.fail { border-left: 3px solid var(--red); }
.rl-card.pass { border-left: 3px solid var(--green); }
.rl-card.warn { border-left: 3px solid var(--yellow); }
.rl-card.skip { border-left: 3px solid var(--text-dim); }

.rl-header {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  user-select: none;
}
.rl-header:hover { background: rgba(255,255,255,0.02); }
.rl-chevron {
  color: var(--text-dim); transition: transform 0.15s;
  font-size: 0.75rem;
}
.rl-card.expanded .rl-chevron { transform: rotate(90deg); }
.rl-id { font-weight: 600; }
.rl-plugin { color: var(--text-dim); font-size: 0.8rem; }
.rl-verdict { font-weight: 600; font-size: 0.8rem; }

.rl-body {
  display: none;
  padding: 0 1rem 1rem;
}
.rl-card.expanded .rl-body { display: block; }

.rl-section-label {
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-dim); margin: 0.75rem 0 0.35rem;
  font-weight: 600;
}

.rl-prompt, .rl-response {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem 1rem;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
  line-height: 1.6;
}

.rl-expectations {
  display: flex; gap: 0.5rem; flex-wrap: wrap;
  margin-top: 0.5rem;
}
.expect-chip {
  font-size: 0.75rem;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
}
.expect-chip.pass { border-color: var(--green); color: var(--green); }
.expect-chip.fail { border-color: var(--red); color: var(--red); }

.rl-detail-text {
  color: var(--text-dim); font-size: 0.8rem; margin-top: 0.5rem;
}

/* Empty state */
.empty {
  text-align: center; color: var(--text-dim); padding: 3rem;
  font-size: 0.9rem;
}
`;

// ── Inline JS ───────────────────────────────────────────────────────
// All values are HTML-escaped via esc() before insertion into the DOM.
// DATA is self-generated from test results, not external user input.

const JS = `
(function() {
  var app = document.getElementById('app');
  var d = DATA;
  var meta = d.meta;

  function countVerdicts(results) {
    var passed = 0, failed = 0, warned = 0, skipped = 0;
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (r.verdict === 'pass') passed++;
      else if (r.verdict === 'fail' || r.verdict === 'error') failed++;
      else if (r.verdict === 'warn') warned++;
      else if (r.verdict === 'skip') skipped++;
    }
    return { passed: passed, failed: failed, warned: warned, skipped: skipped, total: results.length };
  }

  function inferType(r) {
    if (r.component) return r.component;
    if (r.type === 'command') return 'command';
    if (r.type === 'hook') return 'hook';
    if (r.type === 'agent' || (r.name && r.name.startsWith('agent:'))) return 'agent';
    return 'skill';
  }

  function verdictClass(v) { return 'verdict-' + (v === 'error' ? 'fail' : v); }
  function verdictIcon(v) {
    var icons = { pass: '\\u2714', fail: '\\u2718', error: '\\u2718', warn: '!', skip: '\\u2298' };
    return icons[v] || '?';
  }

  function esc(s) {
    if (!s) return '';
    var el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }

  function formatElapsed(ms) {
    if (!ms) return '';
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    return m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's';
  }

  var allResults = d.structural.concat(d.integration).concat(d.responseLog);
  var counts = countVerdicts(allResults);
  var rate = counts.total > 0 ? ((counts.passed / counts.total) * 100).toFixed(1) : '0.0';

  // Build DOM safely
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'className') el.className = attrs[k];
        else if (k === 'onclick') el.onclick = attrs[k];
        else el.setAttribute(k, attrs[k]);
      }
    }
    if (typeof children === 'string') el.textContent = children;
    else if (Array.isArray(children)) children.forEach(function(c) { if (c) el.appendChild(c); });
    else if (children) el.appendChild(children);
    return el;
  }

  // We build the page by appending DOM elements.
  // For large sections we use a document fragment for performance.
  var frag = document.createDocumentFragment();

  // Header
  frag.appendChild(h('h1', null, '\\u25c6 conform report'));
  var metaDiv = h('div', { className: 'meta' });
  metaDiv.appendChild(h('span', { className: 'mode' }, meta.mode));
  metaDiv.appendChild(h('span', null, meta.target));
  metaDiv.appendChild(h('span', null, new Date(meta.date).toLocaleString()));
  if (meta.elapsed) metaDiv.appendChild(h('span', null, formatElapsed(meta.elapsed)));
  metaDiv.appendChild(h('span', null, 'model: ' + meta.model));
  frag.appendChild(metaDiv);

  // Summary cards
  var summaryRow = h('div', { className: 'summary-row' });
  function addCard(cls, value, label) {
    var card = h('div', { className: 'card ' + cls }, [
      h('div', { className: 'value' }, String(value)),
      h('div', { className: 'label' }, label)
    ]);
    summaryRow.appendChild(card);
  }
  addCard('total', counts.total, 'Total');
  addCard('pass', counts.passed, 'Passed');
  addCard('fail', counts.failed, 'Failed');
  addCard('warn', counts.warned, 'Warnings');
  addCard('rate', rate + '%', 'Pass Rate');
  frag.appendChild(summaryRow);

  // Progress bar
  if (counts.total > 0) {
    var bar = h('div', { className: 'progress-bar' });
    function pct(n) { return ((n / counts.total) * 100).toFixed(2) + '%'; }
    if (counts.passed) { var s = h('div', { className: 'seg-pass' }); s.style.width = pct(counts.passed); bar.appendChild(s); }
    if (counts.failed) { var s2 = h('div', { className: 'seg-fail' }); s2.style.width = pct(counts.failed); bar.appendChild(s2); }
    if (counts.warned) { var s3 = h('div', { className: 'seg-warn' }); s3.style.width = pct(counts.warned); bar.appendChild(s3); }
    if (counts.skipped) { var s4 = h('div', { className: 'seg-skip' }); s4.style.width = pct(counts.skipped); bar.appendChild(s4); }
    frag.appendChild(bar);
  }

  // Filter helper
  function makeFilters(sectionId, sectionCounts, totalCount) {
    var div = h('div', { className: 'filters', id: sectionId + '-filters' });
    function addBtn(filter, label, count) {
      var btn = h('button', { className: 'filter-btn' + (filter === 'all' ? ' active' : ''), 'data-filter': filter }, label + ' (' + count + ')');
      div.appendChild(btn);
    }
    addBtn('all', 'All', totalCount);
    if (sectionCounts.failed) addBtn('fail', 'Failed', sectionCounts.failed);
    if (sectionCounts.warned) addBtn('warn', 'Warned', sectionCounts.warned);
    if (sectionCounts.passed) addBtn('pass', 'Passed', sectionCounts.passed);
    if (sectionCounts.skipped) addBtn('skip', 'Skipped', sectionCounts.skipped);
    return div;
  }

  // Response-log view
  if (d.responseLog.length > 0) {
    frag.appendChild(h('h2', null, 'Response Log'));

    var rlCounts = countVerdicts(d.responseLog);
    var rlFilters = makeFilters('rl', rlCounts, d.responseLog.length);
    frag.appendChild(rlFilters);

    var cardsDiv = h('div', { id: 'rl-cards' });
    for (var i = 0; i < d.responseLog.length; i++) {
      var r = d.responseLog[i];
      var v = r.verdict === 'error' ? 'fail' : r.verdict;
      var type = inferType(r);
      var isFailure = r.verdict === 'fail' || r.verdict === 'error';

      var card = h('div', { className: 'rl-card ' + v + (isFailure ? ' expanded' : ''), 'data-verdict': r.verdict });

      // Header
      var header = h('div', { className: 'rl-header' });
      header.onclick = (function(c) { return function() { c.classList.toggle('expanded'); }; })(card);
      header.appendChild(h('span', { className: 'rl-chevron' }, '\\u25b6'));
      header.appendChild(h('span', { className: verdictClass(r.verdict) + ' rl-verdict' }, verdictIcon(r.verdict) + ' ' + r.verdict.toUpperCase()));
      header.appendChild(h('span', { className: 'type-' + type }, '[' + type + ']'));
      header.appendChild(h('span', { className: 'rl-id' }, r.name || r.id));
      header.appendChild(h('span', { className: 'rl-plugin' }, r.plugin));
      if (r.durationMs) header.appendChild(h('span', { className: 'rl-plugin' }, (r.durationMs / 1000).toFixed(1) + 's'));
      card.appendChild(header);

      // Body
      var body = h('div', { className: 'rl-body' });

      body.appendChild(h('div', { className: 'rl-section-label' }, 'Prompt'));
      body.appendChild(h('div', { className: 'rl-prompt' }, r.prompt));

      if (r.response) {
        body.appendChild(h('div', { className: 'rl-section-label' }, 'Response'));
        body.appendChild(h('div', { className: 'rl-response' }, r.response));
      }

      if (r.expectations && Object.keys(r.expectations).length > 0) {
        body.appendChild(h('div', { className: 'rl-section-label' }, 'Expectations'));
        var exDiv = h('div', { className: 'rl-expectations' });
        for (var key in r.expectations) {
          var exp = r.expectations[key];
          var p = exp.pass ? 'pass' : 'fail';
          var chipText = key;
          if (exp.expected) chipText += ': ' + JSON.stringify(exp.expected);
          if (exp.missing && exp.missing.length > 0) chipText += ' (missing: ' + exp.missing.join(', ') + ')';
          if (exp.found && exp.found.length > 0) chipText += ' (found: ' + exp.found.join(', ') + ')';
          exDiv.appendChild(h('span', { className: 'expect-chip ' + p }, chipText));
        }
        body.appendChild(exDiv);
      }

      if (r.verdictDetail) {
        body.appendChild(h('div', { className: 'rl-detail-text' }, r.verdictDetail));
      }

      card.appendChild(body);
      cardsDiv.appendChild(card);
    }
    frag.appendChild(cardsDiv);
  }

  // Structural results table
  if (d.structural.length > 0) {
    frag.appendChild(h('h2', null, 'Structural Tests'));

    var sc = countVerdicts(d.structural);
    frag.appendChild(makeFilters('struct', sc, d.structural.length));

    var table = h('table', { id: 'struct-table' });
    var thead = h('thead', null, h('tr', null, [
      h('th', null, '#'), h('th', null, 'Verdict'), h('th', null, 'Type'),
      h('th', null, 'Test'), h('th', null, 'Detail')
    ]));
    table.appendChild(thead);
    var tbody = h('tbody');
    for (var si = 0; si < d.structural.length; si++) {
      var sr = d.structural[si];
      var row = h('tr', { 'data-verdict': sr.verdict }, [
        h('td', null, String(sr.id)),
        h('td', { className: verdictClass(sr.verdict) }, verdictIcon(sr.verdict) + ' ' + sr.verdict),
        h('td', { className: 'type-' + sr.component }, sr.component || ''),
        h('td', null, sr.label),
        h('td', { className: 'detail' }, sr.detail || '')
      ]);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    frag.appendChild(table);
  }

  // Integration results table
  if (d.integration.length > 0) {
    frag.appendChild(h('h2', null, 'Integration Tests'));

    var ic = countVerdicts(d.integration);
    frag.appendChild(makeFilters('int', ic, d.integration.length));

    var itable = h('table', { id: 'int-table' });
    var ithead = h('thead', null, h('tr', null, [
      h('th', null, '#'), h('th', null, 'Verdict'), h('th', null, 'Type'),
      h('th', null, 'Test'), h('th', null, 'Trigger'), h('th', null, 'Detail')
    ]));
    itable.appendChild(ithead);
    var itbody = h('tbody');
    for (var ii = 0; ii < d.integration.length; ii++) {
      var ir = d.integration[ii];
      var itype = inferType(ir);
      var irow = h('tr', { 'data-verdict': ir.verdict }, [
        h('td', null, String(ii + 1)),
        h('td', { className: verdictClass(ir.verdict) }, verdictIcon(ir.verdict) + ' ' + ir.verdict),
        h('td', { className: 'type-' + itype }, itype),
        h('td', null, ir.testId),
        h('td', null, ir.trigger || ''),
        h('td', { className: 'detail' }, ir.detail || '')
      ]);
      itbody.appendChild(irow);
    }
    itable.appendChild(itbody);
    frag.appendChild(itable);
  }

  if (allResults.length === 0) {
    frag.appendChild(h('div', { className: 'empty' }, 'No test results to display.'));
  }

  app.appendChild(frag);

  // Filter interactivity
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.filter-btn');
    if (!btn) return;

    var filter = btn.getAttribute('data-filter');
    var container = btn.closest('.filters');
    container.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');

    var target = container.nextElementSibling;
    if (!target) return;

    if (target.tagName === 'TABLE') {
      target.querySelectorAll('tbody tr').forEach(function(row) {
        if (filter === 'all') { row.style.display = ''; }
        else {
          var rv = row.getAttribute('data-verdict');
          var match = filter === 'fail' ? (rv === 'fail' || rv === 'error') : rv === filter;
          row.style.display = match ? '' : 'none';
        }
      });
    }

    if (target.id === 'rl-cards') {
      target.querySelectorAll('.rl-card').forEach(function(card) {
        if (filter === 'all') { card.style.display = ''; }
        else {
          var rv = card.getAttribute('data-verdict');
          var match = filter === 'fail' ? (rv === 'fail' || rv === 'error') : rv === filter;
          card.style.display = match ? '' : 'none';
        }
      });
    }
  });
})();
`;
