const curl = require('./curl.js');

async function lookup(needle) {
  let response = await curl.request({ hostname: 'mashape-community-urban-dictionary.p.rapidapi.com', path: '/define?term=' + encodeURIComponent(needle), headers: { 'X-RapidAPI-Key': process.env.RAPID_API_TOKEN } });
  if (!response) return null; // nothing found
  let results = response.list;
  if (results.length == 0) return null; // nothing found
  // lets just assume the are sorted
  let result = results[0];
  if (result.thumbs_up - result.thumbs_down < 100) return null; // top entry doesnt seem very popular
  result.definition = result.definition.replace(/\[|\]/g, '');
  result.example = result.example.replace(/\[|\]/g, '');
  return result;
}

/*
{
"list": [
  {
    "definition": "A word used to [indicate] [excitement] or an epic moment. Comes from [Pogchamp].",
    "permalink": "http://pog.urbanup.com/14663337",
    "thumbs_up": 6763,
    "author": "R3Ked",
    "word": "Pog",
    "defid": 14663337,
    "current_vote": "",
    "written_on": "2020-01-29T00:31:49.254Z",
    "example": "[Wow], that [play] was [awesome]. Pog!",
    "thumbs_down": 669
  },
  {
    ...
  },
}
*/

module.exports = { lookup }
