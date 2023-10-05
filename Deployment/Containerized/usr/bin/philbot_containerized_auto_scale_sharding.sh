#!/bin/bash
set -e
source /usr/bin/philbot_containerized_init_otel.sh

source /opt/philbot/env
SHARD_COUNT_NEW=$(curl -s -H "authorization: Bot $DISCORD_API_TOKEN" "https://discord.com/api/v10/gateway/bot" | jq .shards)
if [ "$SHARD_COUNT" -eq "$SHARD_COUNT_NEW" ]; then
  exit 0
fi

shard_container_names=$(echo discordgateway2http_$(seq -s " discordgateway2http_" 0 $(($SHARD_COUNT-1))))
docker stop $shard_container_names
docker rm $shard_container_names

echo "SHARD_COUNT=$SHARD_COUNT_NEW" > /opt/philbot/env
bash /usr/bin/philbot_containerized_start.sh
