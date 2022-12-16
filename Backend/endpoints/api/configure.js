async function handle() {
  return {
    status: 301,
    headers: { 'location': `https://discord.com/developers/applications/${process.env.DISCORD_CLIENT_ID}` },
    body: 'Moved Permanently'
  };
}

module.exports = { handle }