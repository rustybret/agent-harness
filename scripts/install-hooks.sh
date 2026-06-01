#!/bin/sh
# Install git hooks for this repository
# Run this once after cloning: sh scripts/install-hooks.sh

set -e
git config core.hooksPath .githooks
echo "✓ Git hooks installed (core.hooksPath = .githooks)"
