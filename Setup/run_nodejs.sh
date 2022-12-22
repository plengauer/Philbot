package=$1
directory=$2
cd $directory &&
npm install $package &&
npm update &&
export $(cat environment.properties | tr ' ' '_' | tr '\n' ' ') &&
export SERVICE_VERSION=$(cat node_modules/$package/package.json | jq -r .version) &&
cd node_modules/$package &&
npm start
