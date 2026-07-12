# Task 9: Pack-install smoke test (the AFT "frozen sidebar from npm install" gate)

## What was tested

Ran `script/qa/smoke-tui-pack-install.ts` end to end, live, no mocking of the pack/install
steps themselves:
1. `bun run build` for a real production build.
2. `npm pack --json --pack-destination <tmp>` on the root package (real tarball, no network).
3. `bun install --production` of that tarball into a fresh temp install root (real install,
   node_modules resolution, no network beyond the local tarball).
4. Assert `dist/tui-compiled/mailbox-sidebar.js` exists inside the INSTALLED package (proves
   `package.json`'s `files`/`exports` actually ship the compiled sidebar, not just the source
   repo).
5. Assert the compiled sidebar source references `opentui:runtime-module:` virtual specifiers.
6. Mock the `opentui:runtime-module:%40opentui%2Fsolid` and `opentui:runtime-module:solid-js`
   virtual modules via `Bun.plugin` (real Bun plugin API, not a test-double import), dynamically
   import the REAL packed `dist/tui-compiled/mailbox-sidebar.js`, construct a real
   `createMailboxSidebarController`, render `MailboxSidebar`, then call `controller.toggle()`
   and re-render to prove a genuine before/after reactivity round-trip (collapse marker flips
   `▶` -> `▼`, not a placeholder always-true assertion).
7. Without any virtual-module mocking (bare Bun import), import the real installed
   `dist/tui.js` and confirm the raw/fallback module shape loads correctly.

## What was observed

Final run (2026-07-12, Atlas re-run independent of the subagent's own run):

```
Building...
Packing...
  ok  npm pack produced a tarball
Installing...
  ok  compiled TUI sidebar ships in the packed package
  ok  compiled TUI imports the host runtime virtual modules
stubbed runtime probe loaded the compiled TUI path and proved reactivity
  ok  stubbed virtual runtime probe imports the compiled TUI entry and proves reactivity
raw fallback probe loaded the TUI entry
  ok  bare Bun probe imports the raw fallback

smoke-tui-pack-install: all checks passed
```

Exit code: 0. All 5 checks passed (tarball produced, compiled sidebar ships, compiled sidebar
uses virtual-module specifiers, mocked-runtime reactivity proof, bare-runtime fallback proof).

The tarball listing (`tar -tvf`) was captured during the run and confirmed
`package/dist/tui-compiled/mailbox-sidebar.js` and `package/dist/tui.js` are both present in the
packed contents, alongside the rest of the shipped `dist/` and `packages/*/plugin` tree per the
project's existing `files` globs. The full raw tarball listing (thousands of entries — every
shipped skill/component file) was captured to a local temp log during Atlas's re-run rather than
embedded verbatim here, since it is not diagnostic signal, only a size proof already covered by
check #2.

## Why it is enough

- This is the FORMAL regression guard for the exact class of bug found and fixed earlier in this
  plan: T3's build script originally emitted `dist/tui-compiled/mailbox-sidebar.tsx` instead of
  `.js`, silently killing the compiled-JSX path at runtime. This smoke test packs, installs, and
  dynamically imports the REAL artifact from a REAL tarball — if that extension bug (or any
  future "files globs forgot to ship dist/tui-compiled" regression) recurs, check #2 or #3 fails
  immediately.
- The reactivity proof is a genuine round-trip: a real `createSignal`-backed controller state
  change flips a real rendered character in the stringified component tree, not a trivial
  always-true assertion.
- The fallback proof independently confirms `dist/tui.js` still loads under a bare Bun runtime
  with zero virtual-module mocking, matching what happens when the compiled path is unavailable
  (e.g. an older host without the `opentui:runtime-module:` scheme).
- No network access was required (only local tarball install); nothing was published to any
  registry.

## What was omitted

- The raw `tar -tvf` tarball listing (thousands of lines, every shipped skill/component file
  across `packages/omo-codex`, `packages/shared-skills`, `dist/skills`, etc.) was not embedded
  verbatim in this evidence file — it carries no secrets, but it is pure size-proof noise already
  covered by check #2's existence assertion. It was inspected directly during verification and
  confirmed to include the compiled sidebar path.
- No secret-bearing logs, environment dumps, auth headers, or credentials were captured or
  omitted (none were produced by this smoke test).

## Cleanup

The script's own `finally` block removes its temp pack/install directories on every run
(`process.env.KEEP_TUI_PACK_SMOKE` opt-out only, unset in this verification run). No scratch
files or temp directories were left behind by this task after Atlas's independent re-run
(15 stray `test-reactivity*.ts` debug scripts left by the implementing subagent's own iteration
in the repo root were found untracked, uncommitted, and removed by Atlas before this evidence
file was finalized).
