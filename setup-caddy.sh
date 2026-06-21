#!/bin/bash

# Caddy HTTPS Setup Script
# Run this ON the server (157.245.212.151)

set -e

echo "Setting up Caddy reverse proxy..."

# Install Caddy
apt update
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install caddy

# Create Caddyfile
cat > /etc/caddy/Caddyfile << 'EOF'
platform.negotiation.education {
    reverse_proxy localhost:3000
}
EOF

# Reload Caddy
systemctl reload caddy
systemctl enable caddy

