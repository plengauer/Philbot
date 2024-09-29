const process = require('process');
const stream = require('stream');
const url = require('url');
const memory = require('./memory.js');
const synchronized = require('./synchronized.js');
const curl = require('./curl.js');
const media = require('./media.js');
let FormData = require('form-data');

const token = process.env.OPENAI_API_TOKEN;

function getCostLimit() {
  return token ? parseFloat(process.env.OPENAI_COST_LIMIT ?? '1.00') : 0;
}

function isSameBillingSlot(t1, t2) {
  return  t1.getUTCFullYear() == t2.getUTCFullYear() && t1.getUTCMonth() == t2.getUTCMonth();
}

function computeBillingSlotProgress() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const totalDaysInMonth = endOfMonth.getDate() - startOfMonth.getDate() + 1;
  const millisSinceStartOfMonth = now.getTime() - startOfMonth.getTime();
  return millisSinceStartOfMonth / (totalDaysInMonth * 1000 * 60 * 60 * 24);
}

async function getLanguageModels() {
  let models = await getModels();
  models = models.filter(model => (model.match(/text-[a-zA-Z]+(:|-)\d\d\d$/) || model.match(/gpt-*/)) && !model.match(/-\d{4}$/) && !model.match(/-\d{4}-/) && !model.match(/-\d*k/) && !model.includes('preview') && !model.includes('mini') && !model.startsWith('chatgpt-'));
  models = Array.from(new Set(models));
  models = models.sort((m1, m2) => {
    let p1 = getModelPower(m1);
    let p2 = getModelPower(m2);
    return (p1 != p2) ? p1 - p2 : m1.localeCompare(m2);
  });
  return models;
}


function isLanguageCompletionModel(model) {
  return !isLanguageChatModel(model);
}

function isLanguageChatModel(model) {
  return model.startsWith('gpt-') && !model.endsWith('-instruct')
}

async function isVisionLanguageModel(model) {
  return model.includes('vision') || getModelPower(model) >= getModelPower('gpt-4-turbo');
}

function compareLanguageModelByCost(cheap_model, expensive_model) {
  return computeLanguageCost(cheap_model, 1, 1) < computeLanguageCost(expensive_model, 1, 1);
}

function compareLanguageModelByPower(bad_model, good_model) {
  return getModelPower(bad_model) < getModelPower(good_model);
}

async function createCompletion(model, user, prompt, report, temperature = undefined) {
  if (!token) return null;
  
  if (!isLanguageCompletionModel(model)) {
    return createResponse(model, user, null, null, `Complete the following text, respond with the completion only:\n${prompt}`, null, report, temperature);
  }
  
  let response = await HTTP('/v1/completions' , { user: user, "model": model, "prompt": prompt, temperature: temperature, max_tokens: 1024 });
  let completion = response.choices[0].text.trim();
  await report(response.model, computeLanguageCost(response.model, response.usage.prompt_tokens, response.usage.completion_tokens));
  return completion;
}

async function createResponse(model, user, history_token, system, message, attachments, report, temperature = undefined) {
  if (history_token) return synchronized.locked(`chatgpt:${history_token}`, () => createResponse0(model, user, history_token, system, message, attachments, report, temperature));
  else return createResponse0(model, user, history_token, system, message, attachments, report, temperature);
}

