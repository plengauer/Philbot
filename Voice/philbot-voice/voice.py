import os
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
from flask import Flask, request, Response
import yt_dlp
import opentelemetry
from opentelemetry.sdk.resources import Resource
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.trace import TracerProvider, sampling
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

merged = dict()
for name in ["dt_metadata_e617c525669e072eebe3d0f08212e8f2.json", "/var/lib/dynatrace/enrichment/dt_metadata.json"]:
    try:
        data = ''
        with open(name) as f:
            data = json.load(f if name.startswith("/var") else open(f.read()))
        merged.update(data)
    except:
        pass
merged.update({
  "service.name": os.environ['SERVICE_NAME'],
  "service.version": os.environ['SERVICE_VERSION']
})
resource = Resource.create(merged)

os.environ['OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE'] = 'delta'
meter_provider = MeterProvider(metric_readers = [ PeriodicExportingMetricReader(OTLPMetricExporter(
    endpoint = os.environ['OPENTELEMETRY_METRICS_API_ENDPOINT'],
    headers = { 'Authorization': 'Api-Token ' + os.environ['OPENTELEMETRY_METRICS_API_TOKEN'] }
#    preferred_temporality = { Counter: AggregationTemporality.DELTA }
)) ], resource = resource)
opentelemetry.metrics.set_meter_provider(meter_provider)

tracer_provider = TracerProvider(sampler=sampling.ALWAYS_ON, resource=resource)
tracer_provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(
        endpoint = os.environ['OPENTELEMETRY_TRACES_API_ENDPOINT'],
        headers = { 'Authorization': 'Api-Token ' + os.environ['OPENTELEMETRY_TRACES_API_TOKEN'] }
    ))
)
opentelemetry.trace.set_tracer_provider(tracer_provider)

UDP_MAX_PAYLOAD = 65507
HTTP_PORT = int(os.environ.get('HTTP_PORT', str(12345)))
UDP_PORT_MIN = int(os.environ.get('UDP_PORT_MIN', str(12346)))
UDP_PORT_MAX = int(os.environ.get('UDP_PORT_MAX', str(65535)))
STORAGE_DIRECTORY = os.environ['STORAGE_DIRECTORY']

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

def create_voice_package(sequence, timestamp, ssrc, secret_box, voice_chunk):
    header = create_voice_package_header(sequence, timestamp, ssrc)
    nonce = bytearray(24)
    nonce[:12] = header
    return header + secret_box.encrypt(voice_chunk, bytes(nonce)).ciphertext

def unwrap_voice_package(package, secret_box):
    header = package[:12]
    nonce = bytearray(24)
    nonce[:12] = header
    voice_chunk = secret_box.decrypt(package[12:], bytes(nonce))
    return voice_chunk, struct.unpack_from('>H', header, 2)[0], struct.unpack_from('>I', header, 4)[0]

download_lock = threading.Lock()
downloads = {}

def download_from_youtube(guild_id, url):
    codec = 'wav'
    filename = url[url.index('v=') + 2:]
    if '&' in filename:
        filename = filename[:filename.index('&')]
    filename = STORAGE_DIRECTORY + '/' + guild_id + '.' + filename
    if os.path.exists(filename + '.' + codec):
        return filename + '.' + codec
    event = None
    download_in_progress = False
    with download_lock:
        download_in_progress = downloads.get(filename) and not downloads[filename].is_set()
        if not downloads.get(filename):
            downloads[filename] = threading.Event()
        event = downloads[filename]
    if download_in_progress:
        event.wait()
        return download_from_youtube(guild_id, url)
    try:
        options = {
            'quiet': True,
            'no_warnings': True,
            'geo_bypass': True,
            'format': 'bestaudio',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': codec,
                'preferredquality': '128' # kbps
            }],
            'outtmpl': filename,
            'nooverwrites': False
        }
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.download([url])
            return filename + '.' + codec
    finally:
        with download_lock:
            downloads[event] = None
        event.set()

