# Ansible Log Colors

Make large `ansible-playbook` and AWX logs readable in VS Code in seconds.

This extension gives saved Ansible output the same visual meaning you rely on in a terminal:
green for success, yellow for changed, cyan for skipped/included, red for failures, and clear
section headers for fast scanning.

## Why this extension

When you open exported AWX output or long playbook logs in a plain editor, everything is the same
color and hard to triage.

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

- **Plain text logs** (AWX "Download output", `| tee run.log`, copy/paste): colors are inferred
  from Ansible callback patterns.
- **ANSI logs** (`ANSIBLE_FORCE_COLOR=1 ... > run.log`, AWX API `stdout/?format=ansi_download`):
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

### How to use folding in VS Code

1. Open an Ansible log in **Ansible Log** mode.
2. Use the gutter chevrons to fold individual TASK or PLAY sections.
3. Use command palette actions like:
   - **Fold All**
   - **Unfold All**
   - **Fold Level 2** (handy for collapsing most TASK detail quickly)

This makes long run output navigable without losing context.

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