async function createResponse0(model, user, history_token, system, message, attachments, report, temperature = undefined) {
  // https://platform.openai.com/docs/guides/chat/introduction
  if (!token) return null;

  const horizon = 5;
  const conversation_key = history_token ? `chatgpt:history:${history_token}` : null;
  let conversation = (conversation_key ? await memory.get(conversation_key, []) : []).slice(-(2 * horizon + 1));

  for (let item of conversation) {
    if (!Array.isArray(item.content)) continue;
    for (let content of item.content.filter(content => content.type == 'image_url')) {
      let uri = url.parse(content.image_url.url);
      try {
        await curl.request({ method: 'HEAD', secure: uri.protocol == 'https', hostname: uri.hostname, path: uri.path, query: uri.query });
      } catch {
        item.content = item.content.filter(content => content.type != 'image_url');
      }
    }
  }

  let input = { role: 'user', content: attachments && attachments.length > 0 ? [{ type: "text", text: message.trim() }] : message.trim() };
  for (let attachment of attachments ?? []) {
    if (attachment.content_type.startsWith('image/')) {
      let format = attachment.content_type.split('/')[1];
      let image_url = null;
      if ([ 'png', 'jpeg', 'webp', 'gif' ].includes(format)) {
        image_url = attachment.url;
      } else {
        let uri = url.parse(attachment.url);
        let stream = media.convert(await curl.request({ method: 'GET', hostname: uri.hostname, path: uri.path, query: uri.query, stream: true }), format, 'png');
        let chunks = [];
        image_url = 'data:image/png;base64,' + await new Promise((resolve, reject) => {
          stream.on('error', error => reject(error));
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        });
      }
      input.content.push({ type: 'image_url', image_url: { url: image_url } });
    } else {
      // ignore
    }
  }
  conversation.push(input);
  
  let output = null;
  if (!isLanguageChatModel(model)) {
    let completion = await createCompletion(model, user, `Complete the conversation with exactly one additional response.` + (system ? `\nassistant: "${system}"` : '') + '\n' + conversation
        .map(line => { return { role: line.role, content: typeof line.content == 'string' ? line.content : line.content.find(content => content.type == 'text' ).text }; })
        .map(line => `${line.role}: "${line.content}"`).join('\n') + '\nassistant: ',
      report, temperature);
    if (completion.startsWith('"') && completion.endsWith('"')) completion = completion.substring(1, completion.length - 1);
    output = { role: 'assistant', content: completion.trim() };
  } else {
    let response = await HTTP('/v1/chat/completions' , { user: user, "model": model, "messages": [{ "role": "system", "content": (system ?? '').trim() }].concat(
      isVisionLanguageModel(model) ? conversation :
        conversation.map(line => { return { role: line.role, content: typeof line.content == 'string' ? line.content : line.content.find(content => content.type == 'text' ).text }; })
      ), temperature: temperature, max_tokens: model.includes('preview') ? 4096 : undefined });
    output = response.choices[0].message;
    await report(response.model, computeLanguageCost(response.model, response.usage.prompt_tokens, response.usage.completion_tokens));
  }
  output.content = sanitizeResponse(output.content);

  conversation.push(output);
  if (conversation_key) await memory.set(conversation_key, conversation, 60 * 60 * 24 * 7);

  return output.content;
}

function sanitizeResponse(response) {
  response = strip(response, 'as an AI');
  response = strip(response, 'as an AI model');
  response = strip(response, 'as an AI language model');
  response = strip(response, 'as a language model AI');
  response = strip(response, 'as a responsible AI');
  response = strip(response, 'as a responsible AI model');
  response = strip(response, 'as a responsible AI language model');
  response = strip(response, 'as a responsible language model AI');
  response = strip(response, 'based on your previous message');
  response = strip(response, 'based on what you\'ve shared earlier');
  response = strip(response, 'based on the information available in previous messages');
  response = strip(response, 'based on the information you provided earlier');
  response = strip(response, 'based on information available in previous messages');
  response = strip(response, 'based on information you provided earlier');
  return response.trim();
}

function strip(haystack, needle) {
  {
    let myneedle = needle.substring(0, 1).toUpperCase() + needle.substring(1) + ', ';
    while (haystack.includes(myneedle)) {
      let index = haystack.indexOf(myneedle);
      haystack = haystack.substring(0, index) + haystack.substring(index + myneedle.length, index + myneedle.length + 1).toUpperCase() + haystack.substring(index + myneedle.length + 1);
    }
  }
  {
    let myneedle = ', ' + needle + ', ';
    while (haystack.includes(myneedle)) {
      let index = haystack.indexOf(myneedle);
      haystack = haystack.substring(0, index) + ', ' + haystack.substring(index + myneedle.length);
    }
  }
  {
    let myneedle = ', but ' + needle + ', ';
    while (haystack.includes(myneedle)) {
      let index = haystack.indexOf(myneedle);
      haystack = haystack.substring(0, index) + ', ' + haystack.substring(index + myneedle.length);
    }
  }
  return haystack;
}

