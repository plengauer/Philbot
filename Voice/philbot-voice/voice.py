import uuid
import os
import io
import time
import random
import json
import struct
import ctypes
import nacl.secret
import wave
import pyogg
import pyogg.opus
import threading
import socket
import requests
import subprocess
import websocket
from flask import Flask, request, Response, send_file
import yt_dlp
import opentelemetry
from opentelemetry.sdk.resources import Resource, ResourceDetector, OTELResourceDetector, ProcessResourceDetector, get_aggregated_resources
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.trace import TracerProvider, sampling
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, attach, detach, set_value
from opentelemetry_resourcedetector_docker import DockerResourceDetector
from opentelemetry_resourcedetector_kubernetes import KubernetesResourceDetector
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

class ServiceResourceDetector(ResourceDetector):
    def detect(self) -> Resource:
        version = 'unknown'
        try:
            with open('version.txt') as f:
                version = f.read()
        except:
            pass
        return Resource.create({
            "service.namespace": "Philbot",
            "service.name": "Philbot Voice",
            "service.version": version,
            "service.instance.id": str(uuid.uuid4())
        })

class OracleResourceDetector(ResourceDetector):
    def detect(self) -> Resource:
        try:
            metadata = self.fetch_metadata()
            resource = Resource.create({
                "cloud.provider": "oracle",
                "cloud.region": metadata['region'],
                "cloud.availability_zone": metadata['availabilityDomain'],
                "cloud.account_id": metadata['tenantId'],
                "host.type": metadata['shape'],
                "host.name": metadata['hostname'],
                "host.id": metadata['id'],
                "host.image_id": metadata['image']
            })
            return resource
        except Exception:
            return Resource({})

    def fetch_metadata(self):
        response = requests.get('http://169.254.169.254/opc/v1/instance/', headers={'Authorization': 'Bearer Oracle'})
        response.raise_for_status()  # Raise an exception for 4xx or 5xx status codes
        return response.json()

class AwsEC2ResourceDetector(ResourceDetector):
    def detect(self) -> Resource:
        context_token = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
        try:
            token = requests.put('http://169.254.169.254/latest/api/token', headers={ 'X-aws-ec2-metadata-token-ttl-seconds': '60' }, timeout=5).text
            identity = requests.get('http://169.254.169.254/latest/dynamic/instance-identity/document', headers={ 'X-aws-ec2-metadata-token': token }, timeout=5).json()
            hostname = requests.get('http://169.254.169.254/latest/meta-data/hostname', headers={ 'X-aws-ec2-metadata-token': token }, timeout=5).text
            return Resource.create({
                'cloud.provider': 'aws',
                'cloud.platform': 'aws_ec2',
                'cloud.account.id': identity['accountId'],
                'cloud.region': identity['region'],
                'cloud.availability_zone': identity['availabilityZone'],
                'host.id': identity['instanceId'],
                'host.type': identity['instanceType'],
                'host.name': hostname
            })
        finally:
            detach(context_token)

class DynatraceResourceDetector(ResourceDetector):
    def detect(self) -> Resource:
        for name in ["dt_metadata_e617c525669e072eebe3d0f08212e8f2.json", "/var/lib/dynatrace/enrichment/dt_metadata.json"]:
            try:
                with open(name) as f:
                    return Resource.create(json.load(f if name.startswith("/var") else open(f.read())))
            except:
                pass
        return Resource.get_empty()

resources = get_aggregated_resources([
        DynatraceResourceDetector(),
        # TODO azure
        # TODO alibaba cloud 
        # TODO GCP
        # TODO AWS beanstock, ECS, EKS, 
        AwsEC2ResourceDetector(),
        KubernetesResourceDetector(),
        DockerResourceDetector(),
        ProcessResourceDetector(),
        OTELResourceDetector(),
        ServiceResourceDetector(),
        OracleResourceDetector(),
    ]
)

os.environ['OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE'] = 'delta'
meter_provider = MeterProvider(metric_readers = [ PeriodicExportingMetricReader(OTLPMetricExporter(
    endpoint = os.environ.get('OPENTELEMETRY_METRICS_API_ENDPOINT', ''),
    headers = { 'Authorization': os.environ.get('OPENTELEMETRY_METRICS_API_TOKEN', '') }
#    preferred_temporality = { Counter: AggregationTemporality.DELTA }
)) ], resource = resources)
opentelemetry.metrics.set_meter_provider(meter_provider)

tracer_provider = TracerProvider(sampler=sampling.ALWAYS_ON, resource = resources)
tracer_provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(
        endpoint = os.environ.get('OPENTELEMETRY_TRACES_API_ENDPOINT', ''),
        headers = { 'Authorization': os.environ.get('OPENTELEMETRY_TRACES_API_TOKEN', '') }
    ))
)
opentelemetry.trace.set_tracer_provider(tracer_provider)

