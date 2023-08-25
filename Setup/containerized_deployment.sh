BACKEND_PORT=8080
VOICE_PORT=12345
GATEWAY_PORT_BASE=8082
GATEWAY_MASTER_PORT=8081

current_shards() {
    echo $(sudo docker container ls -a --format {{.Names}} | sed 's/discordgateway2http//g' | sed 's/[^0-9]//g' | xargs)
}

current_shard_count() {
    echo $(cat environment.properties.discordgateway2http | grep SHARD_COUNT | sed 's/[^0-9]//g' | sed -n '1p') || echo 0
}

desired_shards() {
    if [ -z "$SHARDS" ]
    then
        export SHARDS="$(current_shards)"
    fi
    if [ -z "$SHARDS" ]
    then
        export SHARDS="0"
    fi
    echo $SHARDS
}

desired_shard_count() {
    if [ -z "$SHARD_COUNT" ]
    then
        export SHARD_COUNT="$(current_shard_count)"
    fi
    if [ -z "$SHARD_COUNT" ]
    then
        export SHARD_COUNT="1"
    fi
    echo $SHARD_COUNT
}

start() {
    name=$1
    sudo docker start $name
}

stop() {
    name=$1
    sudo docker stop $name
}

start_backend() { start backend; }
stop_backend() { stop backend; }

start_discordgateway2http() {
    for shard_index in $(current_shards)
    do
        start discordgateway2http_$shard_index || return 1
    done
}

stop_discordgateway2http() {
    for shard_index in $(current_shards)
    do
        stop discordgateway2http_$shard_index || return 1
    done
}

start_voice() { start voice; }
stop_voice() { stop voice; }

start_scheduler() { start scheduler; }
stop_scheduler() { stop scheduler; }

start_shardsmaster() { start shardsmaster; }
stop_shardsmaster() { stop shardsmaster; }

install() {
    name=$1
    image=$2
    sudo apt-get -y install docker docker.io &&
    sudo docker create \
        --name $name \
        --restart unless-stopped \
        --user $(id -u):$(id -g) \
        --network=host \
        --env-file environment.properties.$image \
        "${@:3}" \
        --init philipplengauer/philbot-$image:latest
}

uninstall() {
    name=$1
    sudo docker rm $name && sudo docker image prune -a --force
}

install_backend() {
    CONTAINER_MEMORY_DIRECTORY=memory
    HOST_MEMORY_DIRECTORY=.philbot_backend_$CONTAINER_MEMORY_DIRECTORY
    mkdir -p $HOST_MEMORY_DIRECTORY
    sudo apt-get -y install iptables-persistent &&
    sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080 &&
    sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port 4443 &&
    sudo bash -c 'iptables-save > /etc/iptables/rules.v4' &&
    install backend backend \
        --env PORT=$BACKEND_PORT \
        --env VOICE_PORT=$VOICE_PORT \
        --env MEMORY_DIRECTORY=/$CONTAINER_MEMORY_DIRECTORY \
        --mount type=bind,source=$(pwd)/$HOST_MEMORY_DIRECTORY,target=/$CONTAINER_MEMORY_DIRECTORY
}

uninstall_backend() { uninstall backend; }

install_discordgateway2http() {
    CONTAINER_SESSIONS_DIRECTORY=sessions
    HOST_SESSIONS_DIRECTORY=.philbot_discordgateway2http_$CONTAINER_SESSIONS_DIRECTORY
    mkdir -p $HOST_SESSIONS_DIRECTORY
    for shard_index in $(desired_shards)
    do
        install discordgateway2http_$shard_index discordgateway2http \
            --env SHARD_INDEX=$shard_index \
            --env SHARD_COUNT=$(desired_shard_count) \
            --env PORT=$(($GATEWAY_MASTER_PORT + $shard_index)) \
            --env STATE_STORAGE_DIRECTORY=/$CONTAINER_SESSIONS_DIRECTORY \
            --mount type=bind,source=$(pwd)/$HOST_SESSIONS_DIRECTORY,target=/$CONTAINER_SESSIONS_DIRECTORY \
        || return 1
    done
}

