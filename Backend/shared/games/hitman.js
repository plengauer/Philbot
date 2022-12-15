
async function getInformation(descriptor) {
  let f = 0;
  let t = f + 1;
  while (t < descriptor.length && !isNaN(descriptor.substring(f, t))) t++;
  if (t < descriptor.length) t--;
  let version = parseInt(descriptor.substring(f, t));
  if (isNaN(version)) version = 1;
  switch (version) {
    case 1: return { text: 'Here is the map: https://www.hitmaps.com/games/hitman.' };
    case 2: return { text: 'Here is the map: https://www.hitmaps.com/games/hitman2.' };
    case 3: return { text: 'Here is the map: https://www.hitmaps.com/games/hitman3.' };
    return null;
  }
}

module.exports = { getInformation }

















