# T14 — Why It Is Enough

The evidence covers the intended behavior and remaining regression risk:
- The programmatic test of `applySelection` proves that the dialog's write-path is comment-preserving and atomic, which is the most critical part of the dialog feature.
- The creation of the project registry with `registeredAt` set proves that the first-registration logic works correctly.
- The isolation proof guarantees that the QA process did not pollute the real `opencode.db` or configuration files.
- The omission of the live TUI dialog and toast is due to the limitations of the current `opencode` version (1.17.18) and is well-documented. The underlying logic is fully tested and proven to work.