function computeLanguageCost(model, tokens_prompt, tokens_completion) {
  switch (model) {
    case "text-ada-001":
      return (tokens_prompt + tokens_completion) / 1000 * 0.0004;
    case "text-babbage-001":
      return (tokens_prompt + tokens_completion) / 1000 * 0.0005;
    case "text-curie-001":
      return (tokens_prompt + tokens_completion) / 1000 * 0.0020;
    case "text-davinci-001":
    case "text-davinci-002":
    case "text-davinci-003":
      return (tokens_prompt + tokens_completion) / 1000 * 0.0200;
    case "gpt-3.5-turbo-0301":
    case "gpt-3.5-turbo-0613":
      return tokens_prompt / 1000 * 0.0015 + tokens_completion / 1000 * 0.0020;
    case "gpt-3.5-turbo-1106":
      return tokens_prompt / 1000 * 0.0010 + tokens_completion / 1000 * 0.0020;
    case "gpt-3.5-turbo": // shorthand
    case "gpt-3.5-turbo-0125":
      return tokens_prompt / 1000 * 0.0005 + tokens_completion / 1000 * 0.0015;
    case "gpt-3.5-turbo-16k": // shorthand
    case "gpt-3.5-turbo-16k-0613":
      return tokens_prompt / 1000 * 0.0030 + tokens_completion / 1000 * 0.0040;
    case "gpt-3.5-turbo-instruct": // shorthand
    case "gpt-3.5-turbo-instruct-0914":
      return tokens_prompt / 1000 * 0.0015 + tokens_completion / 1000 * 0.0020;
    case "gpt-4-0314":
      return tokens_prompt / 1000 * 0.0300 + tokens_completion / 1000 * 0.0600;
    case "gpt-4": // shorthand
    case "gpt-4-0613":
      return tokens_prompt / 1000 * 0.0300 + tokens_completion / 1000 * 0.0600;
    case "gpt-4-32k": // shorthand
    case "gpt-4-32k-0314":
    case "gpt-4-32k-0613":
      return tokens_prompt / 1000 * 0.0600 + tokens_completion / 1000 * 0.1200;
    case "gpt-4-turbo": // shorthand
    case "gpt-4-turbo-2024-04-09":
      return tokens_prompt / 1000 * 0.0100 + tokens_completion / 1000 * 0.0300;
    case "gpt-4-turbo-preview": // shorthand
    case "gpt-4-1106-preview":
    case "gpt-4-0125-preview":
    case "gpt-4-vision-preview": // shorthand
    case "gpt-4-1106-vision-preview":
      return tokens_prompt / 1000 * 0.0100 + tokens_completion / 1000 * 0.0300;
    case "gpt-4o": // shorthand
    case "gpt-4o-2024-05-13":
      return tokens_prompt / 1000 * 0.0050 + tokens_completion / 1000 * 0.0150;
    case "gpt-4o-2024-08-06":
      return tokens_prompt / 1000 * 0.0025 + tokens_completion / 1000 * 0.0100;      
    default:
      throw new Error("Unknown model: " + model);
  }
}

async function createBoolean(model, user, question, report, temperature = undefined) {
  let response = null;
  if (isLanguageCompletionModel(model)) {
    response = await createCompletion(model, user, `Respond to the question only with yes or no.\nQuestion: ${question}\nResponse:`, report, temperature);
  } else {
    response = await createResponse(model, user, null, 'I respond only with yes or no!', question, null, report, temperature);
  }
  if (!response) return null;
  let boolean = response.trim().toLowerCase();
  const match = boolean.match(/^([a-z]+)/);
  boolean = match ? match[0] : boolean;
  if (boolean != 'yes' && boolean != 'no') {
    let sentiment = await createResponse(model, user, null, `I determine whether the sentiment of the text is positive or negative.`, boolean, null, report, temperature);
    const sentiment_match = sentiment.trim().toLowerCase().match(/^([a-z]+)/);
    if (sentiment_match && sentiment_match[0] == 'positive') boolean = 'yes';
    else if (sentiment_match && sentiment_match[0] == 'negative') boolean = 'no';
    else throw new Error('Response is not a bool! (' + response + ') and sentiment analysis couldn\'t recover it (' + sentiment + ')!');
  }
  return boolean == 'yes';
}

async function getImageModels() {
  let models = await getModels();
  models = models.filter(model => model.startsWith('dall-e-'));
  models = models.sort();
  return models;
}

function getImageQualities(model) {
  switch (model) {
    case 'dall-e-2': return [ undefined ];
    case 'dall-e-3': return [ "standard", "hd" ];
    default: throw new Error('Unknown model: ' + model);
  }
}

