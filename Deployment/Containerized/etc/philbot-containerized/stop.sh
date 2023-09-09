#!/bin/bash
shard_count=$(bash /etc/philbot-containerized/shard_count.sh)
shard_container_names=$(echo discordgateway2http_$(seq -s " discordgateway2http_" 1 $(($RET-1))) discordgateway2http_0 | tr ' ' '\n' | sort -n -t _ -k 2 | tr '\n' ' ')
docker stop voice backend $shard_container_names scheduler
docker rm voice backend $shard_container_names scheduler
docker image prune -a --force
exit 0