uninstall_discordgateway2http() {
    for shard_index in $(current_shards)
    do
        uninstall discordgateway2http_$shard_index || return 1
    done
}

install_voice() {
    CONTAINER_SESSIONS_DIRECTORY=sessions
    HOST_SESSIONS_DIRECTORY=.philbot_voice_$CONTAINER_SESSIONS_DIRECTORY
    CONTAINER_CACHE_DIRECTORY=audio_cache
    HOST_CACHE_DIRECTORY=.philbot_voice_$CONTAINER_CACHE_DIRECTORY
    mkdir -p $HOST_SESSIONS_DIRECTORY
    mkdir -p $HOST_CACHE_DIRECTORY
    install voice voice \
        --env PORT=$VOICE_PORT \
        --env STATE_STORAGE_DIRECTORY=/$CONTAINER_SESSIONS_DIRECTORY \
        --mount type=bind,source=$(pwd)/$HOST_SESSIONS_DIRECTORY,target=/$CONTAINER_SESSIONS_DIRECTORY \
        --env CACHE_DIRECTORY=/$CONTAINER_CACHE_DIRECTORY \
        --mount type=bind,source=$(pwd)/$HOST_CACHE_DIRECTORY,target=/$CONTAINER_CACHE_DIRECTORY
}

uninstall_voice() { uninstall voice; }

install_scheduler() {
    rm -rf ./config.properties.scheduler &&
    echo 'minutely=http://127.0.0.1:'$BACKEND_PORT'/scheduler/minutely' >> ./config.properties.scheduler &&
    echo 'hourly=http://127.0.0.1:'$BACKEND_PORT'/scheduler/hourly' >> ./config.properties.scheduler &&
    echo 'daily=http://127.0.0.1:'$BACKEND_PORT'/scheduler/daily' >> ./config.properties.scheduler &&
    echo 'monthly=http://127.0.0.1:'$BACKEND_PORT'/scheduler/monthly' >> ./config.properties.scheduler &&
    install scheduler scheduler \
        --env CONFIG_FILE=/config.properties \
        --mount type=bind,source=$(pwd)/config.properties.scheduler,target=/config.properties,readonly
}

uninstall_scheduler() { uninstall scheduler; }

install_shardsmaster() {
    install shardsmaster shardsmaster --env PORT=$GATEWAY_MASTER_PORT
}

uninstall_shardsmaster() { uninstall shardsmaster; }

command=$1
tiers=("${@:2}")

if [ -z "$command" ]
then
    echo "must specify a command (one of start, stop, install, redeploy, restart)"
    exit 1
fi
if [ "0" = "${#tiers[@]}" ]
then
    tiers=("backend" "discordgateway2http" "voice" "scheduler" "shardsmaster")
fi

if [ $command = "redeploy" ]
then
    bash $0 stop ${tiers[@]}
    bash $0 uninstall ${tiers[@]}
    bash $0 install ${tiers[@]} &&
    bash $0 start ${tiers[@]}
elif [ $command = "restart" ]
then
    bash $0 stop ${tiers[@]}
    bash $0 start ${tiers[@]}
elif [ $command = "start" ]
then
    for tier in "${tiers[@]}"
    do
        start_$tier || exit 1
    done
elif [ $command = "install" ]
then
    for tier in "${tiers[@]}"
    do
        install_$tier || exit 1
    done
elif [ $command = "uninstall" ]
then
    bash $0 stop ${tiers[@]} || exit 1
    for tier in "${tiers[@]}"
    do
        uninstall_$tier || exit 1
    done
elif [ $command = "stop" ]
then
    for tier in "${tiers[@]}"
    do
        stop_$tier || exit 1
    done
else
    echo "unknown command"
    exit 1
fi
