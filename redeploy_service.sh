#!/bin/bash

# Empirica Deployment Script
# Hard-coded for this project

source ./server_settings.sh

# don't overwrite the remote treament [does overwrite local!]
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "$REMOTE_USER@$IP_ADDRESS:/root/.empirica/treatments.yaml" .empirica/treatments.yaml

echo "Deploying to $IP_ADDRESS..."

# Bundle the application
cp VideoChatApp.tar.zst "VideoChatApp.tar.zst.$(date +%Y%m%d%H%M)"
empirica bundle

# Transfer bundle to server
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "$BUNDLE_FILENAME" "$REMOTE_USER@$IP_ADDRESS:~/"

# restart service
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "$REMOTE_USER@$IP_ADDRESS" "sudo systemctl restart empirica && sudo systemctl status empirica"