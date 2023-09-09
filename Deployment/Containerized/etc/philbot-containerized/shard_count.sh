#!/bin/bash
set -e
prefix=$1
. /usr/share/debconf/confmodule
db_get philbot-containerized/"$@"
echo $(echo $prefix_$(seq -s " $prefix_" 1 $(($RET-1))) "$prefix"_0 | tr ' ' '\n' | sort -n -t _ -k 2 | tr '\n' ' ')