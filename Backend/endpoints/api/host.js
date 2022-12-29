const curl = require('../../shared/curl.js');

async function handle() {
  try {
    let metadata = JSON.parse(await curl.request({ secure: false, method: 'GET', hostname: '169.254.169.254', path: '/latest/dynamic/instance-identity/document', cache: 60 * 60 * 24 })); // they always respond with plain/text
    let link = `https://${metadata.region}.console.aws.amazon.com/ec2-instance-connect/ssh?connType=standard&instanceId=${metadata.instanceId}&osUser=ubuntu&region=${metadata.region}&sshPort=22`;
    return {
      status: 302,
      headers: { 'location': link },
      body: 'Found'
    };
  } catch {
    return { status: 404, body: 'Not Found' };
  }
}

module.exports = { handle }