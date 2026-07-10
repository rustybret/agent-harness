# Mailbox peek/drain tools QA

## What was tested
- Built dist plugin loaded by isolated `opencode run --format json` via `file:///Users/brethoffman/Git/agent-harness/dist/index.js`.
- Isolated XDG/HOME sandbox: `/var/folders/9f/hp9ydfwn7wxcm48907jlpm3c0000gn/T/omo-mailbox-qa.XXXXXX.XmpAROvgqY`.
- Fake local OpenAI Responses server forced tool calls for `project_mailbox_peek` then `project_mailbox_drain`.
- Receiver mailbox contained one unread fixture note from a throwaway sender project.

## What was observed
- Run JSONL: `opencode-run.jsonl`.
- Tool proof: `tool-proof.txt` shows both tool names, returned full body, and final response.
- Fake model log: `fake-openai.log`.
- IDs: `qa-ids.json`.
- Mailbox after run: `mailbox-files-after.txt` shows the note moved under `processed/`.
- Real DB session count before/after read-only check: `5651` / `5651`.

## Why it is enough
- Uses the real `opencode run --format json` harness against the built plugin dist, not direct unit calls.
- The model had to call both registered tools through OpenCode's tool execution path.
- The drain result consumed the fixture note synchronously without waiting for `session.idle`.

## What was omitted
- No live peer project (cloudhome, art3d-pipeline, unitySuperMCP, etc.) was touched.
- No real provider call was made; the fake local Responses server avoids credentials and cost.
- Raw environment dumps and auth-bearing config are not copied.
