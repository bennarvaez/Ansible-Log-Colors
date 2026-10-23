import * as vscode from 'vscode';
import { looksLikeAnsibleOutput, parse, sections, Span, Style, Status, LogStructure, structure } from './parse';
import { LogTree } from './tree';

const LANG = 'ansible-log';

// Plain-text styles map to this extension's theme colors (contributes.colors), which
// default to the terminal's ANSI palette, so they match what the CLI shows.
const PLAIN: Partial<Record<Style, vscode.DecorationRenderOptions>> = {
  ok: { color: new vscode.ThemeColor('ansibleLog.ok') },
  changed: { color: new vscode.ThemeColor('ansibleLog.changed') },
  skipped: { color: new vscode.ThemeColor('ansibleLog.skipped') },
  included: { color: new vscode.ThemeColor('ansibleLog.included') },
  failed: { color: new vscode.ThemeColor('ansibleLog.failed') },
  unreachable: { color: new vscode.ThemeColor('ansibleLog.unreachable') },
  warning: { color: new vscode.ThemeColor('ansibleLog.warning') },
  deprecation: { color: new vscode.ThemeColor('ansibleLog.deprecation') },
  verbose: { color: new vscode.ThemeColor('ansibleLog.verbose') },
  debug: { color: new vscode.ThemeColor('ansibleLog.debug') },
  header: { fontWeight: 'bold' },
  headerStars: { opacity: '0.45' },
  diffAdd: { color: new vscode.ThemeColor('ansibleLog.diffAdd') },
  diffRemove: { color: new vscode.ThemeColor('ansibleLog.diffRemove') },
  diffLines: { color: new vscode.ThemeColor('ansibleLog.diffLines') },
};

const ANSI_THEME: Record<string, string> = {
  black: 'terminal.ansiBlack', red: 'terminal.ansiRed', green: 'terminal.ansiGreen', yellow: 'terminal.ansiYellow',
  blue: 'terminal.ansiBlue', magenta: 'terminal.ansiMagenta', cyan: 'terminal.ansiCyan', white: 'terminal.ansiWhite',
  brightBlack: 'terminal.ansiBrightBlack', brightRed: 'terminal.ansiBrightRed', brightGreen: 'terminal.ansiBrightGreen',
  brightYellow: 'terminal.ansiBrightYellow', brightBlue: 'terminal.ansiBrightBlue', brightMagenta: 'terminal.ansiBrightMagenta',
  brightCyan: 'terminal.ansiBrightCyan', brightWhite: 'terminal.ansiBrightWhite',
};

const types = new Map<Style, vscode.TextEditorDecorationType>();

function typeFor(style: Style): vscode.TextEditorDecorationType | undefined {
  let t = types.get(style);
  if (t) return t;
  let opts: vscode.DecorationRenderOptions | undefined;
  if (style === 'escape') {
    opts = hideEscapes()
      // Collapse the raw "\x1b[0;32m" codes to zero width but keep them in the layout.
      // (display:none broke selection highlighting: VS Code measures selection rectangles
      // from the rendered text, and hidden nodes have no rectangles.)
      ? { opacity: '0', letterSpacing: '-1ch' }
      : { opacity: '0.35' };
  } else if (style.startsWith('ansi:')) {
    const [, fg, b] = style.split(':');
    opts = {};
    if (fg !== '-') opts.color = new vscode.ThemeColor(ANSI_THEME[fg]);
    if (b === 'b') opts.fontWeight = 'bold';
  } else {
    opts = PLAIN[style];
  }
  if (!opts) return undefined;
  t = vscode.window.createTextEditorDecorationType({ ...opts, rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed });
  types.set(style, t);
  return t;
}

function hideEscapes(): boolean {
  return vscode.workspace.getConfiguration('ansibleLog').get('hideEscapeCodes', true);
}

function resetTypes() {
  for (const t of types.values()) t.dispose();
  types.clear();
}

