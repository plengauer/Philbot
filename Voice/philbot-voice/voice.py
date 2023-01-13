from os import path, environ
import time
import random
import threading
import socket
import json
import requests
import subprocess
from flask import Flask, request
import websocket
import nacl.secret
import pyogg
import pyogg.opus
import ctypes
import wave
import youtube_dl
from opentelemetry import trace as OpenTelemetry
from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
    OTLPSpanExporter,
)
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider, sampling
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
)

# TODO now we need to select a separate port every time, and we need to open up more UDP on the EC2
# TODO resume after restart, somehow saving and restoring state
# TODO cache and file lookahead so files are created ahead of time
# TODO resolve public IP properly
# TODO callback when playback is finished

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
  "service.name": environ['SERVICE_NAME'],
  "service.version": environ['SERVICE_VERSION']
})
resource = Resource.create(merged)
tracer_provider = TracerProvider(sampler=sampling.ALWAYS_ON, resource=resource)
tracer_provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(
        endpoint=environ['OPENTELEMETRY_TRACES_API_ENDPOINT'],
        headers={ "Authorization": 'Api-Token ' + environ['OPENTELEMETRY_TRACES_API_TOKEN'] },
    ))
)
OpenTelemetry.set_tracer_provider(tracer_provider)

UDP_MAX_PAYLOAD = 65507
HTTP_PORT = int(environ.get('HTTP_PORT', str(12345)))
UDP_PORT_MIN = int(environ.get('UDP_PORT_MIN', str(12346)))
UDP_PORT_MAX = int(environ.get('UDP_PORT_MAX', str(65535)))

app = Flask(__name__)

def time_seconds():
    return int(time.time())

def time_millis():
    return round(time.time() * 1000)

def create_voice_package_header(sequence, ssrc):
    timestamp = time_seconds()
    header = bytearray()
    header.append(0x80)
    header.append(0x78)
    header.append((sequence >> 8) & 0xFF)
    header.append((sequence >> 0) & 0xFF)
    header.append((timestamp >> (3*8)) & 0xFF)
    header.append((timestamp >> (2*8)) & 0xFF)
    header.append((timestamp >> (1*8)) & 0xFF)
    header.append((timestamp >> (0*8)) & 0xFF)
    header.append((ssrc >> (3*8)) & 0xFF)
    header.append((ssrc >> (2*8)) & 0xFF)
    header.append((ssrc >> (1*8)) & 0xFF)
    header.append((ssrc >> (0*8)) & 0xFF)
    for _ in range(12):
        header.append(0x00)
    return bytes(header)

def create_voice_package(sequence, ssrc, secret_box, voice_chunk):
    header = create_voice_package_header(sequence, ssrc)
    encrypted_voice_chunk = secret_box.encrypt(voice_chunk, header)
    return header + encrypted_voice_chunk.ciphertext

def download_from_youtube(url):
    codec = 'wav'
    filename = url[url.index('v=') + 2:]
    if '&' in filename:
        filename = filename[:filename.index('&')]
    if path.exists(filename + '.' + codec):
        return 'file://' + filename + '.' + codec
    options = {
        'format': 'bestaudio',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': codec, # apparently this makes aac first, opus later
            'preferredquality': '128' # kbps
        }],
        'outtmpl': filename + '.aac',
        'nooverwrites': False
    }
    with youtube_dl.YoutubeDL(options) as ydl:
        ydl.download([url])
        return 'file://' + filename + '.' + codec

def resolve_url(url):
    if url.startswith('https://www.youtube.com/watch?v='):
        return download_from_youtube(url)
    else:
        raise RuntimeError

