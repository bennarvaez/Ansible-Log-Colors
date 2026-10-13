// Pure parser: turns Ansible output (ansible-playbook / AWX job stdout) into colored spans.
// No vscode imports here so it can be unit tested with plain node.

export type Style =
  | 'ok' | 'changed' | 'skipped' | 'failed' | 'unreachable' | 'included' | 'ignored'
  | 'warning' | 'deprecation' | 'verbose' | 'debug'
  | 'header' | 'headerStars'
  | 'diffAdd' | 'diffRemove' | 'diffLines'
  | 'escape'
  | `ansi:${string}`; // ansi:<fg or "-">:<b or ->  (used when the log still has escape codes)

export interface Span { line: number; start: number; end: number; style: Style }

const ESC_ANY = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function hasAnsi(text: string): boolean {
  return text.includes('\x1b[');
}

// ---------------------------------------------------------------- ANSI mode
// The log was saved with escape codes (e.g. AWX "ansi" download, `script`, or
// ANSIBLE_FORCE_COLOR=1 > file). Use the codes themselves: exactly what the CLI showed.

const SGR_FG: Record<number, string> = {
  30: 'black', 31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
  90: 'brightBlack', 91: 'brightRed', 92: 'brightGreen', 93: 'brightYellow',
  94: 'brightBlue', 95: 'brightMagenta', 96: 'brightCyan', 97: 'brightWhite',
};

export function parseAnsi(lines: string[]): Span[] {
  const spans: Span[] = [];
  let fg: string | undefined;
  let bold = false;
  lines.forEach((text, line) => {
    let pos = 0;
    const emit = (end: number) => {
      if (end > pos && (fg || bold)) spans.push({ line, start: pos, end, style: `ansi:${fg ?? '-'}:${bold ? 'b' : '-'}` });
    };
    for (const m of text.matchAll(ESC_ANY)) {
      const at = m.index!;
      emit(at);
      spans.push({ line, start: at, end: at + m[0].length, style: 'escape' });
      pos = at + m[0].length;
      if (!m[0].endsWith('m')) continue;
      const codes = m[0].slice(2, -1).split(';').filter(c => c !== '').map(Number);
      if (codes.length === 0) codes.push(0);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) { fg = undefined; bold = false; }
        else if (c === 1) bold = true;
        else if (c === 22) bold = false;
        else if (c === 39) fg = undefined;
        else if (SGR_FG[c]) {
          fg = SGR_FG[c];
          // Ansible writes "1;3Xm" for its "bright" colors.
          if (bold && c >= 30 && c <= 37) fg = 'bright' + fg[0].toUpperCase() + fg.slice(1);
        } else if (c === 38 || c === 48) i += codes[i + 1] === 5 ? 2 : 4; // skip 256/truecolor args
      }
    }
    emit(text.length);
  });
  return spans;
}

// ---------------------------------------------------------------- plain-text mode
// Codes were stripped (AWX "Download output" as .txt, `tee`, copy/paste). Re-derive the
// colors the default callback would have used, from its own rules.

const HEADER = /^(PLAY RECAP|PLAY|TASK|RUNNING HANDLER|HANDLER|NO MORE HOSTS LEFT|META)\b(.*?)(\s\*+)?\s*$/;
const STATUS = /^(ok|changed|skipping|fatal|failed|unreachable|included|ignored|rescued):\s*\[/;
const STATUS_INLINE = /\b(ok|changed|skipping|fatal|failed|included):\s*\[[^\]]*\](?::\s*(UNREACHABLE!|FAILED!))?/g;
const RECAP = /(\S+)\s*:\s*ok=(\d+)\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)(?:\s+skipped=(\d+))?(?:\s+rescued=(\d+))?(?:\s+ignored=(\d+))?/;
const RECAP_COUNTER = /(ok|changed|unreachable|failed|skipped|rescued|ignored)=(\d+)/g;

const RECAP_STYLE: Record<string, Style> = {
  ok: 'ok', changed: 'changed', unreachable: 'unreachable', failed: 'failed',
  skipped: 'skipped', rescued: 'ok', ignored: 'warning',
};

function statusStyle(keyword: string, rest: string): Style {
  if (/UNREACHABLE!/.test(rest) || keyword === 'unreachable') return 'unreachable';
  switch (keyword) {
    case 'ok': case 'rescued': return 'ok';
    case 'changed': return 'changed';
    case 'skipping': return 'skipped';
    case 'included': return 'included';
    case 'ignored': return 'skipped';
    default: return 'failed';
  }
}

