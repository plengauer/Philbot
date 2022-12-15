const fs = require('fs');

async function getInformation(ghost) {
  let text = ('' + fs.readFileSync('./shared/games/phasmophobia.txt'));
  let sections = text.split('\n\n').map(section => section.trim());
  if (ghost) {
    if (ghost === 'all') {
      return { text: sections.join('\n\n') };
    }
    if (ghost.endsWith('s')) ghost = ghost.substring(0, ghost.length - 1);
    for (let section of sections) {
      if (section.toLowerCase().includes('**' + ghost.toLowerCase() + '**') || section.toLowerCase().includes('**' + ghost.toLowerCase() + 's**'))
        return { text: section };
    }
    return { text: 'I don\'t know anything about ' + ghost + '.' };
  } else {
    return { text: sections[Math.floor(Math.random() * sections.length)] };
  }
}

module.exports = { getInformation }

















