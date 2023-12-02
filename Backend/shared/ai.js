
const memory = require('./memory.js');
const opentelemetry = require('@opentelemetry/api');

const synchronized = require('./synchronized.js');
const openai = require('./openai.js');
const googleai = require('./googleai.js');
const speechify = require('./speechify.js');

const VENDORS = [ 'openai', 'google', 'speechify', 'microsoft' ];

const meter = opentelemetry.metrics.getMeter('ai');
meter.createObservableGauge('ai.cost.slotted.absolute').addCallback(async (result) => Promise.all(VENDORS.map(vendor => getCurrentCost(vendor).then(cost => result.observe(cost, {'ai.vendor': vendor})))));
meter.createObservableGauge('ai.cost.slotted.relative').addCallback(async (result) => Promise.all(VENDORS.map(vendor => getCurrentCost(vendor).then(cost => result.observe(getCostLimit(vendor) > 0 ? cost / getCostLimit(vendor) : 0, {'ai.vendor': vendor})))));
meter.createObservableGauge('ai.cost.slotted.progress').addCallback(async (result) => Promise.all(VENDORS.map(vendor => getCurrentCost(vendor).then(cost => result.observe((getCostLimit(vendor) > 0 ? cost / getCostLimit(vendor) : 0) / computeBillingSlotProgress(vendor), {'ai.vendor': vendor})))));
const request_counter = meter.createCounter('ai.requests');
const cost_counter = meter.createCounter('ai.cost');

const DEFAULT_DYNAMIC_MODEL_SAFETY = 0.2;

function getDefaultDynamicModelSafety() {
    return DEFAULT_DYNAMIC_MODEL_SAFETY;
}

async function getDynamicModel(models, safety = DEFAULT_DYNAMIC_MODEL_SAFETY) {
    let model_index = models.length - 1;
    let threshold = safety;
    while (!await shouldCreate(models[model_index].vendor, 1 - threshold) && model_index > 0) {
        model_index--;
        threshold = threshold * safety;
    }
    return models[model_index];
}

async function shouldCreate(vendor, threshold = 0.8) {
    return (await computeCostProgress(vendor)) / computeBillingSlotProgress(vendor) < threshold;
}

async function computeCostProgress(vendor) {
    let limit = getCostLimit(vendor);
    return limit > 0 ? (await getCurrentCost(vendor)) / getCostLimit(vendor) : 1;
}

async function getLanguageModels() {
    return openai.getLanguageModels().then(models => wrapModels('openai', models));
}

function compareLanguageModelByCost(cheap_model, expensive_model) {
    return openai.compareLanguageModelByCost(cheap_model.name, expensive_model.name);
}

function compareLanguageModelByPower(bad_model, good_model) {
    return openai.compareLanguageModelByPower(bad_model.name, good_model.name);
}

async function createCompletion(model, user, prompt, temperature = undefined) {
    return openai.createCompletion(model.name, user, prompt, async (model_name, cost) => bill(model.vendor, model_name, user, cost), temperature);
}

async function createResponse(model, user, history_token, system, message, attachments = undefined, temperature = undefined) {
    return openai.createResponse(model.name, user, history_token, system, message, attachments, async (model_name, cost) => bill(model.vendor, model_name, user, cost), temperature);
}

async function createBoolean(model, user, question, temperature = undefined) {
    return openai.createBoolean(model.name, user, question, async (model_name, cost) => bill(model.vendor, model_name, user, cost), temperature);
}

async function getImageModels() {
    let names = await openai.getImageModels();
    let models = [];
    for (let name of names) {
        for (let quality of openai.getImageQualities(name)) {
            for (let size of openai.getImageSizes(name)) {
                models.push({ vendor: 'openai', name: name, quality: quality, size: size });
            }
        }
    }
    return models;
}

async function createImage(model, user, prompt, format) {
    return openai.createImage(model.name, model.quality, model.size, user, prompt, format, async (model_name, cost) => bill(model.vendor, model_name, user, cost));
}

async function editImage(model, user, base_image, format, prompt, regions) {
    return openai.editImage(model.name, model.quality, model.size, user, base_image, format, prompt, regions, async (model_name, cost) => bill(model.vendor, model_name, user, cost));
}

