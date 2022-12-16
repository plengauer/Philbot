const timeout = require('./timeout.js');
// https://github.com/open-telemetry/opentelemetry-js/find/main
const process = require('process');
const opentelemetry_api = require('@opentelemetry/api');
const opentelemetry_sdk = require("@opentelemetry/sdk-node");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { BatchSpanProcessor, SpanExporter } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto");
const { AlwaysOnSampler, AlwaysOffSampler } = require("@opentelemetry/core");

const propertiesReader = require('properties-reader');

class ShutdownAwareSpanProcessor {
  processor;
  open;
  
  constructor(processor) {
    this.processor = processor;
    this.open = [];
  }
  
  onStart(span) {
    this.open.push(span);
    return this.processor.onStart(span);
  }
  
  onEnd(span) {
    let new_open = this.open.filter(s => s != span);
    let doEnd = new_open.length < this.open.length;
    this.open = new_open;
    return doEnd ? this.processor.onEnd(span) : undefined;
  }
  
  shutdown() {
    for (let span of this.open) {
      span.setStatus({ code: opentelemetry_api.SpanStatusCode.ERROR });
      span.recordException('Aborted (internally or externally)');
      span.end();
    }
    this.open = [];
    return this.processor.shutdown();
  }
}

class MultiSpanExporter {
  exporters;
  
  constructor(exporters) {
    this.exporters = exporters;
  }
  
  export(spans, resultCallback) {
    let exported = 0;
    for (let exporter of this.exporters) {
      exporter.export(spans, result => {
        if(++exported == this.exporters.length) resultCallback(result);
      });
    }
  }
  
  shutdown() {
    return Promise.all(this.exporters.map(exporter => exporter.shutdown()));
  }
}

function create(version = undefined) {
  let name = 'Philbot';
  name = name.substring(0, 1).toUpperCase() + name.substring(1, name.length);
  dtmetadata = new Resource({});
  for (let name of ['dt_metadata_e617c525669e072eebe3d0f08212e8f2.properties', '/var/lib/dynatrace/enrichment/dt_metadata.properties']) {
    try {
      dtmetadata.merge(new Resource(propertiesReader(name.startsWith("/var") ? name : fs.readFileSync(name).toString()).getAllProperties()));
    } catch { }
  }
  const sdk = new opentelemetry_sdk.NodeSDK({
    sampler: version ? new AlwaysOnSampler() : new AlwaysOffSampler(),
    spanProcessor: new ShutdownAwareSpanProcessor(new BatchSpanProcessor(new MultiSpanExporter([
        new OTLPTraceExporter({
            url: process.env.OPENTELEMETRY_TRACES_API_ENDPOINT,
            headers: { Authorization: "Api-Token " + process.env.OPENTELEMETRY_TRACES_API_TOKEN },
          }),
        new OTLPTraceExporter({
            url: process.env.OPENTELEMETRY_TRACES_API_ENDPOINT_ALTERNATE_0,
            headers: { Authorization: "Api-Token " + process.env.OPENTELEMETRY_TRACES_API_TOKEN_ALTERNATE_0 },
          }),
        new OTLPTraceExporter({
            url: process.env.OPENTELEMETRY_TRACES_API_ENDPOINT_ALTERNATE_1,
            headers: { Authorization: "Api-Token " + process.env.OPENTELEMETRY_TRACES_API_TOKEN_ALTERNATE_1 },
          })
      ]))),
    instrumentations: [getNodeAutoInstrumentations()],
    resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: name,
        [SemanticResourceAttributes.SERVICE_VERSION]: version ?? 'dev',
      }).merge(dtmetadata),
  });
  
  timeout.register(() => sdk.shutdown(), 0.9);
  
  return sdk;
}

module.exports = { create }
