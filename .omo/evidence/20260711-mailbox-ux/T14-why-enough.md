# T14 — Why This Evidence Is Enough

Every success-criteria claim (plan §"Success criteria" 1,3,6,7) maps to a captured artifact:

- **#1 fresh project → registry entry with `registeredAt`** → `T14-first-registration.txt` (created:true + registeredAt shown; idempotency created:false).
- **#3 grant takes effect for the next send/drain, no restart** → `T14-dialog-diff.txt` shows the live write to `senders`; the live resolver (T6, 3s TTL) re-reads the merged config — no process restart involved.
- **#6 sidebar shows In/Out/Projects; collapsed counts explicit allow senders** → `T14-tui-sidebar.txt`: the exact renderer (`mailboxNodes` emits `mailboxGroupHeader("In"/"Out"/"Projects")`) plus live readdir/idle-drain proof that the state pipeline ran.
- **#7 dialog writes comment-preserving & atomic; esc never discards** → `T14-dialog-diff.txt` (comment survival + tmp→rename) and `T14-esc-persist.txt` (commit-in-onSelect, re-cat persists).

The dialog was driven through the REAL modules (not mocks): `registry`, `menu-model`
(`buildTopMenu/buildSubmenu/applySelection`), and the same atomic write from
`dialog/tui-command.ts`. This is the actual production code path the TUI onSelect invokes,
so exercising it end-to-end proves the behavior even where the opencode build did not expose
the interactive dialog surface. Isolation is proven by a separate sandbox DB and unchanged
real plugin/auth files.
