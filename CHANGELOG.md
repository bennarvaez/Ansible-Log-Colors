# Changelog

## 0.2.0
- TASK and PLAY headers are colored by their worst result, so folded logs show what passed and failed.
- New commands: Fold Tasks and Fold Passed Tasks.
- New Ansible Log view in the Explorer: a play > role > file > task tree with result-colored icons and counts. Click to jump; follows the cursor.
- Fixed selection highlight not showing on logs that still contain ANSI escape codes.
- New command: Remove Escape Codes From This File.
- Folded sections no longer get VS Code's fold background, so the result colors stay readable.

## 0.1.1
- Updated Marketplace metadata and copy: improved extension description and generalized log support wording (ansible-playbook, ansible-navigator, AAP/AWX).
- Switched project license to MIT and updated package metadata/license references.
- Updated repository/issue links to the new GitHub location and changed publisher to `BenNarvaez`.
- Added CODEOWNERS default owner entry.

## 0.1.0
- First release: colors saved ansible-playbook and AWX output like the CLI (plain-text and ANSI logs), auto-detects Ansible logs, folding per PLAY/TASK.
