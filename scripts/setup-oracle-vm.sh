#!/bin/bash
# Oracle Cloud VM Setup Script for PolyBot
# Run this script on your Oracle Cloud VM after SSH-ing in

set -e

echo "=== PolyBot Oracle Cloud Setup ==="
echo ""

# Update system
echo "1. Updating system packages..."
sudo dnf update -y

# Install podman-compose
echo "2. Installing podman-compose..."
sudo dnf install -y podman-compose git

# Enable podman socket for compatibility
echo "3. Enabling podman socket..."
systemctl --user enable --now podman.socket

# Clone repository (if not exists)
echo "4. Setting up PolyBot..."
if [ ! -d ~/PolyBot ]; then
    echo "   Cloning repository..."
    git clone https://github.com/YOUR_USERNAME/PolyBot.git ~/PolyBot
else
    echo "   Repository already exists, pulling latest..."
    cd ~/PolyBot && git pull origin main
fi

cd ~/PolyBot

# Create .env file if not exists
if [ ! -f .env ]; then
    echo "5. Creating .env file from template..."
    cp .env.example .env
    echo ""
    echo "   IMPORTANT: Edit .env with your credentials:"
    echo "   nano ~/PolyBot/.env"
    echo ""
else
    echo "5. .env file already exists"
fi

# Create logs directory
mkdir -p logs

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit your .env file: nano ~/PolyBot/.env"
echo "2. Start the bot: cd ~/PolyBot && podman-compose up -d --build"
echo "3. Check logs: podman-compose logs -f polymarket-telebot"
echo ""
