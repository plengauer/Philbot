const fs = require('fs');

function getAccountName() {
  return JSON.parse(fs.readFileSync('./stdlib.json')).name.split('/')[0];
}

function getProjectName() {
  return JSON.parse(fs.readFileSync('./stdlib.json')).name.split('/')[1];
}

function getRootURL() {
  let account = getAccountName();
  let project = getProjectName();
  return `https://${project}.${account}.autocode.gg`;
}

module.exports = { getAccountName, getProjectName, getRootURL }
