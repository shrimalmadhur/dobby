#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="jarvis"
ENV_DIR="/etc/jarvis"
ENV_FILE="${ENV_DIR}/env"
PORT=7749

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }

# --- Check root ---
if [ "$EUID" -ne 0 ]; then
    red "Error: This script must be run with sudo"
    echo "Usage: sudo $0"
    exit 1
fi

ACTUAL_USER="${SUDO_USER:-$(whoami)}"

# --- Check prerequisites ---
echo "Checking prerequisites..."

if ! command -v node &>/dev/null; then
    red "Error: node is not installed"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    red "Error: Node.js >= 20 required (found v$(node -v))"
    exit 1
fi
green "  node $(node -v)"

if ! command -v pnpm &>/dev/null; then
    red "Error: pnpm is not installed"
    exit 1
fi
green "  pnpm $(pnpm -v)"

# --- Install dependencies and build ---
echo ""
echo "Installing dependencies..."
cd "$REPO_DIR"
sudo -u "$ACTUAL_USER" pnpm install --frozen-lockfile

echo ""
echo "Building for production..."
sudo -u "$ACTUAL_USER" pnpm build

# --- Copy static assets into standalone dir ---
echo ""
echo "Copying static assets..."
STANDALONE_DIR="$REPO_DIR/.next/standalone"

if [ ! -f "$STANDALONE_DIR/server.js" ]; then
    red "Error: Standalone build not found at $STANDALONE_DIR/server.js"
    red "Ensure next.config.ts has output: 'standalone'"
    exit 1
fi

# public/ directory (if it exists)
if [ -d "$REPO_DIR/public" ]; then
    cp -r "$REPO_DIR/public" "$STANDALONE_DIR/public"
fi

# .next/static/ directory
mkdir -p "$STANDALONE_DIR/.next"
cp -r "$REPO_DIR/.next/static" "$STANDALONE_DIR/.next/static"

# --- Create environment file ---
echo ""
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating environment file template at $ENV_FILE..."
    mkdir -p "$ENV_DIR"
    cat > "$ENV_FILE" << 'ENVEOF'
# Jarvis Environment Configuration
# Edit this file and restart the service: sudo systemctl restart jarvis

# Required
DATABASE_URL=
GEMINI_API_KEY=

# Optional - uncomment and set if using these providers
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
ENVEOF
    chown "$ACTUAL_USER:$ACTUAL_USER" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    yellow "  Created $ENV_FILE — you must fill in DATABASE_URL and GEMINI_API_KEY"
else
    green "  $ENV_FILE already exists, keeping existing configuration"
fi

# --- Install systemd service ---
echo ""
echo "Installing systemd service..."

# Generate service file with actual paths and user
sed -e "s|__USER__|$ACTUAL_USER|g" \
    -e "s|__REPO_DIR__|$REPO_DIR|g" \
    "$REPO_DIR/jarvis.service" > "/etc/systemd/system/${SERVICE_NAME}.service"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# --- Start service ---
echo ""
echo "Starting $SERVICE_NAME..."
systemctl start "$SERVICE_NAME"

sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
    green ""
    green "Jarvis is installed and running on port $PORT"
    green ""
    echo "Useful commands:"
    echo "  sudo systemctl status jarvis    # Check status"
    echo "  sudo systemctl restart jarvis   # Restart"
    echo "  sudo systemctl stop jarvis      # Stop"
    echo "  sudo journalctl -u jarvis -f    # Follow logs"
    echo ""
    if grep -q '^DATABASE_URL=$' "$ENV_FILE" 2>/dev/null; then
        yellow "Next step: Edit $ENV_FILE with your API keys, then restart:"
        yellow "  sudo systemctl restart jarvis"
    fi
else
    red "Service failed to start. Check logs:"
    red "  sudo journalctl -u jarvis -n 50"
fi