def observed_subprocess_run(command):
    with opentelemetry.trace.get_tracer('philbot-voice/subprocess').start_as_current_span(' '.join(command)) as span:
        span.set_attribute("subprocess.command", ' '.join(command))
        span.set_attribute("subprocess.command_args", ' '.join(command[1:]))
        span.set_attribute("subprocess.executable.path", command[0] if '/' in command[0] else "")
        span.set_attribute("subprocess.executable.name", command[0].rsplit('/', 1)[-1] if '/' in command else command[0])
        carrier = {}
        TraceContextTextMapPropagator().inject(carrier, opentelemetry.trace.set_span_in_context(span, None))
        env = os.environ.copy()
        env["OTEL_TRACEPARENT"] = carrier['traceparent']
        completed_process = subprocess.run(command, env=env, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
        span.set_attribute('subprocess.exit_code', completed_process.returncode)
        return completed_process

UDP_MAX_PAYLOAD = 65507
HTTP_PORT = int(os.environ.get('PORT', str(8080)))
UDP_PORT_MIN = int(os.environ.get('UDP_PORT_MIN', str(12346)))
UDP_PORT_MAX = int(os.environ.get('UDP_PORT_MAX', str(65535)))
STORAGE_DIRECTORY = os.environ['CACHE_DIRECTORY']
SESSION_DIRECTORY = os.environ.get('STATE_STORAGE_DIRECTORY', '.')

meter = opentelemetry.metrics.get_meter_provider().get_meter('voice', '1.0.0')
app = Flask(__name__)

def time_seconds():
    return int(time.time())

def time_millis():
    return round(time.time() * 1000)

def create_voice_package_header(sequence, timestamp, ssrc):
    header = bytearray(12)
    header[0] = 0x80
    header[1] = 0x78
    struct.pack_into('>H', header, 2, sequence & 0xFFFF)
    struct.pack_into('>I', header, 4, timestamp)
    struct.pack_into('>I', header, 8, ssrc)
    return bytes(header)

def unwrap_voice_package_header(header):
    sequence = struct.unpack_from('>H', header, 2)[0]
    timestamp = struct.unpack_from('>I', header, 4)[0]
    ssrc = int.from_bytes(header[8:8+4], byteorder='big')
    return sequence, timestamp, ssrc

def create_voice_package(sequence, timestamp, ssrc, secret_box, voice_chunk):
    header = create_voice_package_header(sequence, timestamp, ssrc)
    nonce = bytearray(24)
    nonce[:12] = header
    return header + secret_box.encrypt(voice_chunk, bytes(nonce)).ciphertext

def unwrap_voice_package(package, secret_box):
    header = package[:12]
    nonce = bytearray(24)
    nonce[:12] = header
    sequence, timestamp, ssrc = unwrap_voice_package_header(header)
    voice_chunk = secret_box.decrypt(package[12:], bytes(nonce))
    if voice_chunk[0] == 0xbe and voice_chunk[1] == 0xde: # RTP header extensions ...
        extension_length = int.from_bytes(voice_chunk[2:2+2], byteorder='big')
        voice_chunk = voice_chunk[2 + 2 + 4 * extension_length:]
    return sequence, timestamp, ssrc, voice_chunk

def generate_audio_file_path(guild_id, channel_id, user_id, nonce, extension = 'wav'):
    path = STORAGE_DIRECTORY + '/audio.in.' + guild_id + '.' + channel_id + '.' + user_id + '.' + str(nonce) + '.' + extension
    if not os.path.normpath(path).startswith(STORAGE_DIRECTORY):
        raise RuntimeError
    return path

download_lock = threading.Lock()
downloads = {}

def download_from_youtube(url, filename_prefix):
    path = STORAGE_DIRECTORY + '/' + filename_prefix
    if not os.path.normpath(path).startswith(STORAGE_DIRECTORY):
        raise RuntimeError
    options = {
        'quiet': True,
        'no_warnings': True,
        'geo_bypass': True,
        'format': 'bestaudio',
        'outtmpl': path + '.%(ext)s',
        'nooverwrites': False,
        'updatetime': False
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        ydl.download([url])
        return next(((os.path.join(STORAGE_DIRECTORY, file)) for file in os.listdir(STORAGE_DIRECTORY) if file.startswith(filename_prefix)), None)

def download_url(url, filename_prefix):
    response = requests.get(url)
    if response.status_code != 200:
        raise RuntimeError
    codec = None
    content_type = response.headers['content-type']
    if content_type.startswith('audio/') or content_type.startswith('video/'):
        codec = content_type.split('/', 1)[1]
    else:
        codec = url.rsplit('.', 1)[1]
        if len(codec) > 5 or '/' in codec or '.' in codec:
            raise RuntimeError
    path = STORAGE_DIRECTORY + '/' + filename_prefix + '.' + codec
    if not os.path.normpath(path).startswith(STORAGE_DIRECTORY):
        raise RuntimeError
    with open(path, 'wb') as file:
        file.write(response.content)
    return path

def resolve_url(guild_id, url):
    if '/' in guild_id or '.' in guild_id:
        raise RuntimeError
    codec = 'mp3'
    filename_prefix = 'audio.out.' + guild_id + '.' + str(hash(url))
    path = STORAGE_DIRECTORY + '/' + filename_prefix + '.' + codec
    if not os.path.normpath(path).startswith(STORAGE_DIRECTORY):
        raise RuntimeError
    if os.path.exists(path):
        os.utime(path)
        return path

    event = None
    download_in_progress = False
    with download_lock:
        download_in_progress = downloads.get(url) and not downloads[url].is_set()
        if not downloads.get(url):
            downloads[url] = threading.Event()
        event = downloads[url]
    if download_in_progress:
        event.wait()
        return resolve_url(guild_id, url)
    
    try:
        if url.startswith('https://www.youtube.com/watch?v=') or url.startswith('https://youtu.be/'):
            path = download_from_youtube(url, filename_prefix)
        elif url.startswith('http://') or url.startswith('https://'):
            path = download_url(url, filename_prefix)
        elif url.startswith('file://'):
            path = STORAGE_DIRECTORY + '/' + filename_prefix + '.' + url.rsplit('.', 1)[1]
            if not os.path.normpath(path).startswith(STORAGE_DIRECTORY):
                raise RuntimeError
            os.rename(url[len('file://'):], path)
        else:
            raise RuntimeError(url)
        os.utime(path)
    finally:
        with download_lock:
            downloads[event] = None
        event.set()

    if not path.endswith('.' + codec): # to optimize for space, not functionally necessary
        old_path = path
        path = old_path.rsplit('.', 1)[0] + '.' + codec
        observed_subprocess_run(['ffmpeg', '-i', old_path, '-f', codec, '-y', path]).check_returncode()
        os.remove(old_path)
    return path

frame_duration = 20
frame_rate = 48000
sample_width = 2
channels = 2
desired_frame_size = int(frame_rate * frame_duration / 1000)

counter_streams = meter.create_counter(name = 'discord.gateway.voice.streams', description = 'Number of streams', unit="count")
counter_streaming = meter.create_counter(name = 'discord.gateway.voice.streaming', description = 'Amount of time streamed', unit="milliseconds")
counter_real_time_violations = meter.create_counter(name = 'discord.gateway.voice.real_time_violations', description = 'Time audio has not been sent in real-time', unit="milliseconds")

class Packet:
    sequence = None
    timestamp = None
    pcm = None

    def __init__(self, sequence, timestamp, pcm):
        self.sequence = sequence
        self.timestamp = timestamp
        self.time = time
        self.pcm = pcm

    def get_sequence(self):
        return self.sequence
    
    def get_timestamp(self):
        return self.timestamp
    
    def get_pcm(self):
        return self.pcm

class Stream:
    guild_id = None
    channel_id = None
    user_id = None
    nonce = None
    file = None
    packages = None
    last_sequence = None
    last_timestamp = None
    buffer = None
    buffer_revision = None

    def __init__(self, guild_id, channel_id, user_id):
        self.guild_id = guild_id
        self.channel_id = channel_id
        self.user_id = user_id
    
    def get_nonce(self):
        return self.nonce
    
    def get_duration_secs(self):
        return self.packages * frame_duration / 1000

    def write(self, sequence, timestamp, pcm, nonce):
        if not self.file:
            self.nonce = nonce
            self.file = wave.open(generate_audio_file_path(self.guild_id, self.channel_id, self.user_id, nonce, 'wav'), 'wb')
            self.file.setsampwidth(sample_width)
            self.file.setnchannels(channels)
            self.file.setframerate(frame_rate)
            self.packages = 0
            self.last_sequence = None
            self.last_timestamp = None
            self.buffer = {}
            self.buffer_revision = None
        self.buffer[sequence] = Packet(sequence, timestamp, pcm)
        self.buffer_revision = time_millis()
    
    def try_flush(self, limit = 1000):
        if not self.file:
            return False
        # some basic threasholds
        too_young_packages = max(0, limit - ((time_millis() - self.buffer_revision) if self.buffer_revision else 0)) // frame_duration
        min_pause_duration = 1000
        # find first earliest sequence in case we are just starting
        if not self.last_sequence:
            for sequence in self.buffer.keys():
                if not self.last_sequence or self.last_sequence > sequence:
                    self.last_sequence = sequence
            if not self.last_sequence:
                return False
            self.last_timestamp = self.buffer[self.last_sequence].get_timestamp() - desired_frame_size
            self.last_sequence = self.last_sequence - 1
        # write packages and fill holes
        do_flush = False
        while len(self.buffer) > too_young_packages or (len(self.buffer) > 0 and self.buffer.get(self.last_sequence + 1)):
            sequence = (self.last_sequence + 1) & 0xFFFF
            missing_packages = 0
            while not self.buffer.get(sequence):
                sequence = (sequence + 1) & 0xFFFF
                missing_packages += 1
            packet = self.buffer.get(sequence)
            if packet.get_timestamp() > self.last_timestamp + (desired_frame_size * min_pause_duration // frame_duration):
                do_flush = True
                break
            self.buffer.pop(sequence)
            self.file.writeframes(b"\x00" * sample_width * channels * desired_frame_size * missing_packages)
            self.file.writeframes(packet.get_pcm())
            self.packages += missing_packages + 1
            self.last_sequence = packet.get_sequence()
            self.last_timestamp = packet.get_timestamp()
        # check whether we ran out completely
        if len(self.buffer) == 0 and too_young_packages == 0:
            do_flush = True
        # flush if necessary
        if do_flush:
            self.file.close()
            self.file = None
            from_path = generate_audio_file_path(self.guild_id, self.channel_id, self.user_id, self.nonce, 'wav')
            to_path = generate_audio_file_path(self.guild_id, self.channel_id, self.user_id, self.nonce, 'mp3')
            observed_subprocess_run(['ffmpeg', '-i', from_path, '-y', to_path]).check_returncode()
            os.remove(from_path)
        return do_flush

    def flush(self):
        return self.try_flush(0)

    def reset(self):
        if self.file:
            self.file.close()
        self.nonce = None
        self.file = None
        self.packages = None
        self.last_sequence = None
        self.buffer = None
        self.buffer_revision = None

class Connection:
    lock = threading.Lock()
    callback_url = None
    guild_id = None
    channel_id = None
    user_id = None
    session_id = None
    endpoint = None
    token = None
    path = None
    paused = False

    ws = None
    socket = None
    heartbeat_interval = None
    ssrc = None
    ip = None
    port = None
    mode = None
    secret_key = None

    ssrc_to_client_user_id = {}

    listener = None
    streamer = None

    def __init__(self, guild_id):
        self.guild_id = guild_id
        try:
            with open(SESSION_DIRECTORY + '/.state.' + self.guild_id + '.json', 'r') as file:
                state = json.loads(file.read())
                if state['guild_id'] != guild_id:
                    return # silently ignore state file
                self.callback_url = state['callback_url']
                self.channel_id = state['channel_id']
                self.user_id = state['user_id']
                self.session_id = state['session_id']
                self.endpoint = state['endpoint']
                self.token = state['token']
                self.path = state['path']
                self.paused = state['paused']
        except:
            pass
        self.__try_start()

    def __save(self):
        with self.lock:
            filename = SESSION_DIRECTORY + '/.state.' + self.guild_id + '.json'
            if self.channel_id:
                with open(filename, 'w') as file:
                    file.write(json.dumps({
                        'guild_id': self.guild_id,
                        'callback_url': self.callback_url,
                        'channel_id': self.channel_id,
                        'user_id': self.user_id,
                        'session_id': self.session_id,
                        'endpoint': self.endpoint,
                        'token': self.token,
                        'path': self.path,
                        'paused': self.paused
                    }))
            else:
                try:
                    os.remove(filename)
                except:
                    pass
    
    def __callback(self, reason, body = {}):
        delay = 1
        while True:
            if delay > 60 * 60:
                break
            try:
                body['guild_id'] = self.guild_id
                if not body.get('channel_id'):
                    with self.lock:
                        if not self.channel_id:
                            return
                        body['channel_id'] = self.channel_id
                requests.post(self.callback_url + '/' + reason, json=body, headers={ 'x-authorization': os.environ['DISCORD_API_TOKEN'] }, verify=False)
                break
            except:
                time.sleep(delay)
                delay *= 2

    def __callback_playback_finished(self):
        self.__callback('voice_playback_finished')

    def __callback_reconnect(self):
        self.__callback('voice_reconnect')

    def __callback_audio(self, channel_id, user_id, nonce, duration_secs):
        self.__callback('voice_audio', { 'channel_id': channel_id, 'user_id': user_id, 'nonce': nonce, 'format': 'mp3', 'duration_secs': duration_secs })
    
    def __resolve_client_user_id(self, ssrc):
        with self.lock:
            return self.ssrc_to_client_user_id.get(ssrc)

    def __listen(self):
        print('VOICE CONNECTION ' + self.guild_id + ' listening')
        channel_id = self.channel_id
        buffer = b"\x00" * desired_frame_size * channels * sample_width
        secret_box = nacl.secret.SecretBox(bytes(self.secret_key))
        error = ctypes.c_int(0)
        decoder = pyogg.opus.opus_decoder_create(pyogg.opus.opus_int32(frame_rate), ctypes.c_int(channels), ctypes.byref(error))
        streams = {}
        while True:
            for user_id, stream in streams.items():
                if stream.try_flush():
                    threading.Thread(target=self.__callback_audio, kwargs={'channel_id': channel_id, 'user_id': user_id, 'nonce': stream.get_nonce(), 'duration_secs': stream.get_duration_secs()}).start()
                    stream.reset()
            try:
                with self.lock:
                    if not self.listener:
                        break
                package, address = self.socket.recvfrom(UDP_MAX_PAYLOAD)
                # print('VOICE CONNECTION received voice data package from ' + address[0] + ':' + str(address[1]) + ': ' + str(len(data)) + 'b')
                if len(package) <= 8:
                    continue
                sequence, timestamp, ssrc, voice_chunk = unwrap_voice_package(package, secret_box)
                user_id = self.__resolve_client_user_id(ssrc)
                if not user_id:
                    continue
                effective_frame_size = pyogg.opus.opus_decode(decoder, ctypes.cast(voice_chunk, pyogg.opus.c_uchar_p), pyogg.opus.opus_int32(len(voice_chunk)), ctypes.cast(buffer, pyogg.opus.opus_int16_p), ctypes.c_int(len(buffer) // channels // sample_width), ctypes.c_int(0))
                if effective_frame_size < 0:
                    effective_frame_size = 0
                pcm = buffer[:effective_frame_size * sample_width * channels]
                if effective_frame_size < desired_frame_size:
                    pcm += b"\x00" * (desired_frame_size - effective_frame_size) * sample_width * channels
                if not streams.get(user_id):
                    streams[user_id] = Stream(self.guild_id, channel_id, user_id)
                streams[user_id].write(sequence, timestamp, pcm, random.randint(0, 1 << 30))
            except nacl.exceptions.CryptoError:
                pass
            except OSError:
                pass
        for user_id, stream in streams.items():
            if stream.flush():
                threading.Thread(target=self.__callback_audio, kwargs={'channel_id': channel_id, 'user_id': user_id, 'nonce': stream.get_nonce(), 'duration_secs': stream.get_duration_secs()}).start()
                stream.reset()
        pyogg.opus.opus_decoder_destroy(decoder)
        print('VOICE CONNECTION ' + self.guild_id + ' listener terminated')

    def __stream(self):
        # https://discord.com/developers/docs/topics/voice-connections#encrypting-and-sending-voice
        # https://github.com/Rapptz/discord.py/blob/master/discord/voice_client.py
        print('VOICE CONNECTION ' + self.guild_id + ' streaming')

        buffer = b"\x00" * desired_frame_size * channels * sample_width
        secret_box = nacl.secret.SecretBox(bytes(self.secret_key))
        error = ctypes.c_int(0)
        encoder = pyogg.opus.opus_encoder_create(pyogg.opus.opus_int32(frame_rate), ctypes.c_int(channels), ctypes.c_int(pyogg.opus.OPUS_APPLICATION_AUDIO), ctypes.byref(error))
        if error.value != 0:
            raise RuntimeError(str(error.value))
        if self.mode != "xsalsa20_poly1305":
            raise RuntimeError('unexpected mode: ' + self.mode)
        metric_dimensions = {
                "discord.guild.id": self.guild_id,
                "discord.voicegateway.server": self.endpoint,
                "discord.voicegateway.ip": self.ip,
                "discord.voicegateway.port": self.port,
                "discord.voicegateway.mode": self.mode
            }

        sequence = 0
        path = None
        file = None
        timestamp = time_millis()
        last_heartbeat = timestamp
        last_heartbeat_sequence = sequence
        while True:
            # check if source has changed
            paused = False
            with self.lock:
                if not self.streamer:
                    break
                if not path and not self.path:
                    pass
                elif path and not self.path:
                    file.close()
                    try:
                        os.remove(path)
                    except:
                        pass
                    file = None
                    path = None
                    print('VOICE CONNECTION ' + self.guild_id + ' stream completed')
                    threading.Thread(target=self.__callback_playback_finished).start()
                elif not path and self.path:
                    path = self.path
                    if not os.path.exists(path):
                        print('VOICE CONNECTION ' + self.guild_id + ' skipping source because local file is not available')
                        path = None
                        self.path = None
                        threading.Thread(target=self.__callback_playback_finished).start()
                    else:
                        file = wave.open(path, 'rb')
                        if file.getframerate() != frame_rate or file.getnchannels() != channels or file.getsampwidth() != sample_width:
                            print('VOICE CONNECTION ' + self.guild_id + ' skipping source because stream does not satisfy requirements')
                            file.close()
                            file = None
                            try:
                                os.remove(path)
                            except:
                                pass
                            path = None
                            self.path = None
                            threading.Thread(target=self.__callback_playback_finished).start()
                        else:
                            print('VOICE CONNECTION ' + self.guild_id + ' streaming ' + path + ' (' + str(file.getnframes() / file.getframerate() / 60) + 'mins)')
                            counter_streams.add(1, { "discord.guild.id": self.guild_id })
                elif path and self.path and path != self.path:
                    file.close()
                    try:
                        os.remove(path)
                    except:
                        pass
                    file = None
                    path = None
                    print('VOICE CONNECTION ' + self.guild_id + ' stream changing source')
                paused = self.paused
            # encode a frame
            opus_frame = None
            if file and not paused:
                pcm = file.readframes(desired_frame_size)
                if len(pcm) == 0:
                    with self.lock:
                        self.path = None
                effective_frame_size = len(pcm) // sample_width // channels
                if effective_frame_size < desired_frame_size:
                    pcm += b"\x00" * (desired_frame_size - effective_frame_size) * sample_width * channels
                encoded_bytes = pyogg.opus.opus_encode(encoder, ctypes.cast(pcm, pyogg.opus.opus_int16_p), ctypes.c_int(desired_frame_size), ctypes.cast(buffer, pyogg.opus.c_uchar_p), pyogg.opus.opus_int32(len(buffer)))
                opus_frame = bytes(buffer[:encoded_bytes])
            else:
                opus_frame = b"\xF8\xFF\xFE"
            # send a frame
            package = create_voice_package(sequence, sequence * desired_frame_size, self.ssrc, secret_box, opus_frame)
            sequence += 1
            try:
                self.socket.sendto(package, (self.ip, self.port))
            except OSError:
                pass
            # check if we need to heartbeat and do so if necessary
            if last_heartbeat + self.heartbeat_interval // 2 <= time_millis():
                heartbeat = time_millis()
                try:
                    self.ws.send(json.dumps({ "op": 3, "d": heartbeat }))
                except: # TODO limit to socket close exceptions
                    pass
                last_heartbeat = heartbeat
                counter_streaming.add((sequence - last_heartbeat_sequence) * frame_duration, metric_dimensions)
                last_heartbeat_sequence = sequence
            # sleep
            new_timestamp = time_millis()
            sleep_time = frame_duration - (new_timestamp - timestamp)
            if sleep_time < 0:
                counter_real_time_violations.add(frame_duration, metric_dimensions)
            elif sleep_time == 0:
                pass
            else:
                time.sleep(sleep_time / 1000.0 * 2) # I have no fucking idea why multiplying this by two results in a clean audio stream!!! (times two is actually just a tad too slow, but not noticable by humans)
                # current theory is that above when calculating effective and desired frame rates, we miss in some places a "divide by 2", reason is that we seem to pass the length in bytes, but as a short pointer. thats inconcistent
            timestamp = new_timestamp

        if path:
            file.close()
            try:
                os.remove(path)
            except:
                pass
        pyogg.opus.opus_encoder_destroy(encoder)
        
        print('VOICE CONNECTION ' + self.guild_id + ' stream closed')

    def __ws_on_open(self, ws):
        print('VOICE GATEWAY ' + self.guild_id + ' connection established')

    def __ws_on_message(self, ws, message):
        with self.lock:
            payload = json.loads(message)
            if payload['op'] != 6: 
                print('VOICE GATEWAY ' + self.guild_id + ' received message: ' + str(payload['op'])) # heartbeat acks are very spammy
            match payload['op']:
                case 8:
                    print('VOICE GATEWAY ' + self.guild_id + ' received hello')
                    payload = json.loads(message)
                    self.heartbeat_interval = payload['d']['heartbeat_interval']
                    print('VOICE GATEWAY ' + self.guild_id + ' sending identify')
                    ws.send(json.dumps({
                        "op": 0,
                        "d": {
                            "server_id": self.guild_id,
                            "user_id": self.user_id,
                            "session_id": self.session_id,
                            "token": self.token
                        }
                    }))
                case 6:
                    # print('VOICE GATEWAY heartbeat acknowledge') # this is quite spammy
                    if self.listener and not self.listener.is_alive():
                        self.listener = threading.Thread(target=self.__listen)
                        self.listener.start()
                    if self.streamer and not self.streamer.is_alive():
                        self.streamer = threading.Thread(target=self.__stream)
                        self.streamer.start()
                case 2:
                    print('VOICE GATEWAY ' + self.guild_id + ' received voice ready')
                    self.ssrc = payload['d']['ssrc']
                    self.ip = payload['d']['ip']
                    self.port = payload['d']['port']
                    modes = payload['d']['modes']
                    my_ip = requests.get('https://ipv4.icanhazip.com/').text.strip()
                    my_port = None
                    print('VOICE CONNECTION ' + self.guild_id + ' opening UDP socket')
                    self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    while not my_port:
                        try:
                            my_port = random.randint(UDP_PORT_MIN, UDP_PORT_MAX)
                            self.socket.bind(('0.0.0.0', my_port))
                            break
                        except:
                            my_port = None
                    print('VOICE GATEWAY ' + self.guild_id + ' sending select protocol')
                    ws.send(json.dumps({
                        "op": 1,
                        "d": {
                            "protocol": "udp",
                            "data": {
                                "address": my_ip,
                                "port": my_port,
                                "mode": "xsalsa20_poly1305"
                            }
                        }
                    }))
                case 4:
                    print('VOICE GATEWAY ' + self.guild_id + ' received session description')
                    self.mode = payload['d']['mode']
                    self.secret_key = payload['d']['secret_key']
                    print('VOICE CONNECTION ' + self.guild_id + ' server ready')
                    self.listener = threading.Thread(target=self.__listen)
                    self.listener.start()
                    print('VOICE GATEWAY ' + self.guild_id + ' sending speaking')
                    ws.send(json.dumps({
                        "op": 5,
                        "d": {
                            "speaking": 1,
                            "delay": 0,
                            "ssrc": self.ssrc
                        }
                    }))
                    self.streamer = threading.Thread(target=self.__stream)
                    self.streamer.start()
                case 5:
                    print('VOICE GATEWAY ' + self.guild_id + ' received speaking')
                    self.ssrc_to_client_user_id[payload['d']['ssrc']] = payload['d']['user_id']
                case 12:
                    print('VOICE GATWAY ' + self.guild_id + ' received streaming')
                    # nothing else to do ...
                case 13:
                    print('VOICE GATEWAY ' + self.guild_id + ' client disconnect')
                    # nothing else to do ...
                case 18:
                    print('VOICE GATEWAY ' + self.guild_id + ' client connect')
                    # self.ssrc_to_client_user_id[payload['d']['audio_ssrc']] = payload['d']['user_id']
                case _:
                    print('VOICE GATEWAY ' + self.guild_id + ' unknown opcode')
                    print(json.dumps(payload))

    def __ws_on_error(self, ws, error):
        print('VOICE GATEWAY ' + self.guild_id + ' error ' + str(error))
        # what else to do?

    def __ws_on_close(self, ws, close_code, close_message):
        print('VOICE GATEWAY ' + self.guild_id + ' close ' + (str(close_code) if close_code else '?') + ': ' + (close_message if close_message else 'unknown'))
        match close_code:
            case 4001: # invalid opcode
                # fault must be in the code somewhere
                # lets wait a bit to avoid busy loops and try again
                self.__stop()
                time.sleep(5)
                self.__try_start()
            case 4002: # failed to decode payload
                # fault must be in the code somewhere
                # lets wait a bit to avoid busy loops and try again
                self.__stop()
                time.sleep(5)
                self.__try_start()
            case 4003: # not authenticated
                # we sent something before identifying, must be race condition
                self.__stop()
                time.sleep(5)
                self.__try_start()
            case 4004: # authentication failed
                # the token is incorrect
                # lets reconnect and get a new one
                with self.lock:
                    self.token = None
                self.__stop()
                threading.Thread(target=self.__callback_reconnect).start()
            case 4005: # already authenticated
                # we sent a second identify message, fault, must be in the code
                # lets wait a bit to avoid busy loops and try again
                self.__stop()
                time.sleep(5)
                self.__try_start()
            case 4006: # session is no longer valid
                # this can happen when we (only bot users) are alone for a while, then the session is killed
                # lets reconnect and get a new session id, most likely we will not get a server update (and with it a new session id) until a real user joins, but that is fine, we will continue / complete connection as soon as a real user is here
                with self.lock:
                    self.session_id = None
                self.__stop()
                threading.Thread(target=self.__callback_reconnect).start()
            case 4009: # session timeout
                # lets try get a new one
                with self.lock:
                    self.session_id = None
                self.__stop()
                threading.Thread(target=self.__callback_reconnect).start()
            case 4011: # server not found
                # lets try get a new one
                with self.lock:
                    self.endpoint = None
                self.__stop()
                threading.Thread(target=self.__callback_reconnect).start()
            case 4012: # unknown protocol
                # not entirely sure what this refers to (the ws protocol, the first HTTP messages, the encoded frames), but either way, i guess the fault must lie in the code
                # lets wait a bit to avoid busy loops and try again
                self.__stop()
                time.sleep(5)
                self.__try_start()
            case 4014: # disconnected (channel was deleted, you were kicked, voice server changed, or the main gateway session was dropped)
                # thats a tricky one, the doc says not to try reconnecting, and we shouldn't open a new gateway connection, but we should try to reconnect on a discord level EXCEPT if we got kicked out of the channel (not the server)
                # we wanna do that because in some cases we can recover by globally reconnecting again (voice server changed, session was dropped) and for situations it doesnt make sense (we got kicked from the server, channel was deleted), the global discord reconnect fails anyway
                # lets just try to reconnect, and IF we got kicked from the channel, then lets hope we get the voice state changed thingy first, so we shut down ourselves actually
                # threading.Thread(target=self.__callback_reconnect).start()
                self.__stop()
                pass # lets NOT reconnect, otherwise stop is not working, gateway connection is closed before the voice state update event is sent!
            case 4015: # voice server crashed
                # lets just try again, if the voice server restarts, we will get a different error as consequence and do it again
                self.__stop()
            case 4016: # unknown encryption mode
                # fault must be in the code somewhere
                # lets wait a bit to avoid busy loops and try again
                self.__stop()
                time.sleep(5)
                self.__try_start()
            case _: # something else
                self.__stop()
                time.sleep(5)
                self.__try_start()
    
    def __try_start(self):
        with self.lock:
            if self.ws or not self.channel_id or not self.session_id or not self.endpoint or not self.token:
                return
            print('VOICE GATEWAY ' + self.guild_id + ' connection starting')
            self.ws = websocket.WebSocketApp(self.endpoint + '?v=4', on_open=self.__ws_on_open, on_message=self.__ws_on_message, on_error=self.__ws_on_error, on_close=self.__ws_on_close)
            threading.Thread(target=self.ws.run_forever).start()
    
    def __stop(self):
        listener = None
        streamer = None
        with self.lock:
            if not self.ws and not self.socket and not self.listener and not self.streamer:
                return
            print('VOICE GATEWAY ' + self.guild_id + ' connection shutting down')
            listener = self.listener
            streamer = self.streamer
            self.listener = None
            self.streamer = None
            if self.socket:
                self.socket.close()
            if self.ws:
                self.ws.close()
        if listener:
            listener.join()
        if streamer:
            streamer.join()
        with self.lock:
            self.socket = None
            self.ssrc = None
            self.ip = None
            self.port = None
            self.ssrc = None
            self.secret_key = None
            self.mode = None
            self.ws = None
            self.ssrc_to_client_user_id.clear()
        print('VOICE GATEWAY ' + self.guild_id + ' connection shut down')

    def on_server_update(self, endpoint, token):
        self.__stop()
        with self.lock:
            self.endpoint = endpoint
            self.token = token
        self.__save()
        self.__try_start()

    def on_state_update(self, channel_id, user_id, session_id, callback_url):
        self.__stop()
        with self.lock:
            self.channel_id = channel_id
            self.user_id = user_id
            self.session_id = session_id
            self.callback_url = callback_url
            if not self.channel_id:
                self.session_id = None
                self.endpoint = None
                self.token = None
        self.__save()
        self.__try_start()

    def on_content_update(self, path):
        def convert(file_from, file_to):
            observed_subprocess_run(['ffmpeg', '-i', file_from, '-ar', str(frame_rate), '-ac', str(channels), '-sample_fmt', 's' + str(sample_width * 8), '-y', file_to]).check_returncode()
        if path.endswith('.wav'):
            file = wave.open(path, "rb")
            all_ok = file.getframerate() == frame_rate and file.getnchannels() == channels and file.getsampwidth() == sample_width
            file.close()
            if not all_ok:
                to_path = '_' + path.rsplit('.', 1)[0] + '.wav'
                convert(path, to_path)
                os.remove(path)
                os.rename(to_path, path)
        else:
            to_path = path.rsplit('.', 1)[0] + '.wav'
            convert(path, to_path)
            path = to_path

        with self.lock:
            self.path = path
            self.paused = False
        self.__save()
        self.__try_start()

    def pause(self):
        with self.lock:
            self.paused = True
        self.__save()

    def resume(self):
        with self.lock:
            self.paused = False
        self.__save()
    
    def is_connecting(self):
        with self.lock:
            return self.channel_id is not None and self.session_id is not None and self.endpoint is not None and self.ws is not None
    
    def is_connected(self):
        with self.lock:
            return self.ws is not None and self.listener is not None and self.streamer is not None

contexts_lock = threading.Lock()
contexts = {}

def get_connection(guild_id):
    with contexts_lock:
        context = contexts.get(guild_id)
        if not context:
            context = contexts[guild_id] = Connection(guild_id)
        return context

def get_connection_count(options):
    count = 0
    with contexts_lock:
        for context in contexts.values():
            if context.is_connected():
                count = count + 1
    yield metrics.Observation(count)

meter.create_observable_gauge('discord.gateway.voice.connections.concurrent', [get_connection_count])

@app.route('/ping', methods=['GET'])
def ping():
    return 'pong'

@app.route('/events/voice_state_update', methods=['POST'])
def voice_state_update():
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    body = request.json
    context = get_connection(body['guild_id'])
    context.on_state_update(body['channel_id'], body['user_id'], body['session_id'], body['callback_url'])
    return 'Success'

@app.route('/events/voice_server_update', methods=['POST'])
def voice_server_update():
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    body = request.json
    context = get_connection(body['guild_id'])
    context.on_server_update(body['endpoint'], body['token'])
    return 'Success'

@app.route('/guilds/<guild_id>/voice/content', methods=['POST'])
def voice_content_update(guild_id):
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    if request.headers['content-type'].startswith('multipart/form-data'):
        file = request.files['file']
        temporary = STORAGE_DIRECTORY + '/temporary.' + str(random.randint(0, 1000000)) + '.' + file.content_type.split('/')[1]
        if not os.path.normpath(temporary).startswith(STORAGE_DIRECTORY):
            raise RuntimeError
        file.save(temporary)
        context = get_connection(guild_id)
        context.on_content_update(resolve_url(guild_id, 'file://' + temporary))
        if os.path.exists(temporary):
            os.unlink(temporary)
        return 'Success'
    elif request.headers['content-type'] == 'application/json':
        body = request.json
        context = get_connection(guild_id)
        try:
            context.on_content_update(resolve_url(guild_id, body['url']))
        except yt_dlp.utils.DownloadError as e:
            if 'Private video' in str(e):
                return Response('Private video', status = 403)
            elif 'blocked' in str(e) or 'copyright' in str(e) or "in your country" in str(e):
                return Response('Blocked video', status = 451)
            elif 'inappropriate' in str(e) or 'confirm your age' in str(e):
                return Response('Age-restricted video', status = 451)
            elif 'account' in str(e) and 'terminated' in str(e):
                return Response('Video not found', status = 404)
            else:
                return Response('Video not found', status = 404)
        except Exception:
            return Response('Internal Error', status = 500)
        return 'Success'
    else:
        return Response('Invalid Request', status=400)
    

@app.route('/guilds/<guild_id>/voice/lookahead', methods=['POST'])
def voice_content_lookahead(guild_id):
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    body = request.json
    try:
        resolve_url(guild_id, body['url'])
    except yt_dlp.utils.DownloadError as e:
        if 'Private video' in str(e):
            return Response('Private video', status = 403)
        elif 'blocked' in str(e) or 'copyright' in str(e) or "in your country" in str(e):
            return Response('Blocked video', status = 451)
        elif 'inappropriate' in str(e) or 'confirm your age' in str(e):
            return Response('Age-restricted video', status = 451)
        elif 'account' in str(e) and 'terminated' in str(e):
            return Response('Video not found', status = 404)
        else:
            return Response('Video not found', status = 404)
    except Exception:
        return Response('Internal Error', status = 500)
    return 'Success'

@app.route('/guilds/<guild_id>/voice/pause', methods=['POST'])
def voice_pause(guild_id):
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    context = get_connection(guild_id)
    context.pause()
    return 'Success'

@app.route('/guilds/<guild_id>/voice/resume', methods=['POST'])
def voice_resume(guild_id):
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    context = get_connection(guild_id)
    context.resume()
    return 'Success'

@app.route('/guilds/<guild_id>/voice/connection', methods=['GET'])
def voice_is_connected(guild_id):
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    end = time_millis() + 1000 * 30
    tryy = 100
    while time_millis() < end:
        context = get_connection(guild_id)
        if context and context.is_connected():
            return Response(context.channel_id, status=200)
        if context and not context.is_connecting():
            return Response('Not found', status=404)
        time.sleep(tryy / 1000.0)
        tryy = tryy * 2
    return Response('Not found', status=404)

@app.route('/guilds/<guild_id>/channels/<channel_id>/audio/users/<user_id>/nonce/<nonce>', methods=['GET'])
def audio(guild_id, channel_id, user_id, nonce):
    # authenticate?
    # attacker would have to know guild_id, channel_id (needs to be in the server), user_id (needs to be in the server or friend), and guess the right nonce, and access it in real-time
    # they would get a small random audio chunk
    for extension in ['wav', 'mp3']:
        path = generate_audio_file_path(guild_id, channel_id, user_id, nonce, extension)
        if os.path.exists(path):
            with open(path, 'rb') as bites:
                return send_file(io.BytesIO(bites.read()), mimetype='audio/' + extension)
    return Response('Not Found', status=404)

def cleanup():
    for file in os.listdir(STORAGE_DIRECTORY):
        if os.path.getmtime(STORAGE_DIRECTORY + '/' + file) + 60 * 15 < time_seconds():
            print('CLEANING ' + file)
            try:
                os.remove(STORAGE_DIRECTORY + '/' + file)
            except:
                pass

def cleanup_loop():
    while True:
        cleanup()
        time.sleep(60)

def main():
    memory_limit = int(os.environ.get('MEMORY_LIMIT', str(0)))
    if memory_limit > 0:
        resource.setrlimit(resource.RLIMIT_AS, (memory_limit, memory_limit))
    if not pyogg.PYOGG_OPUS_AVAIL or not pyogg.PYOGG_OPUS_FILE_AVAIL:
        print('VOICE not ready (opus not available)')
        exit(1)
    for file in os.listdir(SESSION_DIRECTORY):
        if file.startswith('.state.') and file.endswith('.json'):
            get_connection(file[len('.state.'):len(file) - len('.json')])
    threading.Thread(target=cleanup_loop).start()
    print('VOICE ready')
    # app.run(port=HTTP_PORT, ssl_context='adhoc', threaded=True)
    app.run(port=HTTP_PORT, threaded=True)

if __name__ == "__main__":
    main()
