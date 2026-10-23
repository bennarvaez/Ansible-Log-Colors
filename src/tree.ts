import * as vscode from 'vscode';
import { assignFiles, Counts, LogStructure, LogTask, Status, worst } from './parse';

// Navigation tree: PLAY > role > file > TASK, in execution order. Consecutive tasks from
// the same role / file are grouped; a role that runs again later gets a new group.

export interface Node {
  kind: 'play' | 'role' | 'file' | 'task' | 'recap';
  label: string;
  line: number;
  status: Status;
  counts: Counts;
  children: Node[];
  parent?: Node;
  task?: LogTask;
  inferred?: boolean;
  full?: string;            // file nodes: the path as logged
}

const ICON: Record<Status, string> = {
  none: 'circle-outline', skipped: 'debug-step-over', included: 'file-symlink-file',
  ok: 'pass', changed: 'circle-filled', ignored: 'warning', failed: 'error', unreachable: 'debug-disconnect',
};
const COLOR: Partial<Record<Status, string>> = {
  ok: 'ansibleLog.ok', changed: 'ansibleLog.changed', skipped: 'ansibleLog.skipped', included: 'ansibleLog.included',
  ignored: 'ansibleLog.warning', failed: 'ansibleLog.failed', unreachable: 'ansibleLog.unreachable',
};
const ORDER: Status[] = ['failed', 'unreachable', 'ignored', 'changed', 'ok', 'skipped', 'included'];
const WORD: Partial<Record<Status, string>> = { skipped: 'skipped', included: 'included' };

function summary(c: Counts): string {
  return ORDER.filter(s => c[s]).map(s => `${WORD[s] ?? s} ${c[s]}`).join(' · ');
}

function addCounts(into: Counts, from: Counts) {
  for (const [k, v] of Object.entries(from)) into[k as Status] = (into[k as Status] ?? 0) + (v ?? 0);
}

function shortFile(f: string): string {
  const m = /(?:^|[\\/])(roles[\\/].*)$/.exec(f) ?? /([^\\/]+[\\/][^\\/]+)$/.exec(f);
  return m ? m[1].replace(/\\/g, '/') : f;
}

export function buildTree(s: LogStructure): Node[] {
  const roots: Node[] = [];
  for (const p of s.plays) {
    const play: Node = { kind: 'play', label: p.name ? `PLAY [${p.name}]` : '(no play header)', line: p.line, status: p.status, counts: {}, children: [] };
    roots.push(play);
    const files = assignFiles(p);
    // Which file node pulled in each included file, so includes nest under their caller.
    const includedBy = new Map<string, Node | undefined>();
    let role: Node | undefined;
    let stack: Node[] = [];              // open file nodes in the current role group, outermost first
    for (const t of p.tasks) {
      const { file: f, inferred } = files.get(t)!;
      if (t.role !== role?.label || (!t.role && role)) {
        role = t.role ? { kind: 'role', label: t.role, line: t.line, status: 'none', counts: {}, children: [], parent: play } : undefined;
        if (role) play.children.push(role);
        stack = [];
      }
      const owner = role ?? play;
      let file: Node | undefined;
      if (f) {
        const open = stack.findIndex(n => n.full === f);
        if (open >= 0) {
          stack = stack.slice(0, open + 1);
          file = stack[open];
        } else if (includedBy.has(f) || role) {
          // Role-less tasks that weren't included live in the playbook itself: no file node.
          const caller = includedBy.get(f);
          const at = caller ? stack.indexOf(caller) : -1;
          stack = at >= 0 ? stack.slice(0, at + 1) : [];
          const host = stack[stack.length - 1] ?? owner;
          file = { kind: 'file', label: shortFile(f), line: t.line, status: 'none', counts: {}, children: [], parent: host, inferred, full: f };
          host.children.push(file);
          stack.push(file);
        } else {
          stack = [];
        }
      } else {
        stack = [];
      }
      for (const inc of t.includes) includedBy.set(inc, file);
      const parent = file ?? owner;
      const node: Node = {
        kind: 'task', label: (t.kind === 'handler' ? 'HANDLER ' : '') + t.name, line: t.line,
        status: t.status, counts: t.counts, children: [], parent, task: t,
      };
      parent.children.push(node);
      for (let n: Node | undefined = parent; n; n = n.parent) {
        n.status = worst(n.status, t.status);
        addCounts(n.counts, t.counts);
      }
    }
  }
  if (s.recapLine !== undefined) roots.push({ kind: 'recap', label: 'PLAY RECAP', line: s.recapLine, status: 'none', counts: {}, children: [] });
  return roots;
}

export class LogTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private roots: Node[] = [];
  private byLine: Node[] = [];

  constructor(private readonly structureOf: (doc: vscode.TextDocument) => LogStructure) {}

  setDocument(doc: vscode.TextDocument | undefined) {
    this.roots = doc ? buildTree(this.structureOf(doc)) : [];
    this.byLine = [];
    const walk = (ns: Node[]) => ns.forEach(n => { if (n.kind === 'task' || n.kind === 'play' || n.kind === 'recap') this.byLine.push(n); walk(n.children); });
    walk(this.roots);
    this.byLine.sort((a, b) => a.line - b.line);
    this.emitter.fire(undefined);
  }

  // Deepest node whose section contains the line (for following the cursor).
  nodeAt(line: number): Node | undefined {
    let found: Node | undefined;
    for (const n of this.byLine) { if (n.line <= line) found = n; else break; }
    return found;
  }

  getChildren(n?: Node): Node[] { return n ? n.children : this.roots; }
  getParent(n: Node): Node | undefined { return n.parent; }

  getTreeItem(n: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(n.label,
      n.children.length === 0 ? vscode.TreeItemCollapsibleState.None
        : n.kind === 'play' || n.kind === 'role' ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed);
    const color = COLOR[n.status] ? new vscode.ThemeColor(COLOR[n.status]!) : undefined;
    const icon = n.kind === 'task' ? ICON[n.status]
      : n.kind === 'play' ? 'symbol-namespace' : n.kind === 'role' ? 'package' : n.kind === 'file' ? 'file' : 'checklist';
    item.iconPath = new vscode.ThemeIcon(icon, color);
    item.description = n.kind === 'task' ? summary(n.counts) : n.kind === 'recap' ? '' : summary(n.counts);
    if (n.kind === 'file') item.tooltip = `${n.full}${n.inferred ? '\n(inferred from the last "included:" line; run with -vv for exact task paths)' : ''}`;
    if (n.kind === 'task' && n.task?.path) item.tooltip = n.task.path;
    item.command = { command: 'ansibleLog.reveal', title: 'Go to', arguments: [n.line] };
    return item;
  }

  dispose() { this.emitter.dispose(); }
}
