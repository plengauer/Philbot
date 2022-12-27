directory=$1
technology=$2
module=$3
cd $directory &&
eval $(cat environment.properties | awk '{print "export \"" $0 "\""}') ||
exit $?
if [ $technology = "node.js" ]
then
    package=$module
    ([ -e node_modules/ ] || npm install $package) &&
    npm update &&
    export SERVICE_VERSION=$(cat node_modules/$package/package.json | jq -r .version) &&
    npm --prefix node_modules/$package start
elif [ $technology = "ruby" ]
then
    gem=$module
    rm -rf gems &&
    mkdir -p gems &&
    gem install --install-dir=gems $gem &&
    pushd gems/gems/$gem-*/ && bundle install && popd &&
    export SERVICE_VERSION= &&
    ruby gems/gems/$gem-*/lib/*.rb
else
    exit 1
fi