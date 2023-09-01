require 'securerandom'
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'
require 'opentelemetry/instrumentation/all'
require 'opentelemetry/resource/detectors'
require 'uri'
require 'net/http'

$stdout.sync = true

OpenTelemetry::SDK.configure do |c|
  version = 'unknown'
  begin
    version = File.read('version.txt')
  rescue
  end
  c.resource = OpenTelemetry::SDK::Resources::Resource.create({
    OpenTelemetry::SemanticConventions::Resource::SERVICE_NAMESPACE => 'Philbot',
    OpenTelemetry::SemanticConventions::Resource::SERVICE_NAME => 'Philbot Scheduler',
    OpenTelemetry::SemanticConventions::Resource::SERVICE_INSTANCE_ID => SecureRandom.uuid,
    OpenTelemetry::SemanticConventions::Resource::SERVICE_VERSION => version
  })
  for name in ["dt_metadata_e617c525669e072eebe3d0f08212e8f2.properties", "/var/lib/dynatrace/enrichment/dt_metadata.properties"] do
    begin
      c.resource = OpenTelemetry::SDK::Resources::Resource.create(Hash[*File.read(name.start_with?("/var") ? name : File.read(name)).split(/[=\n]+/)])
    rescue
    end
  end
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
