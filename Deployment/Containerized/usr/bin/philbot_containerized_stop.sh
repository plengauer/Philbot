#!/bin/bash
source /opt/philbot/env
shard_container_names=$(echo discordgateway2http_$(seq -s " discordgateway2http_" 0 $(($SHARD_COUNT-1))))
docker stop voice backend $shard_container_names scheduler
docker rm voice backend $shard_container_names scheduler
docker image prune -a --force
exit 0
