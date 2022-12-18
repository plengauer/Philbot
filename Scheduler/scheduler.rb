require 'uri'
require 'net/http'

def get_sleep_time(interval)
    time = Time.new
    sleep_time = 60 - time.sec
    if interval == 'minutely' then return sleep_time end
    sleep_time += (60 - time.min) * 60
    if interval == 'hourly' then return sleep_time end
    sleep_time += (24 - time.hour) * 60 * 60
    if interval == 'daily' then return sleep_time end
    sleep_time += (31 - time.day) * 24 * 60 * 60
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
            puts url
            Net::HTTP.post(URI(url), '{}', { 'content-encoding' => 'identity', 'content-type' => 'application/json' })
        end
    }
end

threads.each do |thread|
    thread.join();
end
