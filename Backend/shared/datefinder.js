const curl = require('./curl.js');

async function findNext(start, day, hour, minute, timezone) {
  return curl.request({ hostname: 'worldtimeapi.org', path: '/api/timezone/' + timezone})
    .then(time => (time.raw_offset + (time.dst ? time.dst_offset : 0)) * 1000)
    .then(offset => {
      let next = new Date(start);
      next.setUTCHours(hour);
      next.setUTCMinutes(minute);
      next.setUTCSeconds(0);
      next.setUTCMilliseconds(0);
      next.setUTCSeconds(-offset / 1000);
      if (start.getUTCDay() === day && (start.getUTCHours() >= hour || (start.getUTCHours() === hour && start.getUTCMinutes() >= minute)))
        next = new Date(next.getTime() + 1000 * 60 * 60 * 24);
      while (next < start || next.getUTCDay() != day) {
        next = new Date(next.getTime() + 1000 * 60 * 60 * 24);
      }
      return next;
    });
}

module.exports = { findNext }