function getImageSizes(model) {
  switch (model) {
    case 'dall-e-2': return [ "256x256", "512x512", "1024x1024" ];
    case 'dall-e-3': return [ "1024x1024", "1792x1024" ];
    default: throw new Error('Unknown model: ' + model);
  }
}

async function createImage(model, quality, size, user, prompt, format, report) {
  if (!token) return null;
  let estimated_size = size.split('x').reduce((d1, d2) => d1 * d2, 1) * 4;
  let pipe = estimated_size > 1024 * 1024;
  try {
    let response = await HTTP('/v1/images/generations', { user: user, prompt: prompt, response_format: pipe ? 'url' : 'b64_json', model: model, quality: quality, size: size });
    await report(model, getImageCost(model, quality, size));
    let result = response.data[0];
    let image = pipe ? await pipeImage(url.parse(result.url)) : buffer2stream(Buffer.from(result.b64_json, 'base64'));
    return media.convert(image, 'png', format);
  } catch (error) {
    throw new Error(JSON.parse(error.message.split(':').slice(1).join(':')).error.message);
  }
}

function buffer2stream(input) {
  let output = new stream.PassThrough();
  output.end(input);
  return output;
}

function preprocessImage(image, format, regions) {
  image = media.convert(image, format, format, ['-vf', 'format=rgba']);
  for (let region of regions) {
    image = media.convert(image, format, format, ['-vf', `geq=a=if(between(X\\,W*${region.x}\\,W*(${region.x}+${region.w}))*between(Y\\,H*${region.y}\\,H*(${region.y}+${region.h}))\\,0\\,255):r=r(X\\,Y):g=g(X\\,Y):b=b(X\\,Y)`]);
  }
  return image;
}

async function editImage(model, size, user, base_image, format, prompt, regions, report) {
  if (!token) return null;
  let output_format = format;
  let estimated_size = size.split('x').reduce((d1, d2) => d1 * d2, 1) * 4;
  let pipe = estimated_size > 1024 * 1024;
  if (!['png'].includes(format)) {
    const preferred_format = 'png';
    base_image = media.convert(base_image, format, preferred_format);
    format = preferred_format;
  }
  base_image = preprocessImage(base_image, format, regions);
  base_image = media.convert(base_image, format, format, ['-vf', 'pad=width=max(iw\\,ih):height=max(iw\\,ih):x=(ow-iw)/2:y=(oh-ih)/2']);
  base_image = media.convert(base_image, format, format, ['-vf', 'scale=' + size.replace('x', ':')])
  try {
    let body = new FormData();
    body.append('user', user, { contentType: 'string' });
    body.append('prompt', prompt, { contentType: 'string' });
    body.append('response_format', pipe ? 'url' : 'b64_json', { contentType: 'string' });
    body.append('size', size, { contentType: 'string' });
    body.append('image', base_image, { contentType: 'image/' + format, filename: 'image.' + format });
    let response = await HTTP('/v1/images/edits', body, body.getHeaders());
    await report(model, getImageCost(model, size));
    let result = response.data[0];
    let image = pipe ? await pipeImage(url.parse(result.url)) : buffer2stream(Buffer.from(result.b64_json, 'base64'));
    return media.convert(image, format, output_format);
  } catch (error) {
    throw new Error(JSON.parse(error.message.split(':').slice(1).join(':')).error.message);
  }
}

async function pipeImage(url) {
  return curl.request({ hostname: url.hostname, path: url.pathname + (url.search ?? ''), stream: true });
}

function getImageCost(model, quality, size) {
  switch(model) {
    case "dall-e-2":
      switch(size) {
        case   "256x256": return 0.016;
        case   "512x512": return 0.018;
        case "1024x1024": return 0.020;
        default: throw new Error('Unknown size: ' + size);
      }
    case "dall-e-3":
      switch (quality) {
        case 'standard':
          switch(size) {
            case "1024x1024": return 0.04;
            case "1024x1792": return 0.08;
            case "1792x1024": return 0.08;
            default: throw new Error('Unknown size: ' + size);
          }
        case 'hd':
          switch(size) {
            case "1024x1024": return 0.08;
            case "1024x1792": return 0.12;
            case "1792x1024": return 0.12;
            default: throw new Error('Unknown size: ' + size);
          }
        default: throw new Error('Unknown quality: ' + quality);
      }
    default: throw new Error("Unknown model: " + model);
  }
}

