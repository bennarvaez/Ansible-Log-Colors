import * as vscode from 'vscode';
import { looksLikeAnsibleOutput, parse, sections, Span, Style } from './parse';

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
      ? { textDecoration: 'none; display: none;' } // hide raw "\x1b[0;32m" noise
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

function decorate(editor: vscode.TextEditor) {
  const doc = editor.document;
  const byStyle = new Map<Style, vscode.Range[]>();
  if (doc.languageId === LANG) {
    for (const s of parse(linesOf(doc)) as Span[]) {
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
    { dispose: resetTypes },
  );

  vscode.workspace.textDocuments.forEach(maybeDetect);
  vscode.window.visibleTextEditors.forEach(decorate);
}

export function deactivate() { resetTypes(); }
