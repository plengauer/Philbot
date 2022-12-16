const sdk = require('../shared/opentelemetry.js').create(context.service.version);
await sdk.start();
const opentelemetry = require('@opentelemetry/api');
const tracer = opentelemetry.trace.getTracer('autocode');

const memory = require('../shared/memory.js');
const discord = require('../shared/discord.js');
const permissions = require('../shared/permissions.js');

async function reportGuild(guild_id) {
  let guild = await discord.guild_retrieve(guild_id);
  let role = await memory.get(`notification:role:guild:${guild_id}`, null);
  let members = await discord.guild_members_list(guild_id);
  let members_to_notify = await discord.guild_members_list(guild_id, role);
  console.log('Guild ' + guild.name + ' (notifiable members: ' + members_to_notify.length + '/' + members.length + ')');
  for (let role of await discord.guild_roles_list(guild_id)) {
    console.log('Role ' + role.name + ' (' + members.filter(member => member.roles.includes(role.id)).length + '/' + members.length + '): ' + permissions.decompile(role.permissions).join(', '));
  }
}

async function report() {
  for (let guild of await discord.guilds_list()) {
    await reportGuild(guild.id);
  }
}

let span = tracer.startSpan('/report', { kind: opentelemetry.SpanKind.SERVER }, undefined);
return opentelemetry.context.with(opentelemetry.trace.setSpan(opentelemetry.context.active(), span), () => report())
  .finally(() => span.end())
  .finally(() => sdk.shutdown());