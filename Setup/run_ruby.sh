gem=$1
directory=$2
cd $directory &&
rm -rf gems &&
mkdir -p gems &&
gem install --install-dir=gems $gem
export $(cat environment.properties | tr ' ' '_' | tr '\n' ' ') &&
export SERVICE_VERSION= &&
ruby gems/gems/$gem-*/*.rb
