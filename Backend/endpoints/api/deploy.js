async function handle() {
  return {
    status: 301,
    headers: { 'location': `/invite` },
    body: 'Moved Permanently'
  };
}

module.exports = { handle }