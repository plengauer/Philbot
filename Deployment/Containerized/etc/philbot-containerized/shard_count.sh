#!/bin/bash
set -e
prefix=$1
. /usr/share/debconf/confmodule
db_get philbot-containerized/"$@"
echo "$RET"