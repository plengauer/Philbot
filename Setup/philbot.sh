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
    folder=$name
    package=$2
    technology=$3
    mkdir -p $folder &&
    cp -f -T environment.properties.$package ./$folder/environment.properties &&
    cat service.template | sed 's~$directory~'$(pwd)'\/'$folder'~g' | sed 's/$technology/'$technology'/g' | sed 's/$module/philbot-'$package'/g' > philbot_$name.service &&
    sudo mv philbot_$name.service /etc/systemd/system/ &&
    sudo systemctl daemon-reload
}

uninstall() {
    name=$1
    folder=$name
    rm -rf $folder &&
    sudo rm /etc/systemd/system/philbot_$name.service &&
    sudo systemctl daemon-reload
}

install_backend() {
    curl -fsSL https://deb.nodesource.com/setup_19.x | sudo -E bash - &&
    sudo apt-get -y install nodejs iptables-persistent &&
    sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080 &&
    sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j REDIRECT --to-port 4443 &&
    mkdir -p memory &&
    install backend backend node.js &&
    echo MEMORY_DIRECTORY=$(pwd)/memory/ >> ./backend/environment.properties &&
    echo HTTP_KEY_FILE=$(pwd)/server.key >> ./backend/environment.properties &&
    echo HTTP_CERT_FILE=$(pwd)/server.cert >> ./backend/environment.properties
}

uninstall_backend() {
    uninstall backend &&
    rm -rf memory
}

install_discordgateway2http() {
    curl -fsSL https://deb.nodesource.com/setup_19.x | sudo -E bash - &&
    sudo apt-get -y install nodejs ||
    return 1
    for shard_index in $(desired_shards)
    do
        install discordgateway2http_$shard_index discordgateway2http node.js &&
        echo SHARD_INDEX=$shard_index >> ./discordgateway2http_$shard_index/environment.properties &&
        echo SHARD_COUNT=$(desired_shard_count) >> ./discordgateway2http_$shard_index/environment.properties &&
        echo HTTP_KEY_FILE=$(pwd)/server.key >> ./discordgateway2http_$shard_index/environment.properties &&
        echo HTTP_CERT_FILE=$(pwd)/server.cert >> ./discordgateway2http_$shard_index/environment.properties &&
        echo STATE_STORAGE_DIRECTORY=$(pwd)/discordgateway2http_$shard_index/ >> ./discordgateway2http_$shard_index/environment.properties ||
        return 1
    done
}

uninstall_discordgateway2http() {
    for shard_index in $(current_shards)
    do
        uninstall discordgateway2http_$shard_index || return 1
    done
}

install_voice() {
    sudo apt-get -y install python3 python3-pip ffmpeg libopusfile0 &&
    wget -O libopus.tar.bz2 https://anaconda.org/anaconda/libopus/1.3/download/linux-64/libopus-1.3-h7b6447c_0.tar.bz2 &&
    install voice voice python &&
    tar -xf libopus.tar.bz2 -C voice/ &&
    echo LD_LIBRARY_PATH=$(pwd)/voice/lib/ >> ./voice/environment.properties &&
    echo HTTP_KEY_FILE=$(pwd)/server.key >> ./voice/environment.properties &&
    echo HTTP_CERT_FILE=$(pwd)/server.cert >> ./voice/environment.properties
    rm libopus.tar.bz2
}

uninstall_voice() { uninstall voice; }

install_scheduler() {
    sudo apt-get -y install ruby ruby-bundler &&
    cp -f -T config.properties.scheduler ./scheduler/config.properties &&
    install scheduler scheduler ruby &&
    echo CONFIG_FILE=$(pwd)/scheduler/config.properties >> ./scheduler/environment.properties
}

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
