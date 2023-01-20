import propertiesReader from 'properties-reader';
import opentelemetry_api from '@opentelemetry/api';
import opentelemetry_sdk from "@opentelemetry/sdk-node";

import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { PeriodicExportingMetricReader, AggregationTemporality} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { AlwaysOnSampler, AlwaysOffSampler } from "@opentelemetry/core";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

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
      span.recordException('Aborted (shutdown)');
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

async function init() {
  let sdk = create();
  process.on('exit', () => sdk.shutdown());
  await sdk.start();
}

function create() {
  let name = process.env.SERVICE_NAME;
  let version = process.env.SERVICE_VERSION;
  let dtmetadata = new Resource({});
  for (let name of ['dt_metadata_e617c525669e072eebe3d0f08212e8f2.properties', '/var/lib/dynatrace/enrichment/dt_metadata.properties']) {
    try {
      dtmetadata.merge(new Resource(propertiesReader(name.startsWith("/var") ? name : fs.readFileSync(name).toString()).getAllProperties()));
    } catch { }
  }
  const sdk = new opentelemetry_sdk.NodeSDK({
    sampler: (name && version) ? new AlwaysOnSampler() : new AlwaysOffSampler(),
    spanProcessor: new ShutdownAwareSpanProcessor(new BatchSpanProcessor(new MultiSpanExporter([
        new OTLPTraceExporter({
            url: process.env.OPENTELEMETRY_TRACES_API_ENDPOINT,
            headers: { Authorization: "Api-Token " + process.env.OPENTELEMETRY_TRACES_API_TOKEN },
          }),
    ]))),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: process.env.OPENTELEMETRY_METRICS_API_ENDPOINT,
        headers: { Authorization: "Api-Token " + process.env.OPENTELEMETRY_METRICS_API_TOKEN },
        temporalityPreference: AggregationTemporality.DELTA
      }),
      exportIntervalMillis: 5000,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
    resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: name,
        [SemanticResourceAttributes.SERVICE_VERSION]: version,
      }).merge(dtmetadata),
  });
  return sdk;
}

await init();