def resolve_url(guild_id, url):
    filename = None    
    if url.startswith('https://www.youtube.com/watch?v='):
        filename = download_from_youtube(guild_id, url)
    else:
        raise RuntimeError
    file = wave.open(filename, "rb")
    if (file.getframerate() != 48000):
        file.close()
        os.rename(filename, '_' + filename)
        subprocess.run(['ffmpeg', '-i', '_' + filename, '-ar', '48000', filename]).check_returncode() # , '-f', 's16le'
        os.remove('_' + filename)
        file = wave.open(filename, 'rb')
    if (file.getnchannels() != 2):
        file.close()
        os.rename(filename, '_' + filename)
        subprocess.run(['ffmpeg', '-i', '_' + filename, '-ac', '2', filename]).check_returncode() # , '-f', 's16le'
        os.remove('_' + filename)
        file = wave.open(filename, 'rb')
    if file.getsampwidth() != 2:
        file.close()
        os.remove(filename)
        raise RuntimeError('unexpected sample width: ' + str(file.getsampwidth()))
    file.close()
    os.utime(filename)
    return 'file://' + filename

counter_streams = meter.create_counter(name = 'discord.gateway.voice.streams', description = 'Number of streams', unit="count")
counter_streaming = meter.create_counter(name = 'discord.gateway.voice.streaming', description = 'Amount of time streamed', unit="milliseconds")

