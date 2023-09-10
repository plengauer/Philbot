#!/bin/bash
set -e
bash /usr/bin/philbot_containerized_stop.sh || true
bash /usr/bin/philbot_containerized_start.sh