const curl = require('../../shared/curl.js');

async function handle() {
  try {
    let metadata = await curl.request({ secure: false, hostname: '169.254.169.254', path: '/latest/dynamic/instance-identity/document' });
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