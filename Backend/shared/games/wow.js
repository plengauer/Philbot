const curl = require('../curl.js');
const memory = require('../memory.js');
const datefinder = require('../datefinder.js');

const JOKES = [
"Why do taurens make the best rogues? They are made of hide.",
"What do you call a group of paladins protesting? A crusader strike.",
"What do you call a bunch of paladins in a jacuzzi? A bubble bath.",
"How many rogues do you need to kill a paladin? Two, one to proc the bubble and the other to wait in the inn.",
"What is the opposite of a Death Knight? A birthday.",
"What do you call it if the group wipes except for the Death Knight? Death and DK.",
"What do you call the raid leader who mains mage? The mana-ger.",
"Why are mages so polite? They have lots of manas.",
"Where does the lich king keep his armies? Up his sleevies.",
"How do you get a dwarf on the roof? Tell him the beer is on the house.",
"What does Anduin wear when going for a walk? His high king boots.",
"What do you call a gnome priest? A compact disc.",
"How did Varian Wrynn die? He fel apart.",
"What does a mechagnome do on a one night stand? He nuts and bolts.",
"What do you call a tauren demon hunter? Illidairy.",
"Why do Demon hunters love the gym? Lord Illidan knows the whey.",
"Why do monks suck at healing? Because the healing mist.",
"Whats a windwalkers favourite pizza? Pepperoni with extra chi's.",
"What did the monk say when his tiger died? Too xuen.",
"Did you hear about the Jewish monk? He was a hebrewmaster.",
"Why do new feral druids suck at tinder? They don't know how to swipe right.",
"What do you call a resto druid that insists on raiding in melee? A combat log.",
"What do you call a sleepy boomkin? A napkin.",
"What do you call a bunch of druids in a jacuzzi? A moonwell.",
"Whats the bis feet for rogues? Sneakers.",
"You know how the priest class mount is an owl? Does that make it a bird of pray?",
"Did you know mages never sleep? They only know how to blink more slowly.",
"Where do you go to pick up hot night elves? Darnassus.",
"Why did the nightelven comedy club fail? Nightelves aren't fond of satyr."
];

function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

async function getJoke() {
  return JOKES[getRandomInt(JOKES.length)];
}

async function getAffixByID(id) {
  switch (id) {
    case 3: return "Volcanic";
    case 4: return "Necrotic";
    case 6: return "Raging";
    case 7: return "Bolstering";
    case 8: return "Sanguine";
    case 9: return "Tyrannical";
    case 10: return "Fortified";
    case 11: return "Bursting";
    case 12: return "Grievous";
    case 13: return "Explosive";
    case 14: return "Quaking";
    case 122: return "Inspiring";
    case 123: return "Spiteful";
    case 124: return "Storming";
    case 130: return "Encrypted";
    case 131: return "Shrouded";
    case 132: return "Thundering";
    default: return curl.request_simple({ method: 'GET', hostname: 'www.wowhead.com', path: '/affix=' + id, cache: 60 * 60 * 24 })
      .then(response => {
        if (!(300 <= response.status && response.status < 400)) throw new Error();
        if (!response.headers['location']) throw new Error();
        let affix = response.headers['location'];
        if (!affix.startsWith('/')) throw new Error();
        affix = affix.substring(1);
        if (!affix.includes('/')) throw new Error();
        affix = affix.substring(affix.indexOf('/') + 1);
        if (affix.includes('/')) throw new Error();
        affix = affix.substring(0, 1).toUpperCase() + affix.substring(1).toLowerCase();
        return affix;
      })
      .catch(error => "Unknown");
  }
}

const ROLLOVER_CYCLE = 1000 * 60 * 60 * 24 * 7;

async function findRollover(start) {
  // http://wowreset.com/
  return datefinder.findNext(start, 3, 8, 0, 'Europe/London');
}