class Context:
    lock = threading.Lock()
    guild_id = None
    channel_id = None
    user_id = None
    session_id = None
    endpoint = None
    token = None
    url = None

    ws = None
    socket = None
    ssrc = None
    ip = None
    port = None
    mode = None
    secret_key = None

    def __init__(self, guild_id):
        self.guild_id = guild_id

    def __run_server(self):
        my_socket = self.socket
        if my_socket == None:
            return
        while True:
            with self.lock:
                if (my_socket != self.socket):
                    break
            try:
                data, address = my_socket.recvfrom(UDP_MAX_PAYLOAD)
                # print('VOICE CONNECTION received voice data package from ' + address[0] + ':' + str(address[1]) + ': ' + str(len(data)) + 'b')
            except:
                break
        print('VOICE CONNECTION terminated')

    def __stream(self, url, ssrc, secret_key, ip, port):
        # https://discord.com/developers/docs/topics/voice-connections#encrypting-and-sending-voice
        my_socket = self.socket
        if my_socket == None:
            return
        if not url.startswith('file://'):
            raise RuntimeError
        print('VOICE CONNECTION streaming')
        filename = self.url[len('file://'):]
        secret_box = nacl.secret.SecretBox(bytes(secret_key))
        sequence = 0
        if filename.endswith('.opus') or filename.endswith('.ogg'):
            opus_frame_duration = 20
            file = pyogg.OpusFileStream(filename)
            frame = file.get_buffer()
            timestamp = time_millis()
            while frame:
                package = create_voice_package(sequence, ssrc, secret_box, bytes(frame[0].contents)[0:frame[1]//2])
                with self.lock:
                    if (my_socket != self.socket):
                        break
                    my_socket.sendto(package, (ip, port))
                sequence += 1
                frame = file.get_buffer()
                new_timestamp = time_millis()
                sleep_time = opus_frame_duration - (new_timestamp - timestamp)
                if sleep_time < 0:
                    # we are behind, what to do?
                    pass
                elif sleep_time == 0:
                    pass
                else:
                    time.sleep(sleep_time / 1000.0)
                timestamp = new_timestamp
        elif filename.endswith('.wav') or filename.endswith('.wave'):
            package_duration = 20
            file = wave.open(filename, "rb")
            # encoder = pyogg.opus.OpusEncoder()
            # encoder.set_application("audio")
            # encoder.set_sampling_frequency(file.getframerate())
            # encoder.set_channels(file.getnchannels())
            # https://www.opus-codec.org/docs/html_api/group__opusencoder.html
            if (file.getframerate() != 48000):
                file.close()
                subprocess.run(['mv', filename, filename + '.backup']).check_returncode()
                subprocess.run(['ffmpeg', '-i', filename + '.backup', '-ar', '48000', filename]).check_returncode()
                subprocess.run(['rm', filename + '.backup']).check_returncode()
                file = wave.open(filename, 'rb')
            if file.getframerate() != 48000:
                raise RuntimeError('unexpected frequency: ' + str(file.getframerate()))
            if file.getnchannels() != 2:
                raise RuntimeError('unexpected channel count: ' + str(file.getnchannels()))
            if file.getsampwidth() != 2:
                raise RuntimeError('unexpected sample width: ' + str(file.getsampwidth()))
            print('VOICE CONNECTION streaming ' + filename + ' (' + str(file.getnframes() / file.getframerate() / 60) + 'mins)')
            error = ctypes.c_int(0)
            encoder = pyogg.opus.opus_encoder_create(
                pyogg.opus.opus_int32(file.getframerate()),
                ctypes.c_int(file.getnchannels()),
                ctypes.c_int(pyogg.opus.OPUS_APPLICATION_VOIP),
                ctypes.byref(error)
            )
            if error.value != 0:
                raise RuntimeError(str(error))
            buffer = b"\x00" * 1024 * 1024
            desired_frame_duration = package_duration / 1000
            desired_frame_size = int(desired_frame_duration * file.getframerate())
            timestamp = time_millis()
            while True:
                pcm = file.readframes(desired_frame_size)
                if len(pcm) == 0:
                    break
                effective_frame_size = len(pcm) // file.getsampwidth() // file.getnchannels()
                if effective_frame_size < desired_frame_size:
                    pcm += b"\x00" * (desired_frame_size - effective_frame_size) * file.getsampwidth() * file.getnchannels()
                # opus = encoder.encode(pcm)
                encoded_bytes = pyogg.opus.opus_encode(encoder,
                    ctypes.cast(pcm, pyogg.opus.opus_int16_p),
                    ctypes.c_int(effective_frame_size),
                    ctypes.cast(buffer, pyogg.opus.c_uchar_p),
                    pyogg.opus.opus_int32(len(buffer))
                )
                opus = bytes(buffer[:encoded_bytes])
                package = create_voice_package(sequence, ssrc, secret_box, opus)
                with self.lock:
                    if (my_socket != self.socket):
                        break
                    my_socket.sendto(package, (ip, port))
                new_timestamp = time_millis()
                sleep_time = package_duration * 1000 - (new_timestamp - timestamp)
                if sleep_time < 0:
                    # we are behind, what to do?
                    pass
                elif sleep_time == 0:
                    pass
                else:
                    time.sleep(sleep_time / 1000.0)
                timestamp = new_timestamp
                sequence += 1
            pyogg.opus.opus_encoder_destroy(encoder)
            file.close()
        else:
            raise RuntimeError()
        print('VOICE CONNECTION stream completed')

    def __ws_on_open(self, ws):
        with self.lock:
            print('VOICE GATEWAY connection established')

    def __heartbeat(self, interval):
        start = time_millis()
        my_ws = self.ws
        while True:
            time.sleep(interval / 1000.0)
            with self.lock:
                if (self.ws != None and my_ws == self.ws):
                    print('VOICE GATEWAY sending heartbeat')
                    self.ws.send(json.dumps({ "op": 4, "d": time_millis() - start }))
                else:
                    return

    def __ws_on_message(self, ws, message):
        with self.lock:
            payload = json.loads(message)
            print('VOICE GATEWAY received message: ' + str(payload['op']))
            match payload['op']:
                case 8:
                    print('VOICE GATEWAY received hello')
                    payload = json.loads(message)
                    heartbeat_interval = payload['d']['heartbeat_interval']
                    threading.Thread(target=self.__heartbeat, kwargs={ 'interval': heartbeat_interval }).start()
                    print('VOICE GATEWAY sending identify')
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
                    print('VOICE GATEWAY heartbeat acknowledge')
                case 2:
                    print('VOICE GATEWAY received voice ready')
                    self.ssrc = payload['d']['ssrc']
                    self.ip = payload['d']['ip']
                    self.port = payload['d']['port']
                    modes = payload['d']['modes']
                    if ("xsalsa20_poly1305" not in modes):
                        raise RuntimeError('Mode not supported')
                    my_ip = requests.get('https://ipv4.icanhazip.com/').text.strip()
                    my_port = None
                    print('VOICE CONNECTION opening UDP socket')
                    self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    while not my_port:
                        try:
                            my_port = random.randint(UDP_PORT_MIN, UDP_PORT_MAX)
                            self.socket.bind(('0.0.0.0', my_port))
                            break
                        except:
                            my_port = None
                    threading.Thread(target=self.__run_server).start()
                    print('VOICE CONNECTION server ready at ' + my_ip + ':' + str(my_port))
                    print('VOICE GATEWAY sending select protocol')
                    self.ws.send(json.dumps({
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
                    print('VOICE GATEWAY received session description')
                    self.mode = payload['d']['mode']
                    self.secret_key = payload['d']['secret_key']
                    print('VOICE GATEWAY sending speaking')
                    self.ws.send(json.dumps({
                        "op": 5,
                        "d": {
                            "speaking": 1,
                            "delay": 0,
                            "ssrc": self.ssrc
                        }
                    }))
                    time.sleep(1) # give the discord server time to catch up
                    threading.Thread(target=self.__stream, kwargs = { 'url': self.url, 'ssrc': self.ssrc, 'secret_key': self.secret_key, 'ip': self.ip, 'port': self.port }).start()
                case 5:
                    print('VOICE GATEWAY received speaking')
                    # nothing else to do ...
                case 13:
                    print('VOICE GATEWAY client disconnect')
                    # nothing else to do ...
                case _:
                    print('VOICE GATEWAY unknown opcode')
                    print(json.dumps(payload))

    def __ws_on_error(self, ws, error):
        with self.lock:
            print('VOICE GATEWAY error ' + str(error))
            self.ws.close()

    def __ws_on_close(self, ws, close_code, close_message):
        with self.lock:
            print('VOICE GATEWAY connection closed (' + str(close_code) + ': ' + close_message + ')')
            self.ws = None
            if (self.socket != None):
                self.socket.close()
            self.socket = None
            self.ssrc = None
            self.ip = None
            self.port = None
            self.ssrc = None
            self.secret_key = None
            self.__try_start() # if we closed intentionally, channel id will be null
    
    def __try_start(self):
        if (self.ws != None or self.channel_id == None or self.session_id == None or self.endpoint == None or self.token == None or self.url == None):
            return
        self.ws = websocket.WebSocketApp(self.endpoint + '?v=4', on_open=self.__ws_on_open, on_message=self.__ws_on_message, on_error=self.__ws_on_error, on_close=self.__ws_on_close)
        threading.Thread(target=self.ws.run_forever).start()
    
    def __stop(self):
        if (self.ws == None):
            return
        self.ws.close()

    def on_server_update(self, endpoint, token):
        with self.lock:
            # TODO this will reset the content - is that fine?
            self.endpoint = endpoint
            self.token = token
            self.__stop()
            self.__try_start()

    def on_state_update(self, channel_id, user_id, session_id):
        with self.lock:
            self.channel_id = channel_id
            self.user_id = user_id
            self.session_id = session_id
            if (self.channel_id == None):
                self.__stop()
            else:
                self.__try_start()

    def on_content_update(self, url):
        with self.lock:
            self.url = url
            # TODO is this really correct? it should be but it could maybe be made more efficient but just resetting the streamed file
            self.__stop()
            self.__try_start()

contexts_lock = threading.Lock()
contexts = {}

def get_context(guild_id):
    with contexts_lock:
        context = contexts.get(guild_id)
        if (context == None):
            context = contexts[guild_id] = Context(guild_id)
        return context

@app.route('/ping', methods=['GET'])
def ping():
    return 'pong'

@app.route('/voice_state_update', methods=['POST'])
def voice_state_update():
    body = request.json
    context = get_context(body['guild_id'])
    context.on_state_update(body['channel_id'], body['user_id'], body['session_id'])
    return 'Success'

@app.route('/voice_server_update', methods=['POST'])
def voice_server_update():
    body = request.json
    context = get_context(body['guild_id'])
    context.on_server_update(body['endpoint'], body['token'])
    return 'Success'

@app.route('/voice_content_update', methods=['POST'])
def voice_content_update():
    body = request.json
    context = get_context(body['guild_id'])
    context.on_content_update(resolve_url(body['url']))
    return 'Success'

def main():
    print('VOICE ready')
    app.run(port=HTTP_PORT)

# https://github.com/ytdl-org/youtube-dl/blob/master/README.md#embedding-youtube-dl