async function getTranscriptionModels() {
  let models = await getModels();
  models = models.filter(model => model.startsWith('whisper-'));
  models = models.sort();
  return models;
}

async function createTranscription(model, user, prompt, audio_stream, audio_stream_format, audio_stream_length_millis, report) {
  if (!token) return null;
  if (!['mp3', 'mp4', 'wav', 'm4a', 'webm', 'mpga', 'wav', 'mpeg'].includes(audio_stream_format)) {
    const preferred_audio_stream_format = 'mp3';
    audio_stream = media.convert(audio_stream, audio_stream_format, preferred_audio_stream_format);
    audio_stream_format = preferred_audio_stream_format;
  }
  let body = new FormData();
  body.append('model', model, { contentType: 'string' });
  body.append('response_format', 'verbose_json', { contentType: 'string' });
  body.append('prompt', prompt, { contentType: 'string' });
  body.append('file', audio_stream, { contentType: 'audio/' + audio_stream_format, filename: 'audio.' + audio_stream_format });
  let response = await HTTP('/v1/audio/transcriptions', body, body.getHeaders());
  await report(model, getTranscriptionCost(model, response.duration ? response.duration * 1000 : audio_stream_length_millis));
  const max_no_speech_probability = 0.05;
  return response.segments ?
    response.segments.filter(segment => segment.no_speech_prob < max_no_speech_probability).map(segment => segment.text.trim()).filter(segment => segment.length > 0).join(' ') :
    response.text.trim();
}

function getTranscriptionCost(model, time_millis) {
  switch (model) {
    case "whisper-1": return Math.round(time_millis / 1000) / 60 * 0.006;
    default: throw new Error('Unknown model: ' + model);
  }
}

async function getSpeechModels() {
  let models = await getModels();
  models = models.filter(model => model.startsWith('tts-') && !model.match(/-\d{4}$/));
  models = Array.from(new Set(models));
  models = models.sort();
  return models;
}

function getSpeechVoices(model) {
  return [ "alloy", "echo", "fable", "onyx", "nova", "shimmer" ];
}

async function createSpeech(model, user, voice, input, audio_stream_format, report) {
  let response =await HTTP('/v1/audio/speech', { model: model, voice: voice, input: input, response_format: "mp3" }, {}, true);
  await report(model, getSpeechCost(model, input.length));
  return media.convert(response, response.headers['content-type'].split('/')[1], audio_stream_format);
}

function getSpeechCost(model, length) {
  switch (model) {
    case "tts-1": // shorthand
    case "tts-1-1106": return length / 1000 * 0.0150;
    case "tts-1-hd": // shorthand
    case "tts-1-hd-1106": return length / 1000 * 0.0300;
    default: throw new Error('Unknown model: ' + model);
  }
}

async function HTTP(endpoint, body, headers = {}, stream = false) {
  headers['Authorization'] = 'Bearer ' + token;
  let result = await curl.request({
    hostname: 'api.openai.com',
    path: endpoint,
    headers: headers,
    method: 'POST',
    body: body,
    stream: stream,
    timeout: 1000 * 60 * 15
  });
  return result;
}

async function getModels() {
  if (!token) return [];
  return curl.request({ method: 'GET', hostname: 'api.openai.com', path: '/v1/models', headers: { 'Authorization': 'Bearer ' + token }, cache: 60 * 60 * 24 })
    .then(result => result.data.map(model => model.id.replace(/:/, '-')))
    .then(models => Array.from(new Set(models)));
}

function getModelPower(model) {
  return parseFloat(model.match(/\d+(\.\d+)?/g).join(''));
}

module.exports = { 
  getCostLimit,
  isSameBillingSlot,
  computeBillingSlotProgress,

  getLanguageModels,
  compareLanguageModelByCost,
  compareLanguageModelByPower,
  createCompletion,
  createResponse,
  createBoolean,
  
  getImageModels,
  getImageQualities,
  getImageSizes,
  createImage,
  editImage,
  
  getTranscriptionModels,
  createTranscription,

  getSpeechModels,
  getSpeechVoices,
  createSpeech
}
