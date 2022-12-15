
function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

async function getInformation() {
  if (Math.random() < 0.99) return null;
  switch(getRandomInt(3)) {
    case 0: return { text: "Use WASD to move." };
    case 1: return { text: "Try keeping your health above zero." };
    case 2: return { text: "Not dying increases your chance of winning." };
    default: return null;
  };
}

module.exports = { getInformation }