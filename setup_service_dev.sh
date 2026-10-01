#!/bin/bash

# Configuration - UPDATE THESE VALUES
USERNAME="root"
WORKING_DIR="/root"
BUNDLE_FILENAME="VideoChatApp.tar.zst"
EMPIRICA_PATH="/usr/local/bin/empirica"  

echo "Setting up Empirica as a systemd service..."

# Create the service file
echo "Creating service file..."
sudo tee /etc/systemd/system/empirica.service > /dev/null <<EOF
[Unit]
Description=Empirica Server
After=network.target

[Service]
Type=simple
User=$USERNAME
WorkingDirectory=$WORKING_DIR
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
ExecStart=$EMPIRICA_PATH serve $BUNDLE_FILENAME
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=empirica

[Install]
WantedBy=multi-tier.target
EOF

# Reload systemd
echo "Reloading systemd daemon..."
sudo systemctl daemon-reload

# Enable the service
echo "Enabling empirica service..."
sudo systemctl enable empirica

# Start the service
echo "Starting empirica service..."
sudo systemctl start empirica

# Wait a moment for startup
sleep 2

# Check status
echo ""
echo "Service status:"
sudo systemctl status empirica --no-pager

echo ""
echo "Setup complete!"
echo ""
echo "Useful commands:"
echo "  Check status:  sudo systemctl status empirica"
echo "  View logs:     sudo journalctl -u empirica -f"
echo "  Restart:       sudo systemctl restart empirica"
echo "  Stop:          sudo systemctl stop empirica"
echo "  Disable:       sudo systemctl disable empirica"