async function getTranscriptionModels() {
    return openai.getTranscriptionModels().then(models => wrapModels('openai', models));
}

async function createTranscription(model, user, prompt, audio_stream, audio_stream_format, audio_stream_length_millis) {
    return openai.createTranscription(model.name, user, prompt, audio_stream, audio_stream_format, audio_stream_length_millis, async (model_name, cost) => bill(model.vendor, model_name, user, cost));
}

async function getVoiceModels(user) {
    let models_speechify = await speechify.getVoiceModels(user).then(models => wrapModels('speechify', models));
    let models_google = await googleai.getVoiceModels().then(models => wrapModels('google', models));
    let models_openai = await openai.getSpeechModels().then(models => wrapModels('openai', models));
    return models_openai.concat(models_google).concat(models_speechify);
}

async function seedVoice(model, user, seed, format) {
    return speechify.seedVoice(model, user, seed, format);
}

async function createVoice(model, user, text, language, gender, format) {
    switch(model.vendor) {
        case 'speechify': return speechify.createVoice(model.name, user, text, format, async (model_name, cost) => bill(model.vendor, model_name, user, cost));
        case 'google': return googleai.createVoice(model.name, text, language, gender, format, async (model_name, cost) => bill(model.vendor, model_name, user, cost)); 
        case 'openai': return openai.createSpeech(model.name, user, getSpeechVoices(model.name)[0], text, format, async (model_name, cost) => bill(model.vendor, model_name, user, cost));
    }
}

function wrapModels(vendor, models) {
    return models.map(model => { return { vendor: vendor, name: model }; });
}

async function bill(model_vendor, model_name, user, cost) {
    const attributes = { 'ai.vendor': model_vendor, 'ai.model': model_name, 'ai.user': user };
    request_counter.add(1, attributes);
    cost_counter.add(cost, attributes);
    return synchronized.locked('ai.billing', () => {
        let now = Date.now(); // we need to get the time first because we may be just at the limit of a billing slot (this way we may lose a single entry worst case, but we wont carry over all the cost to the next)
        return getCurrentCost(model_vendor).then(current_cost => memory.set(costkey(model_vendor), { value: current_cost + cost, timestamp: now }, 60 * 60 * 24 * 31));
    });
}

async function getCurrentCost(vendor) {
    let now = new Date();
    let backup = { value: 0, timestamp: now };
    let cost = await memory.get(costkey(vendor), backup);
    if (!isSameBillingSlot(vendor, new Date(cost.timestamp), now)) cost = backup;
    return cost.value;
}

function getCostLimit(vendor) {
    switch(vendor) {
        case 'openai': return openai.getCostLimit();
        case 'google': return googleai.getCostLimit();
        case 'speechify': return speechify.getCostLimit();
        case 'microsoft': return 0;
        default: throw new Error('Unknown vendor: ' + vendor);
    }
}

function isSameBillingSlot(vendor, timestamp, now) {
    switch(vendor) {
        case 'openai': return openai.isSameBillingSlot(timestamp, now);
        case 'google': return googleai.isSameBillingSlot(timestamp, now);
        case 'speechify': return speechify.isSameBillingSlot(timestamp, now);
        case 'microsoft': return true;
        default: throw new Error('Unknown vendor: ' + vendor);
    }
}

function computeBillingSlotProgress(vendor) {
    switch(vendor) {
        case 'openai': return openai.computeBillingSlotProgress();
        case 'google': return googleai.computeBillingSlotProgress();
        case 'speechify': return speechify.computeBillingSlotProgress();
        case 'microsoft': return 0;
        default: throw new Error('Unknown vendor: ' + vendor);
    }
}

function costkey(vendor) {
    return 'ai:cost:vendor:' + vendor;
}

module.exports = {
    shouldCreate,
    getDynamicModel,
    getDefaultDynamicModelSafety,

    getLanguageModels,
    compareLanguageModelByCost,
    compareLanguageModelByPower,
    createCompletion,
    createResponse,
    createBoolean,
    
    getImageModels,
    createImage,
    editImage,
    
    getTranscriptionModels,
    createTranscription,
    
    getVoiceModels,
    seedVoice,
    createVoice
}
