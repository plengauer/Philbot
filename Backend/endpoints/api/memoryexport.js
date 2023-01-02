const memory = require('../../shared/memory.js');
const Zip = require('jszip');

async function handle() {
  let zip = new Zip();
  for (let entry of await memory.list()) {
    if (!entry.ttl) continue;
    zip.file(entry.key.replace(/:/g, '_') + '.json', JSON.stringify(entry));
  }
  return zip.generateAsync({ type: "nodebuffer" }).then(buffer => buffer).then(content => {
    return { status: 200, headers: { 'content-type': 'application/zip' }, body: content };
  });
}  

module.exports = { handle };