export function parsePlain(lines: string[]): Span[] {
  const spans: Span[] = [];
  let block: Style | undefined; // color carried over continuation lines (JSON results, warnings)
  let diff = false;

  lines.forEach((text, line) => {
    const whole = (style: Style) => { if (text.length) spans.push({ line, start: 0, end: text.length, style }); };

    if (text.trim() === '') { block = undefined; diff = false; return; }

    const header = HEADER.exec(text);
    if (header && (header[3] || /^(PLAY|TASK|RUNNING HANDLER) \[/.test(text) || header[1] === 'PLAY RECAP')) {
      block = undefined; diff = false;
      const bracket = /^[^[]*\[[^\]]*\]/.exec(text);
      const starsAt = header[3] ? text.search(/\*+\s*$/) : bracket ? bracket[0].length : header[1].length;
      spans.push({ line, start: 0, end: starsAt, style: header[1] === 'NO MORE HOSTS LEFT' ? 'failed' : 'header' });
      if (header[3]) spans.push({ line, start: starsAt, end: text.length, style: 'headerStars' });
      // Condensed logs put the result on the header line: "TASK [x] ok: [host]"
      inlineStatuses(text, line, spans, starsAt);
      recap(text, line, spans);
      return;
    }

    const status = STATUS.exec(text);
    if (status) { block = statusStyle(status[1], text); diff = false; whole(block); return; }
    if (/^\.\.\.ignoring\s*$/.test(text)) { whole('skipped'); return; }
    if (/^\[(WARNING|DEPRECATION WARNING)\]/.test(text)) {
      block = text.startsWith('[WARNING]') ? 'warning' : 'deprecation'; whole(block); return;
    }
    if (/^(ERROR!|\[ERROR\]:)/.test(text)) { block = 'failed'; whole(block); return; }
    if (/^(---|\+\+\+) (before|after)/.test(text)) { diff = true; whole('diffLines'); return; }
    if (/^@@ .* @@/.test(text)) { diff = true; whole('diffLines'); return; }
    if (diff && text.startsWith('+')) { whole('diffAdd'); return; }
    if (diff && text.startsWith('-')) { whole('diffRemove'); return; }
    if (recap(text, line, spans)) return;
    if (block) { whole(block); return; }
    if (/^<[^>]+> /.test(text) || /^(Using module file|Pipelining is enabled|Loading callback plugin|META: )/.test(text)) {
      whole('verbose'); return;
    }
    inlineStatuses(text, line, spans, 0);
  });
  return spans;
}

function inlineStatuses(text: string, line: number, spans: Span[], from: number) {
  STATUS_INLINE.lastIndex = from;
  for (let m; (m = STATUS_INLINE.exec(text));) {
    spans.push({ line, start: m.index, end: m.index + m[0].length, style: statusStyle(m[1], m[2] ?? '') });
  }
}

function recap(text: string, line: number, spans: Span[]): boolean {
  const m = RECAP.exec(text);
  if (!m) return false;
  const n = (i: number) => Number(m[i] ?? 0);
  const host: Style = n(4) || n(5) ? 'failed' : n(3) ? 'changed' : 'ok';
  spans.push({ line, start: m.index, end: m.index + m[1].length, style: host });
  RECAP_COUNTER.lastIndex = m.index + m[1].length;
  for (let c; (c = RECAP_COUNTER.exec(text));) {
    if (Number(c[2]) > 0) spans.push({ line, start: c.index, end: c.index + c[0].length, style: RECAP_STYLE[c[1]] });
  }
  return true;
}

export function parse(lines: string[]): Span[] {
  return lines.some(hasAnsi) ? parseAnsi(lines) : parsePlain(lines);
}

// Lines worth putting in the outline and folding: PLAY / TASK / HANDLER / RECAP headers.
export interface Section { line: number; kind: 'play' | 'task' | 'recap'; name: string }

export function sections(lines: string[]): Section[] {
  const out: Section[] = [];
  lines.forEach((raw, line) => {
    const text = raw.replace(ESC_ANY, '');
    const m = /^(PLAY RECAP|PLAY|TASK|RUNNING HANDLER) ?(?:\[(.*?)\])?/.exec(text);
    if (!m || (m[1] !== 'PLAY RECAP' && m[2] === undefined)) return;
    const kind = m[1] === 'PLAY' ? 'play' : m[1] === 'PLAY RECAP' ? 'recap' : 'task';
    out.push({ line, kind, name: m[1] === 'PLAY RECAP' ? 'PLAY RECAP' : `${m[1]} [${m[2]}]` });
  });
  return out;
}

const DETECT = /^(\x1b\[[0-9;]*m)*(PLAY \[|TASK \[|PLAY RECAP|RUNNING HANDLER \[)/m;

export function looksLikeAnsibleOutput(head: string): boolean {
  return DETECT.test(head);
}
