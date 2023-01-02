const curl = require('../../shared/curl.js');

async function handle() {
  try {
    let response = await curl.request_simple({ secure: false, method: 'GET', hostname: '169.254.169.254', path: '/latest/dynamic/instance-identity/document', timeout: 100, fail_on_timeout: false, cache: 60 * 60 * 24 });
    if (response.status != 200) throw new Error('Not AWS');
    let metadata = JSON.parse(response.body); // they always respond with plain/text
    let link = `https://${metadata.region}.console.aws.amazon.com/ec2/home?region=${metadata.region}#InstanceDetails:instanceId=${metadata.instanceId}`;
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