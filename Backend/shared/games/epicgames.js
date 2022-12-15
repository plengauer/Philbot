const epic_free_games = require('epic-free-games');

async function getInformation() {
  let result = await epic_free_games.getGames();
  let currents = result.currentGames.map(game => game.title);
  let nexts = result.nextGames.map(game => game.title);
  return {
    text: 'Current free games on Epic Games Store are '
      + currents.map(title => '**' + title + '**').join(', ')
      + ' and the next games are '
      + nexts.join(', ')
      + '.'
  };
}

module.exports = { getInformation }