async function getInformation(config) {
  let dates;
  if (config && config.length > 0) {
    dates = [];
    for (let part of config.split(' ')) {
      if (part === '') {
        continue;
      } else if (part === 'current') {
        dates.push(new Date());
      } else if (part === 'next') {
        dates.push(new Date(new Date().getTime() + ROLLOVER_CYCLE));
      } else if (part.startsWith('+')) {
        dates.push(new Date(new Date().getTime() + parseInt(part.substring(1)) * ROLLOVER_CYCLE));
      } else if (part.includes('.')) {
        let index = part.indexOf('.');
        let day = parseInt(part.substring(0, index));
        let month = parseInt(part.substring(index + 1, part.length));
        let date = new Date();
        while(!(date.getUTCMonth() == month -1 && date.getDate() == day)) date = new Date(date.getTime() + 1000 * 60 * 60 * 24);
        dates.push(date);
      } else {
        return {
          text: 'I do not understand \'' + part + '\'.',
          ttl: 1
        };
      }
    }
  } else {
    dates = [ new Date(), new Date(new Date().getTime() + ROLLOVER_CYCLE) ];
  }
  
  let affixes = [];
  let page = await curl.request({ method: 'GET', hostname: 'wowaffixes.info', headers: { 'accept': 'text/html' }, cache: 60 });
  // <h2>+6 Week</h2>
  // <a href="https://en.wowhead.com/affix=9/" class="affixes affixes-9"></a><br />
  let index = -1;
  for (let line of page.split('\n')) {
    line = line.toLowerCase().trim();
    if (line.includes('this week')) index = 0;
    if (line.includes('next week')) index = 1;
    if (line.includes('+2 week')) index = 2;
    if (line.includes('+3 week')) index = 3;
    if (line.includes('+4 week')) index = 4;
    if (line.includes('+5 week')) index = 5;
    if (line.includes('+6 week')) index = 6;
    if (line.includes('+7 week')) index = 7;
    if (line.includes('+8 week')) index = 8;
    if (index < 0 || !line.includes('https://en.wowhead.com/affix=')) continue;
    while(affixes.length <= index) affixes.push([]);
    let f = line.indexOf('<a href="') + '<a href="'.length;
    let t = line.indexOf('"', f);
    
    let link = line.substring(f, t);
    let id = link.substring(link.indexOf('=') + 1, link.length - 1);
    let name = await getAffixByID(Number(id));
    
    affixes[index].push({id: id, name: name, link: link});
  }
  
  let rollover = await findRollover(new Date());
  
  let lastrollover = await findRollover(new Date((new Date().getTime()) - ROLLOVER_CYCLE));
  let indizes = [];
  for (let date of dates) {
    if (date.getTime() < lastrollover.getTime()) {
      indizes.push(-1);
      continue;
    }
    let index = 0;
    // every time i see a loop that just counts has arithmetic in its condition, i think i can probably just calculate
    // but fuck it, this is easier
    while (date.getTime() - ROLLOVER_CYCLE > lastrollover.getTime() + index * ROLLOVER_CYCLE) index++;
    indizes.push(index);
  }
  let text = '';
  for (let i = 0; i < indizes.length; i++) {
    let index = indizes[i];
    let date = dates[i];
    let dateTo = await findRollover(date);
    let dateFrom = new Date(dateTo.getTime() - ROLLOVER_CYCLE);
    let timeText;
    let affixesText;
    if (index < 0) timeText = 'previous';
    else if (index == 0) timeText = 'this';
    else if (index == 1) timeText = 'next';
    else timeText = '+' + index;
    if (index >= 0 && index < affixes.length && index == 0) affixesText = affixes[index].map(a => '**' + a.name + '**').join(', ');
    else if (index >= 0 && index < affixes.length) affixesText = affixes[index].map(a => a.name).join(', ');
    else affixesText = 'my best guess';
    text += ''
      + (i == 0 ? (timeText.substring(0, 1).toUpperCase() + timeText.substring(1)) : (', ' + timeText)) + ' week\'s ('
      + dateFrom.getUTCDate() + '.' + (dateFrom.getUTCMonth() + 1) + ' - ' + dateTo.getUTCDate() + '.' + (dateTo.getUTCMonth() + 1)
      + ') affixes are ' + affixesText
      + (i == indizes.length - 1 ? '.' : '');
  }
  return {
    text: text,
    ttl: Math.floor((rollover.getTime() - new Date().getTime()) / 1000)
  }
}

module.exports = { getInformation, getJoke }
