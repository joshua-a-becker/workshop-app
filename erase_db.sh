IP_ADDRESS="161.35.167.139"
SSH_KEY_PATH="$HOME/.ssh/id_rsa"
BUNDLE_FILENAME="VideoChatApp.tar.zst"
REMOTE_USER="root" 

ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "$REMOTE_USER@$IP_ADDRESS" "mv .empirica/local/tajriba.json .empirica/local/tajriba.json.bak.\$(date +%Y%m%d%H%M%S) && sudo systemctl restart empirica"