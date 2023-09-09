#!/bin/bash
set -e
bash /etc/philbot-containerized/stop.sh || true
bash /etc/philbot-containerized/start.sh