#!/usr/bin/env bash
#
# Automated installer for Uptime Kuma on Debian-based systems.
#
# This script performs the following actions:
#   1. Installs prerequisite packages (curl, git, build tools).
#   2. Installs Node.js 20 LTS via the NodeSource repository if needed.
#   3. Clones the current repository into /opt/uptime-kuma (or updates it).
#   4. Installs production dependencies and builds the frontend assets.
#   5. Installs PM2 globally and configures Uptime Kuma to launch at boot.
#
# Usage:
#   sudo bash install-debian.sh
#
# The script is idempotent—re-running it will update the installation.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
    echo "This installer must be run as root (use sudo)." >&2
    exit 1
fi

INSTALL_DIR="/opt/uptime-kuma"
REPO_URL="https://github.com/louislam/uptime-kuma.git"
BRANCH="${BRANCH:-master}"
NODE_VERSION_REQUIRED="20"

log() {
    echo -e "\e[32m==>\e[0m $*"
}

install_prerequisites() {
    log "Updating apt cache and installing prerequisites"
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        git \
        build-essential \
        python3 \
        pkg-config
}

ensure_node_repo() {
    if command -v node >/dev/null 2>&1; then
        local major
        major=$(node -v | sed -E 's/^v([0-9]+).*/\1/')
        if (( major >= NODE_VERSION_REQUIRED )); then
            log "Node.js $(node -v) already installed"
            return
        fi
        log "Existing Node.js $(node -v) is too old; upgrading to Node ${NODE_VERSION_REQUIRED}."
    else
        log "Node.js not found; installing Node ${NODE_VERSION_REQUIRED}."
    fi

    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | \
        gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

    local codename
    codename=$(grep VERSION_CODENAME /etc/os-release | cut -d= -f2)
    if [[ -z "${codename}" ]]; then
        echo "Unable to determine Debian codename." >&2
        exit 1
    fi

    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION_REQUIRED}.x ${codename} main" \
        > /etc/apt/sources.list.d/nodesource.list

    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
}

clone_or_update_repo() {
    if [[ -d "${INSTALL_DIR}/.git" ]]; then
        log "Repository exists; pulling latest changes"
        git -C "${INSTALL_DIR}" fetch --all --tags
        git -C "${INSTALL_DIR}" reset --hard "origin/${BRANCH}"
    else
        log "Cloning repository into ${INSTALL_DIR}"
        rm -rf "${INSTALL_DIR}"
        git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
    fi
}

install_dependencies() {
    log "Installing production dependencies"
    cd "${INSTALL_DIR}"
    npm ci --omit=dev
    log "Building frontend assets"
    npm run build
}

configure_pm2() {
    log "Installing PM2 globally"
    npm install -g pm2

    log "Starting Uptime Kuma via PM2"
    cd "${INSTALL_DIR}"
    pm2 delete uptime-kuma >/dev/null 2>&1 || true
    pm2 start server/server.js --name uptime-kuma
    pm2 save

    log "Configuring PM2 to launch on boot"
    pm2 startup systemd -u "${SUDO_USER:-root}" --hp "/home/${SUDO_USER:-root}" || true
}

main() {
    install_prerequisites
    ensure_node_repo
    clone_or_update_repo
    install_dependencies
    configure_pm2

    log "Installation complete!"
    log "Uptime Kuma is now running on http://<server-ip>:3001"
    log "Use 'pm2 status' to check the process and 'pm2 logs uptime-kuma' for logs."
}

main "$@"
