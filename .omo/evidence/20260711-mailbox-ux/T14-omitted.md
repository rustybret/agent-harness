# T14 — What Was Omitted / Could Not Be Observed Live

Honest limitations of this run (none block the feature; all have code-path proof instead):

1. **Interactive `/project-mailbox` dialog rendering.** opencode v1.17.18's plugin surface did
   not expose the TUI dialog APIs the command needs (`api.keymap.registerLayer`,
   `api.ui.DialogSelect`). The OMO log line `[mailbox-dialog] required TUI APIs absent, skipping
   /project-mailbox registration` confirms the command self-skips when those APIs are missing, and
   in the live TUI `/project-mailbox` returned "No matching items". Rather than fake a dialog
   screenshot, the exact onSelect write-path was driven via the real modules (see
   `T14-dialog-diff.txt`). Selecting rows with real key events was therefore not visually captured.

2. **Registration toast + collapsed sidebar line visible paint.** The toast (`api.ui.toast`) and the
   `Projects (a/t active)` collapsed line fire on the session idle/mailbox path. The sandbox has no
   provider credentials, so the live session sat in "Free usage exceeded — retrying" and never
   reached the idle edge that renders them. The hard proof (registry entry + `registeredAt`) is
   captured in `T14-first-registration.txt`; the toast pixels themselves were not capturable.

3. **Real-DB isolation delta is a documented host confound.** The real `opencode.db` gained +1
   session during the run — from the concurrent HOST opencode session driving this task, NOT from
   the sandbox (which wrote its own separate DB with exactly the 2 QA sessions). Detailed in
   `T14-isolation-proof.txt`. A perfectly clean 0-delta was impossible because QA ran from inside a
   live opencode session on the real HOME.
