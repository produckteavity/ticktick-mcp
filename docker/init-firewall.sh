#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# ══════════════════════════════════════════════════════════════════════
# Network Egress Firewall for Claude Code Container
# ══════════════════════════════════════════════════════════════════════
# Default-deny outbound policy. Only whitelisted domains are reachable.
# Adapted from Anthropic's official devcontainer:
#   https://github.com/anthropics/claude-code/tree/main/.devcontainer
#
# SECURITY NOTES:
# - DNS is restricted to Docker's embedded resolver (127.0.0.11) to
#   prevent DNS tunneling exfiltration.
# - SSH is restricted to whitelisted IPs only (GitHub).
# - The host bridge network is limited to the gateway IP, not the /24.
# - There is a brief (~seconds) unrestricted window during init between
#   iptables flush and default-deny policy. This is an accepted trade-off
#   inherited from the official devcontainer approach.
#
# To add project-specific domains, pass EXTRA_DOMAINS env var:
#   EXTRA_DOMAINS="pypi.org,custom.api.com" docker compose run --rm claude
# ══════════════════════════════════════════════════════════════════════

# ── Hardening: ignore inherited env for security ─────────────────────
# Prevent the claude user from influencing firewall config via sudo env.
# (sudo is not installed, but defense in depth.)
EXTRA_DOMAINS_VAL="${EXTRA_DOMAINS:-}"
unset SKIP_FIREWALL

# ── Allowed domains ──────────────────────────────────────────────────
CORE_DOMAINS=(
    "api.anthropic.com"         # Claude API (required)
    "statsig.anthropic.com"     # Anthropic telemetry
    "api.statsig.com"           # Statsig alternative endpoint
    "statsig.com"               # Feature flags
    "sentry.io"                 # Error reporting
    "registry.npmjs.org"        # npm package registry
    "updates.anthropic.com"     # Claude Code version checks
)

# Project-specific domains from EXTRA_DOMAINS env var (comma-separated)
EXTRA_ALLOWED_DOMAINS=()
if [ -n "$EXTRA_DOMAINS_VAL" ]; then
    IFS=',' read -ra _extra <<< "$EXTRA_DOMAINS_VAL"
    for d in "${_extra[@]}"; do
        EXTRA_ALLOWED_DOMAINS+=("$(echo "$d" | xargs)")  # trim whitespace
    done
fi

ALL_DOMAINS=("${CORE_DOMAINS[@]}" "${EXTRA_ALLOWED_DOMAINS[@]}")

# ── Docker embedded DNS ──────────────────────────────────────────────
DOCKER_DNS="127.0.0.11"

# ── 1. Preserve Docker DNS NAT rules before flushing ─────────────────
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# ── 2. Restore Docker internal DNS NAT ───────────────────────────────
if [ -n "$DOCKER_DNS_RULES" ]; then
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
fi

# ── 3. Allow loopback, restricted DNS, and established connections ───
# Loopback (required for Docker DNS resolver and local services)
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# DNS restricted to Docker's embedded resolver ONLY (prevents DNS tunneling)
iptables -A OUTPUT -p udp --dport 53 -d "$DOCKER_DNS" -j ACCEPT
iptables -A INPUT  -p udp --sport 53 -s "$DOCKER_DNS" -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -d "$DOCKER_DNS" -j ACCEPT
iptables -A INPUT  -p tcp --sport 53 -s "$DOCKER_DNS" -j ACCEPT

# ── 4. Build allowed IP set ──────────────────────────────────────────
ipset create allowed-domains hash:net

# GitHub IP ranges (from their meta API) — retry with backoff
echo "Fetching GitHub IP ranges..."
gh_ranges=""
for attempt in 1 2 3; do
    if gh_ranges=$(curl -sf --connect-timeout 10 --max-time 30 https://api.github.com/meta); then
        break
    fi
    echo "  Attempt $attempt/3 failed, retrying in ${attempt}s..."
    sleep "$attempt"
done

if [ -z "$gh_ranges" ]; then
    echo "WARNING: Failed to fetch GitHub IP ranges after 3 attempts."
    echo "  GitHub access (git push/pull) will not work."
    # Degrade gracefully — don't abort the entire container
else
    if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null 2>&1; then
        echo "WARNING: GitHub meta response missing required fields (skipping)"
    else
        # aggregate -q: merges overlapping CIDRs into a minimal set (Debian 'aggregate' package)
        while read -r cidr; do
            [[ "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]] || continue
            ipset add allowed-domains "$cidr" 2>/dev/null || true
        done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)
    fi
fi

# Resolve and add each allowed domain
for domain in "${ALL_DOMAINS[@]}"; do
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        echo "WARNING: Failed to resolve $domain (skipping)"
        continue
    fi
    while read -r ip; do
        [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || continue
        ipset add allowed-domains "$ip" 2>/dev/null || true
    done < <(echo "$ips")
done

# NOTE: DNS is resolved once at startup. If CDN IPs rotate during a long
# session, connections may be blocked. Restart the container to re-resolve.

# ── 5. Allow Docker host gateway (restricted to gateway IP only) ─────
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -n "$HOST_IP" ]; then
    echo "Docker gateway: $HOST_IP"
    # Only the gateway IP — NOT the entire /24 subnet (prevents lateral movement)
    iptables -A INPUT  -s "$HOST_IP" -m state --state ESTABLISHED,RELATED -j ACCEPT
    iptables -A OUTPUT -d "$HOST_IP" -j ACCEPT
fi

# ── 6. Default-deny + allow only whitelisted egress ──────────────────
iptables -P INPUT   DROP
iptables -P FORWARD DROP
iptables -P OUTPUT  DROP

iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# SSH restricted to whitelisted IPs only (GitHub, not arbitrary hosts)
iptables -A OUTPUT -p tcp --dport 22 -m set --match-set allowed-domains dst -j ACCEPT

# HTTPS to whitelisted IPs
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# Reject everything else with immediate feedback (not silent DROP)
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

# ── 7. Verify ────────────────────────────────────────────────────────
echo "Verifying firewall..."

if curl --connect-timeout 5 -sf https://example.com >/dev/null 2>&1; then
    echo "  FAIL: example.com is reachable (firewall not working)"
    exit 1
fi
echo "  PASS: Blocked traffic (example.com unreachable)"

if ! curl --connect-timeout 5 -sf https://api.anthropic.com >/dev/null 2>&1; then
    echo "  WARN: api.anthropic.com unreachable (may need DNS retry)"
else
    echo "  PASS: Anthropic API reachable"
fi

if ! curl --connect-timeout 5 -sf https://github.com >/dev/null 2>&1; then
    echo "  WARN: github.com unreachable (git operations may fail)"
else
    echo "  PASS: GitHub reachable"
fi

echo "Firewall ready."
