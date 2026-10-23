# Ansible Log Colors

Make large Ansible logs readable in VS Code in seconds.

This extension gives saved Ansible output the same visual meaning you rely on in a terminal:
green for success, yellow for changed, cyan for skipped/included, red for failures, and clear
section headers for fast scanning.

## Why this extension

When you open exported AAP/AWX output, ansible-navigator output, or long playbook logs in a plain
editor, everything is the same color and hard to triage.

**Ansible Log Colors** restores structure and signal so you can quickly answer:
- What failed?
- What changed?
- Which hosts were unreachable?
- Where in the run should I focus first?

## What you get

### Accurate Ansible-style coloring

| Output | Color |
| --- | --- |
| `ok: [host]` and its result body | green |
| `changed: [host]` | yellow |
| `skipping: [host]`, `included:`, `...ignoring` | cyan |
| `fatal:` / `failed:` / `ERROR!` | red |
| `UNREACHABLE!` | bright red |
| `[WARNING]` | bright magenta |
| `[DEPRECATION WARNING]` | magenta |
| `--diff` `+` / `-` / `@@` lines | green / red / cyan |
| `-vvv` connection chatter (`<host> ESTABLISH ...`) | blue |
| `PLAY` / `TASK` / `RUNNING HANDLER` headers | bold, stars dimmed |
| `PLAY RECAP` | host by worst result; non-zero counters in their color |

Multi-line results (`ok: [host] => {` ... `}`, wrapped warnings, and similar blocks) keep the
same style until the next separator/header, matching how Ansible output is read in practice.

### Works with both saved log styles

- **Plain text logs** (AAP/AWX downloads, ansible-navigator captures, `| tee run.log`,
  copy/paste): colors are inferred from Ansible callback patterns.
- **ANSI logs** (`ANSIBLE_FORCE_COLOR=1 ... > run.log`, AAP/AWX ANSI exports/downloads):
  original ANSI color codes are honored directly, and raw escape sequences can be hidden with
  `ansibleLog.hideEscapeCodes`.

### Smart detection + manual override

- Recognizes common names: `*.ansible.log`, `*ansible*.log`, `job_*.txt`, `*.awx.txt`
- Auto-detects `.log` and plain text files that look like Ansible output (`PLAY [`, `TASK [`,
  `PLAY RECAP`) via `ansibleLog.autoDetect`
- Manual override command: **Ansible Log: Color This File as Ansible Output**

## Folding TASKs and PLAYs (how it works)

The extension scans the currently open log file and
creates fold regions from Ansible headers:

- `PLAY [ ... ]`
- `TASK [ ... ]`
- `RUNNING HANDLER [ ... ]`
- `PLAY RECAP`

Each region starts at that header and folds until the next relevant header. For `PLAY` sections,
child `TASK` entries stay inside the play fold range.

### Headers show the result

Each `TASK` and `PLAY` header is colored by the worst result under it: red if anything
failed, magenta if a failure was ignored, yellow if something changed, green if all ok,
cyan if everything was skipped. A folded log still shows at a glance what happened
(`ansibleLog.colorHeadersByResult`).

### Fold commands

- **Ansible Log: Fold Tasks** folds every TASK and leaves the PLAYs open. It's also on the
  editor title bar.
- **Ansible Log: Fold Passed Tasks** folds only ok/skipped tasks, leaving changed and
  failed ones open.
- Use the built-in **Unfold All** to open everything again.

## Navigation tree

When an Ansible log is active, an **Ansible Log** view appears in the Explorer with this tree:

```
PLAY [Provision Windows VM]
  Gathering Facts
  azure_windows_vm                      (role)
    roles/azure_windows_vm/tasks/validate.yml   (file)
      Validate required inputs
```

Every node has an icon colored by its worst result and a count summary such as
`failed 1 · changed 3 · ok 12`. Click a node to jump to it. The tree follows your cursor.

Exact file grouping needs `task path:` lines, which Ansible prints at `-vv` (AWX
verbosity 2). Without them, tasks are grouped under the most recent `included:` file
for the same role, and those file nodes are marked as inferred in their tooltip.

## Escape codes and selection

When a log still contains ANSI escape codes, the codes are collapsed to zero width and the
text is colored by them. If anything still looks odd, run **Ansible Log: Remove Escape
Codes From This File**. That strips the codes from the buffer, and the colors are then
re-derived from the text.

## Customize colors

Colors default to your theme's terminal ANSI palette, so the file view matches your terminal
expectations. Override any style in `settings.json`:

```jsonc
"workbench.colorCustomizations": {
  "ansibleLog.changed": "#d7af00",
  "ansibleLog.skipped": "#5fafaf"
}
```

Available color ids:

- `ansibleLog.ok`
- `ansibleLog.changed`
- `ansibleLog.skipped`
- `ansibleLog.included`
- `ansibleLog.failed`
- `ansibleLog.unreachable`
- `ansibleLog.warning`
- `ansibleLog.deprecation`
- `ansibleLog.verbose`
- `ansibleLog.debug`
- `ansibleLog.diffAdd`
- `ansibleLog.diffRemove`
- `ansibleLog.diffLines`

## Build and package

```sh
npm install
npm run package
```

This generates `ansible-log-colors-<version>.vsix`.

Install it from VS Code:
**Extensions** panel -> `...` menu -> **Install from VSIX...**

## License

[MIT](LICENSE): permissive license requiring preservation of copyright and license
notices in redistributions.
