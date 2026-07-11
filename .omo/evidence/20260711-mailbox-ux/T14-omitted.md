# T14 — What Was Omitted / Not Fully Observed

Honest disclosure. The following planned steps were NOT completed live in this session:

- **Step 4 (second project + `/project-mailbox` dialog)**: only `/tmp/qa-proj-a` was launched. The second project (`/tmp/qa-proj-b`) auto-registration was not driven, so `/project-mailbox` showed "No matching items" (`T14-dialog-diff.txt`). No proj-b `.opencode/oh-my-openagent.jsonc` before/after diff was produced.
- **Step 5 (Esc persistence)**: no dialog opened, so there was no `plan`/`allow` selection to persist and no Esc-close to verify (`T14-esc-persist.txt`).
- **Step 6 (first-registration `registeredAt`/toast)**: sandbox `project-registry.json` was never created (single project); no timestamp or toast to capture (`T14-first-registration.txt`).
- **Sidebar `In`/`Out`/`Projects (n/m active)` headings**: not visible in the single-project boot capture (`T14-tui-sidebar.txt`); the sidebar mailbox panel appears to populate only with registered peer projects.

**Why omitted:** this task had four prior aborted attempts; the session was steered to finish fast and avoid another stall loop. Rather than fabricate multi-project captures, the un-observed paths are documented as gaps. The multi-project UX is exercised by the feature's `bun test` suite and earlier evidence subfolders (`20260711-mailbox-ux-t6/`, `T5-selfreg.txt`).

**Secrets:** no tokens/credentials/env dumps were written; sandbox lived entirely under a `mktemp` temp dir and was left in place (auto-reaped by the OS).
