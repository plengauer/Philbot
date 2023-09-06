require 'securerandom'
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'
require 'opentelemetry/instrumentation/all'
require 'opentelemetry/resource/detectors'
require 'uri'
require 'net/http'

$stdout.sync = true

module ServiceResourceDetector
  extend self
  def detect()
    version = 'unknown'
    begin
      version = File.read('version.txt')
    rescue
    end
    return OpenTelemetry::SDK::Resources::Resource.create({
      OpenTelemetry::SemanticConventions::Resource::SERVICE_NAMESPACE => 'Philbot',
      OpenTelemetry::SemanticConventions::Resource::SERVICE_NAME => 'Philbot Scheduler',
      OpenTelemetry::SemanticConventions::Resource::SERVICE_INSTANCE_ID => SecureRandom.uuid,
      OpenTelemetry::SemanticConventions::Resource::SERVICE_VERSION => version
    })
  end
end

module AwsEC2ResourceDetector
  extend self
  
  def detect
    token_request = Net::HTTP.new(URI('http://169.254.169.254/latest/api/token'))
    token_request['X-aws-ec2-metadata-token-ttl-seconds'] = '60'
    token = token_request.send_request('PUT', '/latest/api/token').body    
    identity = JSON.parse(Net::HTTP.get(URI('http://169.254.169.254/latest/dynamic/instance-identity/document'), { 'X-aws-ec2-metadata-token' => token }).body)
    hostname = Net::HTTP.get(URI('http://169.254.169.254/latest/meta-data/hostname'), { 'X-aws-ec2-metadata-token' => token }).body
    resource_attributes = {}
    unless identity.nil?
      resource_attributes[OpenTelemetry::SemanticConventions::Resource::CLOUD_PROVIDER] = 'aws'
      resource_attributes[OpenTelemetry::SemanticConventions::Resource::CLOUD_PLATFORM] = 'aws_ec2'
      resource_attributes[OpenTelemetry::SemanticConventions::Resource::CLOUD_ACCOUNT_ID] = identity['accountId']
      resource_attributes[OpenTelemetry::SemanticConventions::Resource::CLOUD_REGION] = identity['region']
      resource_attributes[OpenTelemetry::SemanticConventions::Resource::CLOUD_AVAILABILITY_ZONE] = identity['availabilityZone']
      resource_attributes[OpenTelemetry::SemanticConventions::Resource::HOST_ID] = identity['instanceId']
      resource_attributes[OpenTelemetry::SemanticConventions::Resource::HOST_TYPE] = identity['instanceType']
      resource_attributes[OpenTelemetry::SemanticConventions::Resource::HOST_NAME] = hostname
    end
    resource_attributes.delete_if { |_key, value| value.nil? || value.empty? }
    OpenTelemetry::SDK::Resources::Resource.create(resource_attributes)
  end
end

module DynatraceResourceDetector
  extend self
  def detect()
    for name in ["dt_metadata_e617c525669e072eebe3d0f08212e8f2.properties", "/var/lib/dynatrace/enrichment/dt_metadata.properties"] do
      begin
        return OpenTelemetry::SDK::Resources::Resource.create(Hash[*File.read(name.start_with?("/var") ? name : File.read(name)).split(/[=\n]+/)])
      rescue
      end
    end
    return OpenTelemetry::SDK::Resources::Resource.create({})
  end
end

OpenTelemetry::SDK.configure do |c|
  c.resource = DynatraceResourceDetector.detect
  c.resource = AwsEC2ResourceDetector.detect
  c.resource = ServiceResourceDetector.detect
  c.resource = OpenTelemetry::Resource::Detectors::AutoDetector.detect

  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: ENV['OPENTELEMETRY_TRACES_API_ENDPOINT'],
        headers: { "Authorization": "Api-Token " + ENV['OPENTELEMETRY_TRACES_API_TOKEN'] }
      )
    )
  )

  c.use_all()
end

tracer = OpenTelemetry.tracer_provider.tracer('scheduler', '1.0')

def get_sleep_time(interval)
    time = Time.new
    sleep_time = 60 - time.sec
    if interval == 'minutely' then return sleep_time end
    sleep_time += (60 - time.min - 1) * 60
    if interval == 'hourly' then return sleep_time end
    sleep_time += (24 - time.hour - 1) * 60 * 60
    if interval == 'daily' then return sleep_time end
    sleep_time += (Date.new(time.year, time.month, -1).day - time.day) * 24 * 60 * 60
    if interval == 'monthly' then return sleep_time end
    exit(1)
end

puts "running"
threads = []
File.open(ENV["CONFIG_FILE"]).readlines.map(&:chomp).each do |line|
    puts 'config ' + line
    tokens = line.split(/=/)
    if tokens.length != 2 then
        puts 'broken config'
        exit(1)
    end
    interval = tokens[0]
    url = tokens[1]

    threads << Thread.new {    
        while true
            sleep(get_sleep_time(interval))
            tracer.in_span('Scheduler ' + interval, kind: :consumer) do |span|
                puts 'HTTP POST ' + url
                begin
                    Net::HTTP.post(URI(url), '{}', { 'content-encoding' => 'identity', 'content-type' => 'application/json', 'x-authorization' => ENV['DISCORD_API_TOKEN'] })
                rescue
                end
            end
        end
    }
end

threads.each do |thread|
    thread.join();
end
