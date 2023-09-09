#!/bin/bash
set -e
. /usr/share/debconf/confmodule
db_get philbot-containerized/SHARD_COUNT
echo "$RET"