const curl = require('../curl.js');

function capitalize(input) {
  let output = '';
  for (let index = 0; index < input.length; index++) {
    if (index === 0 || input[index - 1] === ' ') {
      output += ('' + input[index]).toUpperCase();
    } else {
      output += input[index];
    }
  }
  return output;
}

async function getLocationMadamNazar() {
  let info = await curl.request({ method: 'GET', hostname: 'api.rdo.gg', path: '/nazar', cache: 60 });
  return {
    state: capitalize(info.state.substring(4).replace(/_/g, ' ')),
    location: capitalize(info.location.substring(4).replace(/_/g, ' ')),
    landmark: info.location !== info.landmark ? capitalize(info.landmark.substring(4).replace(/_/g, ' ')) : null
  };
}

async function getAllFreeRoamEvents() {
  let info = await curl.request({ method: 'GET', hostname: 'api.rdo.gg', path: '/events', cache: 60 });
  let events = [];
  for (let container of [ info.standard, info.themed ]) {
    for (let time in container) {
      let event = container[time];
      let hour = parseInt(time.substring(0, 2));
      let minute = parseInt(time.substring(3, 5));
      events.push({
        hour: hour,
        minute: minute,
        name: capitalize((event.alt ?? event.id).replace(/_/g, ' '))
      });
    }
  }
  return events;
}

async function getNextFreeRoamEvents(horizon) {
  let events = await getAllFreeRoamEvents();
  let filtered = [];
  let now = new Date().getTime();
  let timeHorizon = now + horizon * 60 * 60 * 1000;
  let progressInDay = now % (1000 * 60 * 60 * 24);
  for (let event of events) {
    let offsetInDay = (event.hour * 60 + event.minute) * 60 * 1000;
    let time = offsetInDay > progressInDay ? now + (offsetInDay - progressInDay) : (now - progressInDay + 1000 * 60 * 60 * 24 + offsetInDay);
    if (time >= timeHorizon) {
      continue;
    }
    filtered.push({
      distance: time - now,
      name: event.name
    });
  }
  filtered.sort((e1, e2) => e1.distance - e2.distance);
  return filtered;
}

async function getInformation(horizon) {
  let location = await getLocationMadamNazar();
  let events = await getNextFreeRoamEvents(horizon);
  let events_string = '';
  let first = true;
  for (let event of events) {
    if (event.name === 'Challenges') continue;
    if (first) {
      first = false;
    } else {
      events_string += ', ';
    }
    let distanceHours = Math.floor(event.distance / 1000 / 60 / 60 % 24);
    let distanceMinutes = Math.floor(event.distance / 1000 / 60 % 60);
    events_string += `**${event.name}**`
      + (distanceHours > 0 ? ` in ${distanceHours} hours` : '')
      + (distanceMinutes > 0 ? (distanceHours === 0 ? ' in' : '') + ` ${distanceMinutes} minutes` : '');
  }
  return {
    text: `Madam Nazar is at **${location.location}**, **${location.state}**` + (location.landmark ? ` near ${location.landmark}` : '') + '.' + ' '
      + `The next events are ${events_string}.` + ' '
      + 'Here is the general map https://jeanropke.github.io/RDOMap/ and the map for collectibles https://jeanropke.github.io/RDR2CollectorsMap/.'
  };
}

async function getEmergency(details, state, user_name) {
  if (state && state === 'Gunfighting') {
    // return user_name + ' is in a gunfight!';
    return null; // too many false psotives for now
  } else if (details && state && details.includes('Goods Delivery') && state === 'Defending') {
    return user_name + ' is selling goods and getting griefed!'
  } else {
    return null;
  }
}

module.exports = { getInformation, getEmergency }
