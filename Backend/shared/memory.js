const fs = require('fs');
const discord = require('./discord.js');

const directory = process.env.MEMORY_DIRECTORY;

async function clean() {
  return new Promise((resolve, reject) => fs.readdir(directory, (error, files) => error ? reject(error) : resolve(files)))
    .then(files => files.map(file => file.substring(file.lastIndexOf('/') + 1)))
    .then(keys => keys.map(key => read(key).catch(error => remove(key))))
    .then(promises => Promise.all(promises));
}

async function get(key, backup) {
  return read(key).then(entry => entry.value).catch(error => backup);
}

async function list(keys) {
  return Promise.all(keys.map(key => read(key).catch(error => null)))
    .then(entries => entries.filter(entry => !!entry));
}

async function set(key, value, ttl) {
  return write(entry(key, value, ttl));
}

async function fill(entries) {
  return Promise.all(entries.map(entry => write(entry)));
}

async function unset(key) {
  return remove(key).catch(error => undefined);
}

async function clear(keys) {
  return Promise.all(keys.map(key => unset(key)));
}

async function read(key) {
  return new Promise((resolve, reject) => fs.readFile(directory + '/' + key, 'utf-8', (error, content) => error ? reject(error) : resolve(JSON.parse(content))))
    .then(entry => entry.ttl && entry.timestamp + entry.ttl * 1000 < Date.now() ? Promise.reject(new Error('expired')) : Promise.resolve(entry));
}

async function write(entry) {
  return new Promise((resolve) => fs.writeFile(directory + '/' + entry.key, 'utf-8', () => resolve(entry.value)));
}

async function remove(key) {
  return new Promise((resolve, reject) => fs.unlink(directory + '/' + key, error => error ? reject(error) : resolve()));
}

async function consume(key, backup) {
  // return get(key, backup).then(value => unset(key).then(() => value));
  return list([ key ]).then(entries => entries.length == 0 ? backup : unset(entries[0].key).then(() => entries[0].value));
}

function entry(key, value, ttl) {
  return { key: key, value: value, ttl: ttl, timestamp: Date.now() };
}

function putInDictionary(dictionary, id, name) {
  if (dictionary[id]) {
    if (!dictionary[id].includes(name)) dictionary[id] = dictionary[id] + '/' + name;
  } else {
    dictionary[id] = name;
  }
}

async function fillDictionaryWithGuildChannels(dictionary, guild) {
  return discord.guild_channels_list(guild.id)
    .then(channels => channels.map(channel => putInDictionary(dictionary, channel.id, channel.name)));
}

async function fillDictionaryWithGuildMembers(dictionary, guild) {
  return discord.guild_members_list(guild.id)
    .then(members => members.map(member => {
      putInDictionary(dictionary, member.user.id, member.user.username + '#' + member.user.discriminator);
      if (member.nick) {
        putInDictionary(dictionary, member.user.id, member.nick);
      }
    }));
}

async function fillDictionaryWithGuildRoles(dictionary, guild) {
  return discord.guild_roles_list(guild.id)
    .then(roles => roles.map(role => putInDictionary(dictionary, role.id, role.name)));
}

async function fillDictionaryWithGuild(dictionary, guild) {
  return Promise.all([
    putInDictionary(dictionary, guild.id, guild.name),
    fillDictionaryWithGuildChannels(dictionary, guild),
    fillDictionaryWithGuildMembers(dictionary, guild),
    fillDictionaryWithGuildRoles(dictionary, guild),
  ]);
}

async function getDictionary() {
  let dictionary = {};
  await discord.guilds_list().then(guilds => Promise.all(guilds.map(guild => fillDictionaryWithGuild(dictionary, guild))));
  return dictionary;
}

async function toString(resolve, includes = [], excludes = []) {
  let dictionary = resolve ? (await getDictionary()) : {};
  let entries = await list();
  let count = 0;
  let result = '';
  for (let index = 0; index < entries.length; index++) {
    let entry = entries[index];
    let key = entry.key;
    let value;
    if (('' + entry.value).includes('[object Object]')) {
      value = JSON.stringify(entry.value);
    } else {
      value = '' + entry.value;
    }
    for (let id in dictionary) {
      let resolved = `${dictionary[id]}-${id}`;
      key = key.replace(id, resolved);
      value = value.replace(id, resolved);
    }
    let line = `${key}=${value}`;
    if (includes.every(include => line.includes(include)) && excludes.every(exclude => !line.includes(exclude))) {
      result += `\n${line}`;
      count++;
    }
  }
  return `[${count}]${result}`;
}

function mask(string) {
  return [
      hash(string, 7, 13),
      hash(string, 109, 59),
      hash(string, 37, 101),
      hash(string, 31, 89)
    ]
    .map(hash => Math.abs(hash))
    .map(hash => (hash).toString(16))
    .join('-');
}

function hash(string, p1, p2) {
  let hash = p1;
  for (let i = 0; i < string.length; i++) {
    hash = (hash * p2 + string.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return hash;
}

module.exports = { clean, get, list, set, fill, unset, clear, entry, consume, toString, mask }
