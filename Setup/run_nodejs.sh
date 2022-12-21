package=$1
directory=$2
cd $directory &&
npm install $package &&
npm update &&
export $(cat environment.properties | xargs) &&
export SERVICE_VERSION=dev &&
cd node_modules/$package &&
npm start
