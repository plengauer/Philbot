#!/bin/bash
set -e
source /usr/bin/philbot_containerized_init_otel.sh
bash /usr/bin/philbot_containerized_stop.sh || true
bash /usr/bin/philbot_containerized_start.sh
