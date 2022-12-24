directory=$1
technology=$2
module=$3
cd $directory &&
eval $(cat environment.properties | awk '{print "export \"" $0 "\""}') ||
exit $?
if [ $technology -eq "node.js" ]
then
    package=$module
    npm install $package &&
    npm update &&
    export SERVICE_VERSION=$(cat node_modules/$package/package.json | jq -r .version) &&
    cd node_modules/$package &&
    npm start
elif [ $technology -eq "ruby" ]
    gem=$module
    rm -rf gems &&
    mkdir -p gems &&
    gem install --install-dir=gems $gem &&
    export SERVICE_VERSION= &&
    ruby gems/gems/$gem-*/*.rb
then
    exit 1
fi