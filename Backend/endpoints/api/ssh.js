const curl = require('../../shared/curl.js');
const identity = require('../../shared/identity.js');

async function handle() {
  try {
    let response = await curl.request({ secure: false, method: 'GET', hostname: '169.254.169.254', path: '/latest/dynamic/instance-identity/document', timeout: 100, fail_on_timeout: false, cache: 60 * 60 * 24 });
    if (response.status != 200) throw new Error('Not AWS');
    let metadata = JSON.parse(response.body); // they always respond with plain/text
    let link = `https://${metadata.region}.console.aws.amazon.com/ec2-instance-connect/ssh?connType=standard&instanceId=${metadata.instanceId}&osUser=ubuntu&region=${metadata.region}&sshPort=22`;
    return {
      status: 302,
      headers: { 'location': link },
      body: 'Found'
    };
  } catch {
    let url = await identity.getPublicURL();
    url = url.substring(url.indexOf('://') + 3);
    return { status: 200, body: `ssh -p 22 user@${url}` };
  }
}

module.exports = { handle }