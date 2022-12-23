package=$1
directory=$2
cd $directory &&
npm install $package &&
npm update &&
eval $(cat environment.properties | awk '{print "export \"" $0 "\""}') &&
export SERVICE_VERSION=$(cat node_modules/$package/package.json | jq -r .version) &&
cd node_modules/$package &&
npm start