function linesOf(doc: vscode.TextDocument): string[] {
  return doc.getText().split(/\r?\n/);
}

const structCache = new WeakMap<vscode.TextDocument, { version: number; s: LogStructure }>();

export function structureOf(doc: vscode.TextDocument): LogStructure {
  const hit = structCache.get(doc);
  if (hit && hit.version === doc.version) return hit.s;
  const s = structure(linesOf(doc));
  structCache.set(doc, { version: doc.version, s });
  return s;
}

const STATUS_STYLE: Partial<Record<Status, Style>> = {
  ok: 'ok', changed: 'changed', skipped: 'skipped', included: 'included',
  ignored: 'warning', failed: 'failed', unreachable: 'unreachable',
};

// Color each PLAY / TASK header by the worst result under it, so a folded log still
// shows what passed and what failed.
function headerSpans(doc: vscode.TextDocument): Span[] {
  if (!vscode.workspace.getConfiguration('ansibleLog').get('colorHeadersByResult', true)) return [];
  const out: Span[] = [];
  const push = (line: number, status: Status) => {
    const style = STATUS_STYLE[status];
    if (!style) return;
    const text = doc.lineAt(line).text;
    const end = text.search(/\s\*+\s*$/);
    out.push({ line, start: 0, end: end > 0 ? end : text.length, style });
  };
  for (const p of structureOf(doc).plays) {
    if (p.name) push(p.line, p.status);
    for (const t of p.tasks) push(t.line, t.status);
  }
  return out;
}

function decorate(editor: vscode.TextEditor) {
  const doc = editor.document;
  const byStyle = new Map<Style, vscode.Range[]>();
  if (doc.languageId === LANG) {
    for (const s of [...parse(linesOf(doc)), ...headerSpans(doc)] as Span[]) {
      let list = byStyle.get(s.style);
      if (!list) byStyle.set(s.style, (list = []));
      list.push(new vscode.Range(s.line, s.start, s.line, s.end));
    }
  }
  // Clear styles not used this time, set the rest.
  for (const [style, t] of types) if (!byStyle.has(style)) editor.setDecorations(t, []);
  for (const [style, ranges] of byStyle) {
    const t = typeFor(style);
    if (t) editor.setDecorations(t, ranges);
  }
}

function decorateDoc(doc: vscode.TextDocument) {
  for (const e of vscode.window.visibleTextEditors) if (e.document === doc) decorate(e);
}

async function maybeDetect(doc: vscode.TextDocument) {
  if (doc.languageId === LANG) return;
  const cfg = vscode.workspace.getConfiguration('ansibleLog');
  if (!cfg.get('autoDetect', true)) return;
  if (!cfg.get<string[]>('autoDetectLanguages', ['log', 'plaintext']).includes(doc.languageId)) return;
  const head = doc.getText(new vscode.Range(0, 0, Math.min(doc.lineCount, 200), 0));
  if (looksLikeAnsibleOutput(head)) await vscode.languages.setTextDocumentLanguage(doc, LANG);
}

