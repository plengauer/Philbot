async function handle() {
  return {
    status: 301,
    headers: { 'location': `https://github.com/plengauer/Philbot` },
    body: 'Moved Permanently'
  };
}