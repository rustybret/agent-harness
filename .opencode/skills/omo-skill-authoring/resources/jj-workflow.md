# OmO Multi-Agent Jujutsu Workflow

> **Context:** This document describes the workflow for the `~/Git/skills` standalone repo, which uses Jujutsu (jj) as its VCS. **Agent-harness uses git**, not jj. The coordination model (narrow agent slices, stacked review, publish at boundary) is transferable, but the exact commands apply to `~/Git/skills` only.

This repo uses Jujutsu guidance as the preferred model for **multi-agent coordination**, especially when work is stacked, reviewed incrementally, or split across several related efforts.

## Mental model

Jujutsu is change-centric, not branch-centric.

- `@` is the working copy change
- anonymous changes are normal
- bookmarks are the Git-facing named pointers used when you are ready to publish
- local work can stay unnamed until it is ready to leave your machine

For OmO-style multi-agent work, that maps well to:
- agents creating or refining changes locally
- bookmarks only appearing when a review/push boundary is reached
- stacked review rather than “one giant branch” work

## Recommended command flow

```bash
jj new main
# edit files
jj describe -m "docs: rewrite omo guidance"
jj new
# edit next slice
jj describe -m "feat: add xcode-mcp skill"
```

Use `jj squash` when the current working-copy change should fold into its parent instead of remaining its own review unit.

## Publish boundary

Keep local work as a stack first. Create a bookmark when you are ready to publish that stack to Git hosting.

Examples:

```bash
jj bookmark create omo-docs -r @-
jj git push --bookmark omo-docs
```

Or let `jj` generate a publishable bookmark around a change-oriented workflow.

## Sync loop for collaborative work

```bash
jj git fetch
jj rebase -o main
```

That keeps local stacked work moving on top of the latest shared history without switching back into a branch-heavy Git mindset.

## GitHub and GitLab

- use bookmarks as the public-facing review handles
- keep internal planning tied to change IDs where possible
- use GitHub/GitLab only at the publish/review boundary
- use push options or bookmark naming conventions to keep review stacks understandable

## OmO-specific practice

For multi-agent coordination:
1. define the stack or plan first
2. let agents work on narrow slices
3. validate each slice independently
4. publish only the slices ready for human review

This is the `jj` equivalent of the repo’s older Git/GitHub automation guidance, but it matches OmO’s preference for stacked, reviewable units of work.