class Context:
    lock = threading.Lock()
    callback_url = None
    guild_id = None
    channel_id = None
    user_id = None
    session_id = None
    endpoint = None
    token = None
    url = None
    paused = False

    ws = None
    socket = None
    heartbeat_interval = None
    ssrc = None
    ip = None
    port = None
    mode = None
    secret_key = None

    listener = None
    streamer = None

    def __init__(self, guild_id):
        self.guild_id = guild_id
        try:
            with open('.state.' + self.guild_id + '.json', 'r') as file:
                state = json.loads(file.read())
                if state['guild_id'] != guild_id:
                    return # silently ignore state file
                self.callback_url = state['callback_url']
                self.channel_id = state['channel_id']
                self.user_id = state['user_id']
                self.session_id = state['session_id']
                self.endpoint = state['endpoint']
                self.token = state['token']
                self.url = state['url']
                self.paused = state['paused']
        except:
            pass
        self.__try_start()

    def __save(self):
        with self.lock:
            filename = '.state.' + self.guild_id + '.json'
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
                        'url': self.url,
                        'paused': self.paused
                    }))
            else:
                try:
                    os.remove(filename)
                except:
                    pass
    
    def __callback(self, reason):
        delay = 1
        while True:
            if delay > 60 * 60:
                break
            try:
                requests.post(self.callback_url + '/' + reason, json={ "guild_id": self.guild_id, "channel_id": self.channel_id, "user_id": self.user_id }, headers={ 'x-authorization': os.environ['DISCORD_API_TOKEN'] }, verify=False)
                break
            except:
                time.sleep(delay)
                delay *= 2

    def __callback_playback_finished(self):
        self.__callback('voice_playback_finished')

    def __callback_reconnect(self):
        self.__callback('voice_reconnect')

    def __listen(self):
        print('VOICE CONNECTION ' + self.guild_id + ' listening')
        frame_duration = 20
        frame_rate = 48000
        sample_width = 2
        channels = 2
        desired_frame_size = int(frame_rate * frame_duration / 1000)
        buffer = b"\x00" * 1024 * 1024
        secret_box = nacl.secret.SecretBox(bytes(self.secret_key))
        error = ctypes.c_int(0)
        decoder = pyogg.opus.opus_decoder_create(pyogg.opus.opus_int32(frame_rate), ctypes.c_int(channels), ctypes.byref(error))
        file = wave.open(STORAGE_DIRECTORY + './output.' + self.guild_id + '.wav', 'wb')
        file.setnchannels(channels)
        file.setsampwidth(sample_width)
        file.setframerate(frame_rate)
        last_sequence = -1
        while True:
            with self.lock:
                if not self.listener:
                    break
            package = None
            try:
                package, address = self.socket.recvfrom(UDP_MAX_PAYLOAD)
            except: # TODO limit to socket closed exceptions only
                continue
            # print('VOICE CONNECTION received voice data package from ' + address[0] + ':' + str(address[1]) + ': ' + str(len(data)) + 'b')
            voice_chunk = None
            sequence = None
            timestamp = None
            try:
                voice_chunk, sequence, timestamp = unwrap_voice_package(package, secret_box)
            except: # TODO limit to wrong encryption (received random package)
                continue
            # TODO in all the following cases, handle and resort properly
            if last_sequence < 0:
                last_sequence = sequence - 1
            if last_sequence + 1 < sequence:
                while last_sequence + 1 != sequence:
                    file.writeframes(b"\x00" * desired_frame_size * sample_width * channels)
                    last_sequence += 1
            elif last_sequence > sequence:
                continue
            last_sequence = sequence
            effective_frame_size = pyogg.opus.opus_decode(decoder, ctypes.cast(voice_chunk, pyogg.opus.c_uchar_p), pyogg.opus.opus_int32(len(voice_chunk)), ctypes.cast(buffer, pyogg.opus.opus_int16_p), ctypes.c_int(len(buffer) // channels // sample_width), ctypes.c_int(0))
            if effective_frame_size < 0:
                effective_frame_size = 0
            pcm = buffer[:effective_frame_size * sample_width * channels]
            if effective_frame_size < desired_frame_size:
                pcm += b"\x00" * (desired_frame_size - effective_frame_size) * sample_width * channels
            file.writeframes(pcm)
        file.close()
        pyogg.opus.opus_decoder_destroy(decoder)
        print('VOICE CONNECTION ' + self.guild_id + ' listener terminated')

    def __stream(self):
        # https://discord.com/developers/docs/topics/voice-connections#encrypting-and-sending-voice
        # https://github.com/Rapptz/discord.py/blob/master/discord/voice_client.py
        print('VOICE CONNECTION ' + self.guild_id + ' streaming')

        frame_duration = 20
        frame_rate = 48000
        sample_width = 2
        channels = 2
        desired_frame_size = int(frame_rate * frame_duration / 1000)
        buffer = b"\x00" * 1024 * 1024
        secret_box = nacl.secret.SecretBox(bytes(self.secret_key))
        error = ctypes.c_int(0)
        encoder = pyogg.opus.opus_encoder_create(pyogg.opus.opus_int32(frame_rate), ctypes.c_int(channels), ctypes.c_int(pyogg.opus.OPUS_APPLICATION_AUDIO), ctypes.byref(error))
        if error.value != 0:
            raise RuntimeError(str(error.value))
        if self.mode != "xsalsa20_poly1305":
            raise RuntimeError('unexpected mode: ' + self.mode)

        sequence = 0
        filename = None
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
                if not filename and not self.url:
                    pass
                elif filename and not self.url:
                    file.close()
                    try:
                        os.remove(filename)
                    except:
                        pass
                    file = None
                    filename = None
                    print('VOICE CONNECTION ' + self.guild_id + ' stream completed')
                    threading.Thread(target=self.__callback_playback_finished).start()
                elif not filename and self.url:
                    filename = self.url[len('file://'):]
                    if not os.path.exists(filename):
                        print('VOICE CONNECTION ' + self.guild_id + ' skipping source because local file is not available')
                        filename = None
                        self.url = None
                        threading.Thread(target=self.__callback_playback_finished).start()
                    else:
                        file = wave.open(filename, 'rb')
                        if file.getframerate() != 48000 or file.getnchannels() != 2 or file.getsampwidth() != 2:
                            print('VOICE CONNECTION ' + self.guild_id + ' skipping source because stream does not satisfy requirements')
                            file.close()
                            file = None
                            try:
                                os.remove(filename)
                            except:
                                pass
                            filename = None
                            self.url = None
                            threading.Thread(target=self.__callback_playback_finished).start()
                        else:
                            print('VOICE CONNECTION ' + self.guild_id + ' streaming ' + filename + ' (' + str(file.getnframes() / file.getframerate() / 60) + 'mins)')
                            counter_streams.add(1, { "guild_id": self.guild_id })
                elif filename and self.url and filename != self.url[len('file://'):]:
                    file.close()
                    try:
                        os.remove(filename)
                    except:
                        pass
                    file = None
                    filename = None
                    print('VOICE CONNECTION ' + self.guild_id + ' stream changing source')
                paused = self.paused
            # encode a frame
            opus_frame = None
            if file and not paused:
                pcm = file.readframes(desired_frame_size)
                if len(pcm) == 0:
                    with self.lock:
                        self.url = None
                effective_frame_size = len(pcm) // sample_width // channels
                if effective_frame_size < desired_frame_size:
                    pcm += b"\x00" * (desired_frame_size - effective_frame_size) * sample_width * channels
                encoded_bytes = pyogg.opus.opus_encode(encoder, ctypes.cast(pcm, pyogg.opus.opus_int16_p), ctypes.c_int(desired_frame_size), ctypes.cast(buffer, pyogg.opus.c_uchar_p), pyogg.opus.opus_int32(len(buffer)))
                opus_frame = bytes(buffer[:encoded_bytes])
                ####################
                #decoder = pyogg.opus.opus_decoder_create(pyogg.opus.opus_int32(frame_rate), ctypes.c_int(channels), ctypes.byref(error))
                #effective_frame_size = pyogg.opus.opus_decode(decoder, ctypes.cast(opus_frame, pyogg.opus.c_uchar_p), pyogg.opus.opus_int32(len(opus_frame)), ctypes.cast(buffer, pyogg.opus.opus_int16_p), ctypes.c_int(len(buffer) // channels // sample_width), ctypes.c_int(0))
                #pcm_reconstructed = buffer[:effective_frame_size]
                #pyogg.opus.opus_decoder_destroy(decoder)
                #encoded_bytes = pyogg.opus.opus_encode(encoder, ctypes.cast(pcm_reconstructed, pyogg.opus.opus_int16_p), ctypes.c_int(desired_frame_size), ctypes.cast(buffer, pyogg.opus.c_uchar_p), pyogg.opus.opus_int32(len(buffer)))
                #opus_frame = bytes(buffer[:encoded_bytes])
                ####################
            else:
                opus_frame = b"\xF8\xFF\xFE"
            # send a frame
            package = create_voice_package(sequence, sequence * desired_frame_size, self.ssrc, secret_box, opus_frame)
            sequence += 1
            try:
                self.socket.sendto(package, (self.ip, self.port))
            except: # TODO limit to socket close exceptions only
                pass
            # check if we need to heartbeat and do so if necessary
            if last_heartbeat + self.heartbeat_interval // 2 <= time_millis():
                heartbeat = time_millis()
                try:
                    self.ws.send(json.dumps({ "op": 3, "d": heartbeat }))
                except: # TODO limit to socket close exceptions
                    pass
                last_heartbeat = heartbeat
                counter_streaming.add((sequence - last_heartbeat_sequence) * frame_duration, {
                    "guild_id": self.guild_id,
                    "server": self.endpoint if self.endpoint else "",
                    "ip": self.ip if self.ip else "",
                    "port": self.port if self.port else 0,
                    "mode": self.mode if self.mode else ""
                })
                last_heartbeat_sequence = sequence
            # sleep
            new_timestamp = time_millis()
            sleep_time = frame_duration - (new_timestamp - timestamp)
            if sleep_time < 0:
                # we are behind, what to do?
                pass
            elif sleep_time == 0:
                pass
            else:
                time.sleep(sleep_time / 1000.0 * 2) # I have no fucking idea why multiplying this by two results in a clean audio stream!!! (times two is actually just a tad too slow, but not noticable by humans)
                # current theory is that above when calculating effective and desired frame rates, we miss in some places a "divide by 2", reason is that we seem to pass the length in bytes, but as a short pointer. thats inconcistent
            timestamp = new_timestamp

        if filename:
            file.close()
            try:
                os.remove(filename)
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
                    currentfile = self.url[len('file://'):] if self.url else None
                    for file in os.listdir('.'):
                        if (file.endswith('.wav') or file.endswith('.aac') or file.endswith('.part')) and self.guild_id in file and os.path.getmtime(file) + 60 * 60 * 1 < time_seconds() and not currentfile == file:
                            os.remove(file)
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
                    # nothing else to do ...
                case 12:
                    print('VOICE GATWAY ' + self.guild_id + ' received streaming')
                    # nothing else to do ...
                case 13:
                    print('VOICE GATEWAY ' + self.guild_id + ' client disconnect')
                    # nothing else to do ...
                case 18:
                    print('VOICE GATEWAY ' + self.guild_id + ' client connect')
                    # nothing else to do ...
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
            self.ws = None
        print('VOICE GATEWAY ' + self.guild_id + ' connection shut down')

    def on_server_update(self, endpoint, token):
        self.__stop()
        with self.lock:
            self.endpoint = endpoint
            self.token = token
        self.__save()
        self.__try_start()

    def on_state_update(self, channel_id, user_id, session_id, callback_url):
        if not self.channel_id:
            self.__stop()
        with self.lock:
            self.channel_id = channel_id
            self.user_id = user_id
            self.session_id = session_id
            self.callback_url = callback_url
            #if not self.channel_id:
            #    self.endpoint = None
            #    self.token = None
        self.__save()
        self.__try_start()

    def on_content_update(self, url):
        with self.lock:
            self.url = url
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
            return self.channel_id is not None and self.session_id is not None and self.endpoint is not None
    
    def is_connected(self):
        with self.lock:
            return self.ws is not None and self.listener is not None and self.streamer is not None

contexts_lock = threading.Lock()
contexts = {}

def get_context(guild_id):
    with contexts_lock:
        context = contexts.get(guild_id)
        if not context:
            context = contexts[guild_id] = Context(guild_id)
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

@app.route('/voice_state_update', methods=['POST'])
def voice_state_update():
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    body = request.json
    context = get_context(body['guild_id'])
    context.on_state_update(body['channel_id'], body['user_id'], body['session_id'], body['callback_url'])
    return 'Success'

@app.route('/voice_server_update', methods=['POST'])
def voice_server_update():
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    body = request.json
    context = get_context(body['guild_id'])
    context.on_server_update(body['endpoint'], body['token'])
    return 'Success'

@app.route('/voice_content_update', methods=['POST'])
def voice_content_update():
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    body = request.json
    context = get_context(body['guild_id'])
    try:
        context.on_content_update(resolve_url(body['guild_id'], body['url']))
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
    return 'Success'

@app.route('/voice_content_lookahead', methods=['POST'])
def voice_content_lookahead():
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    body = request.json
    try:
        resolve_url(body['guild_id'], body['url'])
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
    return 'Success'

@app.route('/voice_pause', methods=['POST'])
def voice_pause():
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    body = request.json
    context = get_context(body['guild_id'])
    context.pause()
    return 'Success'

@app.route('/voice_resume', methods=['POST'])
def voice_resume():
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    body = request.json
    context = get_context(body['guild_id'])
    context.resume()
    return 'Success'

@app.route('/voice_is_connected', methods=['POST'])
def voice_is_connected():
    if not request.headers.get('x-authorization'): return Response('Unauthorized', status=401)
    if request.headers['x-authorization'] != os.environ['DISCORD_API_TOKEN']: return Response('Forbidden', status=403)
    guild_id = request.json['guild_id']
    context = get_context(guild_id)
    if not context or not context.is_connecting():
        return 'false'
    end = time_millis() + 1000 * 5
    tryy = 100
    while time_millis() < end:
        context = get_context(guild_id)
        if context and context.is_connected():
            return 'true'
        time.sleep(tryy / 1000.0)
        tryy = tryy * 2
    return 'false'

def cleanup():
    for file in os.listdir(STORAGE_DIRECTORY):
        if os.path.getmtime(STORAGE_DIRECTORY + '/' + file) + 60 * 60 < time_seconds():
            try:
                os.remove(STORAGE_DIRECTORY + '/' + file)
            except:
                pass

def cleanup_loop():
    while True:
        cleanup()
        time.sleep(60 * 60)

def main():
    for file in os.listdir('.'):
        if file.startswith('.state.') and file.endswith('.json'):
            get_context(file[len('.state.'):len(file) - len('.json')])
    threading.Thread(target=cleanup_loop).start()
    print('VOICE ready')
    # app.run(port=HTTP_PORT, ssl_context='adhoc', threaded=True)
    app.run(port=HTTP_PORT, threaded=True)

