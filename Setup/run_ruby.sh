gem=$1
directory=$2
cd $directory &&
rm -rf gems &&
mkdir -p gems &&
gem install --install-dir=gems $gem &&
eval $(cat environment.properties | awk '{print "export \"" $0 "\""}') &&
export SERVICE_VERSION= &&
ruby gems/gems/$gem-*/*.rb
