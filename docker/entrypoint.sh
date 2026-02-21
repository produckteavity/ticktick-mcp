#!/bin/bash
set -euo pipefail

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── Validate required environment ────────────────────────────────────
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    log "ERROR: ANTHROPIC_API_KEY is not set."
    log "  Export it in your shell:  export ANTHROPIC_API_KEY=sk-ant-..."
    log "  Or add it to a .env file: echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env"
    exit 1
fi

# ── Firewall ─────────────────────────────────────────────────────────
if [ "${SKIP_FIREWALL:-0}" = "1" ]; then
    log "WARNING: SKIP_FIREWALL=1 — ALL NETWORK RESTRICTIONS DISABLED"
    log "  This should only be used for debugging, never for untrusted repos."
    sleep 2
else
    log "Initializing network firewall..."
    if /usr/local/bin/init-firewall.sh; then
        log "Firewall active: egress restricted to allowed domains"
    else
        log "ERROR: Firewall setup failed."
        log "  To run without network restrictions: docker compose run --rm -e SKIP_FIREWALL=1 claude"
        exit 1
    fi
fi

# ── Resolve the claude user's UID ─────────────────────────────────────
CLAUDE_UID=$(id -u claude)
CLAUDE_GID=$(id -g claude)

# ── Fix ownership of home tmpfs and config volume ────────────────────
# The /home/claude tmpfs is root-owned by default; fix before any gosu calls.
chown "$CLAUDE_UID:$CLAUDE_GID" /home/claude
chown -R "$CLAUDE_UID:$CLAUDE_GID" /home/claude/.claude 2>/dev/null || true

# ── Git safe directory ───────────────────────────────────────────────
# Mounted repos may have different ownership — tell git it's OK
gosu claude git config --global safe.directory /workspace

# ── Drop to non-root and exec Claude Code ────────────────────────────
log "Starting Claude Code (user=claude, uid=$CLAUDE_UID)"
echo ""
exec gosu claude claude --dangerously-skip-permissions "$@"
