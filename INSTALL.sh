#!/bin/sh
set -e
echo "deb [arch=all] http://philbot.eu:8000/ stable main" | sudo tee /etc/apt/sources.list.d/philbot.list
sudo apt-get update --allow-insecure-repositories
sudo apt-get install -y --allow-unauthenticated philbot
