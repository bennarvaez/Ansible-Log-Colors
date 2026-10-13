# Ansible Log Colors

Colors saved `ansible-playbook` and AWX job output in VS Code the way the terminal and
AWX show it.

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

Multi-line results (`ok: [host] => {` ... `}`, warnings that wrap) keep the color of the
line that started them until the next blank line or header, like the CLI.

## Two kinds of log

- **Plain text** (AWX "Download output", `| tee run.log`, copy/paste): colors are
  re-derived from Ansible's default callback rules.
- **With escape codes** (`ANSIBLE_FORCE_COLOR=1 ansible-playbook ... > run.log`, AWX API
  `stdout/?format=ansi_download`): the codes themselves are used, so it is exactly what the
  terminal showed, and the raw `\x1b[0;32m` codes are hidden
  (`ansibleLog.hideEscapeCodes`).

## Which files

- `*.ansible.log`, `*ansible*.log`, `job_*.txt` (AWX download name), `*.awx.txt`.
- Any `.log` or plain-text file with `PLAY [`, `TASK [` or `PLAY RECAP` near the top is
  switched automatically (`ansibleLog.autoDetect`).
- Anything else: run **Ansible Log: Color This File as Ansible Output**, or pick
  "Ansible Log" in the language picker in the status bar.

## Extras

- Fold each TASK, or a whole PLAY.

## Changing colors

Colors default to your theme's terminal palette, so they match your integrated terminal.
Override any of them in `settings.json`:

```jsonc
"workbench.colorCustomizations": {
  "ansibleLog.changed": "#d7af00",
  "ansibleLog.skipped": "#5fafaf"
}
```

Ids: `ansibleLog.ok`, `changed`, `skipped`, `included`, `failed`, `unreachable`, `warning`,
`deprecation`, `verbose`, `debug`, `diffAdd`, `diffRemove`, `diffLines`.

## Build

```sh
npm install
npm run package   # ansible-log-colors-<version>.vsix
```

Install: Extensions view, `...` menu, **Install from VSIX...**

## License

[PolyForm Noncommercial 1.0.0](LICENSE): free to use, copy, modify and share for any noncommercial purpose. Selling it, or a fork of it, is not allowed.
