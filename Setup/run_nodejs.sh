package=$1
directory=$2
cd $directory &&
npm install $package &&
npm update &&
export $(cat environment.properties | xargs) &&
export SERVICE_VERSION=$(cat node_modules/$package | jq -r .version) &&
cd node_modules/$package &&
npm start
