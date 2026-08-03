# Cloudhome remote-mailbox contract — coordination note fixture

This is the exact content agent-harness would send to the **cloudhome** project via
`project_message` to document the remote-execution contract and ask cloudhome to implement its
executor half. agent-harness owns only the LOCAL half (request construction, pending state,
PR/answer intake); cloudhome owns the executor that consumes the request payload and replies.

> Delivery mechanics: send target `cloudhome` (registry id `cloudhome-5aa53d2c`, outbound
> grant = `plan` per the plan's outbound list). Mark it machine-consumable with
> `category: "machine:remote-mailbox-contract"` (see `REMOTE_CONTRACT_CATEGORY` in
> `cloudhome.ts`). Use `intent: "plan"`. No `requested_mode` on this coordination note itself —
> it is a human/agent-readable spec, not a routed work item.
>
> Secret hygiene (memory #1416): the `payload` field MUST NOT contain plaintext secrets or
> credentials. Reference OCI Vault secret NAMES only; cloudhome resolves them on its side.

---

## project_message arguments

```jsonc
{
  "mode": "send",
  "targetProjectId": "cloudhome-5aa53d2c",
  "intent": "plan",
  "category": "machine:remote-mailbox-contract",
  "body": "<the Body below>"
}
```

## Body

We (agent-harness) are adding a remote-execution mailbox contract so notes we cannot fulfill
locally can be delegated to you. We implement the request/intake half; we need you to implement
the executor half. Please treat this as a specification.

### Wire payload (v1, JSON, sent as the body of a threaded `project_message` to you)

```jsonc
{
  "version": 1,
  "kind": "remote-answer" | "remote-worker-pr",
  "noteRef": "<original inbound messageId being fulfilled>",
  "repo": "<repo name the work concerns, e.g. agent-harness>",
  "gitRef": "<optional git ref / branch / sha>",
  "payload": "<the question text (remote-answer) or the work-order body (remote-worker-pr)>",
  "replyRouting": {
    "toProjectId": "<the project you must reply to — agent-harness>",
    "correlationId": "<thread correlationId to preserve>"
  }
}
```

Schema is `strict` — unknown top-level keys are rejected. `gitRef` is the only optional field.

### What we need cloudhome to do

1. Consume a `remote-answer` request: answer the `payload` question in the context of `repo`
   at `gitRef`, then reply.
2. Consume a `remote-worker-pr` request: implement the `payload` work order in `repo`, open a
   PR, then reply with the PR URL.
3. **Reply threading (critical):** reply via `project_message`/`project_note` back to
   `replyRouting.toProjectId`, with `inReplyToMessageId` set to the messageId of THIS contract
   note (the outbound request note you received), and `correlationId` =
   `replyRouting.correlationId`. Our intake keys pending state on the outbound note's messageId,
   so a reply that does not thread on it will be ignored.
4. The reply body is the answer text (for `remote-answer`) or the PR URL + summary (for
   `remote-worker-pr`). An empty completion body is treated by us as malformed and quarantined.

### Constraints

- Do not include plaintext secrets in any reply; reference OCI Vault secret names.
- This is advisory/contract-only from our side; you remain authoritative over what you execute.
