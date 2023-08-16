current_shards() {
    echo $(ls /etc/systemd/system/philbot_discordgateway2http_*.service | sed 's/discordgateway2http//g' | sed 's/[^0-9]//g' | xargs)
}

current_shard_count() {
    echo $(cat discordgateway2http_*/environment.properties | grep SHARD_COUNT | sed 's/[^0-9]//g' | sed -n '1p') || echo 0
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
    sudo systemctl enable philbot_$name &&
    sudo systemctl start philbot_$name
}

stop() {
    name=$1
    sudo systemctl stop philbot_$name || return 0
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

install() {
    name=$1
    tier=$2
    sudo apt-get -y install docker &&
    cat service.template | sed 's~$command~\/usr\/bin\/bash '$(pwd)'\/containerized_run_'$tier'.sh~g' > philbot_$name.service &&
    sudo mv philbot_$name.service /etc/systemd/system/ &&
    sudo systemctl daemon-reload
}

uninstall() {
    name=$1
    sudo rm /etc/systemd/system/philbot_$name.service &&
    sudo systemctl daemon-reload
}

install_backend() {
    sudo apt-get -y install iptables-persistent &&
    sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080 &&
    sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port 4443 &&
    install backend backend
}

uninstall_backend() { uninstall backend; }

install_discordgateway2http() {
    for shard_index in $(desired_shards)
    do #TODO
        install discordgateway2http_$shard_index discordgateway2http || return 1
    done
}

uninstall_discordgateway2http() {
    for shard_index in $(current_shards)
    do
        uninstall discordgateway2http_$shard_index || return 1
    done
}

install_voice() { install voice voice; }
uninstall_voice() { uninstall voice; }

install_scheduler() { install scheduler scheduler; }
uninstall_scheduler() { uninstall scheduler; }

command=$1
tiers=("${@:2}")

if [ -z "$command" ]
then
    echo "must specify a command (one of start, stop, install, redeploy, restart)"
    exit 1
fi
if [ "0" = "${#tiers[@]}" ]
then
    tiers=("backend" "discordgateway2http" "voice" "scheduler")
fi

if [ $command = "redeploy" ]
then
    bash $0 stop ${tiers[@]} &&
    bash $0 uninstall ${tiers[@]} &&
    bash $0 install ${tiers[@]} &&
    bash $0 start ${tiers[@]}
elif [ $command = "restart" ]
then
    bash $0 stop ${tiers[@]} &&
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
