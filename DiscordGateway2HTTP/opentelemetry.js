import propertiesReader from 'properties-reader';
import opentelemetry_api from '@opentelemetry/api';
import opentelemetry_sdk from "@opentelemetry/sdk-node";
import opentelemetry_tracing from "@opentelemetry/sdk-trace-base";
import opentelemetry_resources from "@opentelemetry/resources";
import opentelemetry_semantic_conventions from "@opentelemetry/semantic-conventions";

import { PeriodicExportingMetricReader, AggregationTemporality} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
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

async function init() {
  let sdk = create();
  process.on('exit', () => sdk.shutdown());
  await sdk.start();
}

function create() {
  let name = process.env.SERVICE_NAME;
  let version = process.env.SERVICE_VERSION;
  let dtmetadata = new opentelemetry_resources.Resource({});
  for (let name of ['dt_metadata_e617c525669e072eebe3d0f08212e8f2.properties', '/var/lib/dynatrace/enrichment/dt_metadata.properties']) {
    try {
      dtmetadata.merge(new opentelemetry_resources.Resource(propertiesReader(name.startsWith("/var") ? name : fs.readFileSync(name).toString()).getAllProperties()));
    } catch { }
  }
  const sdk = new opentelemetry_sdk.NodeSDK({
    sampler: (name && version) ? new opentelemetry_tracing.AlwaysOnSampler() : new opentelemetry_tracing.AlwaysOffSampler(),
    spanProcessor: new ShutdownAwareSpanProcessor(
      new opentelemetry_tracing.BatchSpanProcessor(
        new OTLPTraceExporter({
          url: process.env.OPENTELEMETRY_TRACES_API_ENDPOINT,
          headers: { Authorization: "Api-Token " + process.env.OPENTELEMETRY_TRACES_API_TOKEN },
        }),
      )
    ),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: process.env.OPENTELEMETRY_METRICS_API_ENDPOINT,
        headers: { Authorization: "Api-Token " + process.env.OPENTELEMETRY_METRICS_API_TOKEN },
        temporalityPreference: AggregationTemporality.DELTA
      }),
      exportIntervalMillis: 5000,
    }),
    instrumentations: [getNodeAutoInstrumentations({'@opentelemetry/instrumentation-fs': { enabled: false }})],
    resource: new opentelemetry_resources.Resource({
        [opentelemetry_semantic_conventions.SemanticResourceAttributes.SERVICE_NAME]: name,
        [opentelemetry_semantic_conventions.SemanticResourceAttributes.SERVICE_VERSION]: version,
      }).merge(dtmetadata),
  });
  return sdk;
}

await init();
