import fs from 'fs';
import crypto from 'crypto';
import propertiesReader from 'properties-reader';
import opentelemetry_api from '@opentelemetry/api';
import opentelemetry_sdk from '@opentelemetry/sdk-node';
import opentelemetry_metrics from '@opentelemetry/sdk-metrics';
import opentelemetry_tracing from '@opentelemetry/sdk-trace-base';
import opentelemetry_resources from '@opentelemetry/resources';
import opentelemetry_semantic_conventions from '@opentelemetry/semantic-conventions';
import opentelemetry_metrics_otlp from '@opentelemetry/exporter-metrics-otlp-proto';
import opentelemetry_traces_otlp from '@opentelemetry/exporter-trace-otlp-proto';
import opentelemetry_auto_instrumentations from "@opentelemetry/auto-instrumentations-node";
import opentelemetry_resources_git from 'opentelemetry-resource-detector-git';
import opentelemetry_resources_github from '@opentelemetry/resource-detector-github';
import opentelemetry_resources_container from '@opentelemetry/resource-detector-container';
import opentelemetry_resources_aws from '@opentelemetry/resource-detector-aws';
import opentelemetry_resources_gcp from '@opentelemetry/resource-detector-gcp';
import opentelemetry_resources_alibaba_cloud from '@opentelemetry/resource-detector-alibaba-cloud';
import XMLHttpRequest from 'xhr2';

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

class DynatraceResourceDetector {
  detect() {
    for (let name of ['dt_metadata_e617c525669e072eebe3d0f08212e8f2.properties', '/var/lib/dynatrace/enrichment/dt_metadata.properties']) {
      try {
        return new opentelemetry_resources.Resource(propertiesReader(name.startsWith("/var") ? name : fs.readFileSync(name).toString()).getAllProperties());
      } catch { }
    }
    return new opentelemetry_resources.Resource({});
  }
}

class OracleResourceDetector {
  detect() {
      return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'http://169.254.169.254/opc/v1/instance/', true);
          xhr.setRequestHeader('Authorization', 'Bearer Oracle');
          xhr.onload = function () {
              if (xhr.status === 200) {
                  try {
                      const metadata = JSON.parse(xhr.responseText);
                      const resource = new Resource({
                          [SemanticResourceAttributes.CLOUD_PROVIDER]: 'oracle',
                          [SemanticResourceAttributes.CLOUD_REGION]: metadata.region,
                          [SemanticResourceAttributes.CLOUD_AVAILABILITY_ZONE]: metadata.availabilityDomain,
                          [SemanticResourceAttributes.CLOUD_ACCOUNT_ID]: metadata.tenantId,
                          [SemanticResourceAttributes.HOST_TYPE]: metadata.shape,
                          [SemanticResourceAttributes.HOST_NAME]: metadata.hostname,
                          [SemanticResourceAttributes.HOST_ID]: metadata.id,
                          [SemanticResourceAttributes.HOST_IMAGE_ID]: metadata.image,
                      });
                      resolve(resource);
                  } catch (error) {
                      reject(error);
                  }
              } else {
                reject();
              }
          };
          xhr.onerror = reject;
          xhr.onabort = reject;
          xhr.ontimeout = reject;
          xhr.send();
      }).catch(_ => new opentelemetry_resources.Resource({}));
  }
}

class ServiceResourceDetector {
  detect() {
    return new opentelemetry_resources.Resource({
      [opentelemetry_semantic_conventions.SemanticResourceAttributes.SERVICE_NAMESPACE]: 'Philbot',
      [opentelemetry_semantic_conventions.SemanticResourceAttributes.SERVICE_NAME]: 'Philbot Discord Gateway 2 HTTP',
      [opentelemetry_semantic_conventions.SemanticResourceAttributes.SERVICE_VERSION]: JSON.parse('' + fs.readFileSync('package.json')).version,
      [opentelemetry_semantic_conventions.SemanticResourceAttributes.SERVICE_INSTANCE_ID]: crypto.randomUUID(),
    });
  }
}

async function init() {
  let sdk = create();
  process.on('exit', () => sdk.shutdown());
  process.on('SIGINT', () => sdk.shutdown());
  process.on('SIGQUIT', () => sdk.shutdown());
  await sdk.start();
}

function create() {
  return new opentelemetry_sdk.NodeSDK({
    sampler: process.env.OPENTELEMETRY_TRACES_API_ENDPOINT ? new opentelemetry_tracing.AlwaysOnSampler() : new opentelemetry_tracing.AlwaysOffSampler(),
    spanProcessor: new ShutdownAwareSpanProcessor(
      new opentelemetry_tracing.BatchSpanProcessor(
        new opentelemetry_traces_otlp.OTLPTraceExporter({
          url: process.env.OPENTELEMETRY_TRACES_API_ENDPOINT,
          headers: { Authorization: process.env.OPENTELEMETRY_TRACES_API_TOKEN },
        }),
      )
    ),
    metricReader: new opentelemetry_metrics.PeriodicExportingMetricReader({
      exporter: new opentelemetry_metrics_otlp.OTLPMetricExporter({
        url: process.env.OPENTELEMETRY_METRICS_API_ENDPOINT,
        headers: { Authorization: process.env.OPENTELEMETRY_METRICS_API_TOKEN },
        temporalityPreference: opentelemetry_metrics.AggregationTemporality.DELTA
      }),
      exportIntervalMillis: 5000,
    }),
    instrumentations: [ opentelemetry_auto_instrumentations.getNodeAutoInstrumentations({'@opentelemetry/instrumentation-fs': { enabled: false }}) ],
    resourceDetectors: [
      new DynatraceResourceDetector(),
      opentelemetry_resources_alibaba_cloud.alibabaCloudEcsDetector,
      // TODO azure
      opentelemetry_resources_gcp.gcpDetector,
      opentelemetry_resources_aws.awsBeanstalkDetector,
      opentelemetry_resources_aws.awsEc2Detector,
      opentelemetry_resources_aws.awsEcsDetector,
      opentelemetry_resources_aws.awsEksDetector,
      // TODO k8s detector
      opentelemetry_resources_container.containerDetector,
      opentelemetry_resources_git.gitSyncDetector,
      opentelemetry_resources_github.gitHubDetector,
      opentelemetry_resources.processDetector,
      opentelemetry_resources.envDetector,
      new ServiceResourceDetector(),
      new OracleResourceDetector()
    ],
  });
}

await init();
