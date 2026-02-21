# Claude Code Sandboxed Development Container
# Runs Claude Code in YOLO mode (--dangerously-skip-permissions) with:
#   - Network egress restricted to whitelisted domains via iptables
#   - Non-root execution after firewall init
#   - Read-only root filesystem (writable dirs via tmpfs/volumes)
#
# Usage:
#   docker compose run --rm claude              # interactive session
#   docker compose run --rm claude -p "prompt"  # one-shot prompt
#
# Based on: https://github.com/anthropics/claude-code/tree/main/.devcontainer

FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="claude-code-sandbox"
LABEL org.opencontainers.image.description="Sandboxed Claude Code with network egress restrictions"

ARG CLAUDE_CODE_VERSION=latest

# ── System dependencies ──────────────────────────────────────────────
# git              : Claude Code repo operations
# curl, ca-certs   : HTTPS, firewall verification
# gosu             : PID-1-safe privilege de-escalation (setuid/setgid + exec)
# jq               : JSON processing for firewall setup
# aggregate        : CIDR aggregation for GitHub IP ranges (Debian package)
# iptables, ipset  : network firewall rules and IP sets
# iproute2         : `ip route` for detecting Docker gateway
# dnsutils         : `dig` for DNS resolution in firewall setup
# less, procps     : basic utilities Claude Code may invoke
#
# NOTE: sudo is intentionally NOT installed. The entrypoint runs as root
# for firewall init, then drops to non-root via gosu. no-new-privileges
# prevents the claude user from regaining root, making sudo inert anyway.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    gosu \
    jq \
    less \
    procps \
    iptables \
    ipset \
    iproute2 \
    dnsutils \
    aggregate \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# ── Install Claude Code ──────────────────────────────────────────────
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
  && npm cache clean --force \
  && rm -rf /root/.npm /tmp/*

# ── Non-root user ────────────────────────────────────────────────────
# Match host UID/GID to avoid bind-mount permission issues.
# macOS default: 501:20. Linux default: 1000:1000.
# GID 20 exists in Debian as 'dialout', so we use the existing group if present.
ARG USER_UID=501
ARG USER_GID=20
RUN if ! getent group ${USER_GID} >/dev/null 2>&1; then \
      groupadd -g ${USER_GID} claude; \
    fi \
  && useradd -u ${USER_UID} -g ${USER_GID} -m -s /bin/bash claude

# ── Directories ──────────────────────────────────────────────────────
RUN mkdir -p /workspace /home/claude/.claude /home/claude/.npm \
  && chown -R ${USER_UID}:${USER_GID} /workspace /home/claude

# ── Firewall + Entrypoint ────────────────────────────────────────────
COPY init-firewall.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/entrypoint.sh

# NOTE: No sudoers entry. The entrypoint runs as root for firewall init,
# then drops to the claude user via gosu. The no-new-privileges Docker
# flag prevents the claude user from ever regaining root.

# ── Runtime config ───────────────────────────────────────────────────
WORKDIR /workspace
ENV HOME=/home/claude
ENV DEVCONTAINER=true

# Container starts as root for firewall init, then drops to claude user
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
