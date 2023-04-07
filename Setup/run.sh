directory=$1
technology=$2
module=$3
lock_file=$(pwd)/.install_lock
touch $lock_file &&
cd $directory &&
eval $(cat environment.properties | awk '{print "export \"" $0 "\""}') ||
exit $?
if [ $technology = "node.js" ]
then
    package=$module
    ([ -e node_modules/ ] || flock $lock_file npm install $package) &&
    flock $lock_file npm update &&
    export SERVICE_VERSION=$(cat node_modules/$package/package.json | jq -r .version) &&
    exec npm --prefix node_modules/$package run-script exec-start
elif [ $technology = "ruby" ]
then
    gem=$module
    rm -rf gems &&
    mkdir -p gems &&
    flock $lock_file gem install --install-dir=gems $gem &&
    pushd gems/gems/$gem-*/ && flock $lock_file bundle install && popd &&
    export SERVICE_VERSION= &&
    exec ruby gems/gems/$gem-*/lib/*.rb
elif [ $technology = "python" ]
then
    package=$module
    flock $lock_file pip3 install $package --upgrade &&
    export PYTHONPATH=$(find ~/.local/lib/python*/site-packages/$package -prune | tr '\n' ':') &&
    export SERVICE_VERSION=$(pip show $package | grep Version | cut -d':' -f2 | sed 's/ //g') &&
    exec ~/.local/bin/opentelemetry-instrument python3 -u -m $package
else
    exit 1
fi