export function activate(context: vscode.ExtensionContext) {
  const timers = new Map<vscode.TextDocument, NodeJS.Timeout>();
  const later = (doc: vscode.TextDocument) => {
    clearTimeout(timers.get(doc));
    timers.set(doc, setTimeout(() => { timers.delete(doc); decorateDoc(doc); }, 150));
  };

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(eds => eds.forEach(decorate)),
    vscode.workspace.onDidOpenTextDocument(async doc => { await maybeDetect(doc); later(doc); }),
    vscode.workspace.onDidChangeTextDocument(e => { if (e.document.languageId === LANG) later(e.document); }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('ansibleLog')) { resetTypes(); vscode.window.visibleTextEditors.forEach(decorate); }
    }),
    vscode.commands.registerCommand('ansibleLog.colorize', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc) await vscode.languages.setTextDocumentLanguage(doc, LANG);
    }),
    vscode.languages.registerFoldingRangeProvider({ language: LANG }, {
      provideFoldingRanges(doc) {
        const secs = sections(linesOf(doc));
        const out: vscode.FoldingRange[] = [];
        secs.forEach((s, i) => {
          const nextSame = s.kind === 'play'
            ? secs.slice(i + 1).find(n => n.kind !== 'task')
            : secs[i + 1];
          const end = (nextSame?.line ?? doc.lineCount) - 1;
          if (end > s.line) out.push(new vscode.FoldingRange(s.line, end, vscode.FoldingRangeKind.Region));
        });
        return out;
      },
    }),
    vscode.commands.registerCommand('ansibleLog.foldTasks', () => foldTasks(() => true)),
    vscode.commands.registerCommand('ansibleLog.foldPassedTasks', () =>
      foldTasks(t => t.status === 'ok' || t.status === 'skipped' || t.status === 'included' || t.status === 'none')),
    vscode.commands.registerCommand('ansibleLog.stripEscapeCodes', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      const doc = ed.document;
      const text = doc.getText();
      const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      if (clean === text) { vscode.window.showInformationMessage('No escape codes in this file.'); return; }
      await ed.edit(e => e.replace(new vscode.Range(0, 0, doc.lineCount, 0), clean));
    }),
    vscode.commands.registerCommand('ansibleLog.reveal', async (line: number) => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || ed.document.languageId !== LANG) return;
      const pos = new vscode.Position(line, 0);
      await vscode.window.showTextDocument(ed.document, { viewColumn: ed.viewColumn, selection: new vscode.Range(pos, pos) });
      // Open the clicked section if it was folded (and any folded parent), so the tree
      // click shows its content, not just the header.
      await vscode.commands.executeCommand('editor.unfold', { levels: 1, direction: 'up', selectionLines: [line] });
      await vscode.commands.executeCommand('editor.unfold', { levels: 1, direction: 'down', selectionLines: [line] });
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
    }),
    { dispose: resetTypes },
  );

  const tree = new LogTree(structureOf);
  const view = vscode.window.createTreeView('ansibleLog.tree', { treeDataProvider: tree, showCollapseAll: true });
  const refreshTree = () => {
    const doc = vscode.window.activeTextEditor?.document;
    const isLog = doc?.languageId === LANG;
    vscode.commands.executeCommand('setContext', 'ansibleLog.active', isLog);
    if (doc && !isLog && doc.uri.scheme === 'output') return; // keep the last log while the Output panel has focus
    tree.setDocument(isLog ? doc : undefined);
  };
  let treeTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    view, tree,
    vscode.window.onDidChangeActiveTextEditor(refreshTree),
    vscode.workspace.onDidOpenTextDocument(() => setTimeout(refreshTree, 50)),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document !== vscode.window.activeTextEditor?.document) return;
      clearTimeout(treeTimer);
      treeTimer = setTimeout(refreshTree, 400);
    }),
    vscode.window.onDidChangeTextEditorSelection(e => {
      if (!view.visible || e.textEditor.document.languageId !== LANG) return;
      const node = tree.nodeAt(e.selections[0].active.line);
      if (node) view.reveal(node, { select: true, focus: false }).then(undefined, () => undefined);
    }),
  );
  refreshTree();

  vscode.workspace.textDocuments.forEach(maybeDetect);
  vscode.window.visibleTextEditors.forEach(decorate);
}

async function foldTasks(which: (t: import('./parse').LogTask) => boolean) {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.languageId !== LANG) return;
  const lines = structureOf(ed.document).plays.flatMap(p => p.tasks).filter(t => t.end > t.line && which(t)).map(t => t.line);
  if (!lines.length) return;
  await vscode.commands.executeCommand('editor.fold', { levels: 1, direction: 'down', selectionLines: lines });
}

export function deactivate() { resetTypes(); }
