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

# TODO resume after restart, somehow saving and restoring state
# TODO somehow switching content is not shutting down the websocket
# TODO connect and disconnect have to be regular API calls, otherwise playback finished will not disconnect

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
tracer_provider = TracerProvider(sampler=sampling.ALWAYS_ON, resource=resource)
tracer_provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(
        endpoint=os.environ['OPENTELEMETRY_TRACES_API_ENDPOINT'],
        headers={ "Authorization": 'Api-Token ' + os.environ['OPENTELEMETRY_TRACES_API_TOKEN'] },
    ))
)
OpenTelemetry.set_tracer_provider(tracer_provider)

UDP_MAX_PAYLOAD = 65507
HTTP_PORT = int(os.environ.get('HTTP_PORT', str(12345)))
UDP_PORT_MIN = int(os.environ.get('UDP_PORT_MIN', str(12346)))
UDP_PORT_MAX = int(os.environ.get('UDP_PORT_MAX', str(65535)))

app = Flask(__name__)

def time_seconds():
    return int(time.time())

def time_millis():
    return round(time.time() * 1000)

def create_voice_package_header(sequence, timestamp, ssrc):
    header = bytearray(12)
    header[0] = 0x80
    header[1] = 0x78
    struct.pack_into('>H', header, 2, sequence)
    struct.pack_into('>I', header, 4, timestamp)
    struct.pack_into('>I', header, 8, ssrc)
    return bytes(header)

def create_voice_package(sequence, timestamp, ssrc, secret_box, voice_chunk):
    header = create_voice_package_header(sequence, timestamp, ssrc)
    nonce = bytearray(24)
    nonce[:12] = header
    return header + secret_box.encrypt(voice_chunk, bytes(nonce)).ciphertext

def download_from_youtube(url):
    codec = 'wav'
    filename = url[url.index('v=') + 2:]
    if '&' in filename:
        filename = filename[:filename.index('&')]
    if os.path.exists(filename + '.' + codec):
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
        return filename + '.' + codec

def resolve_url(url):
    filename = None    
    if url.startswith('https://www.youtube.com/watch?v='):
        filename = download_from_youtube(url)
    else:
        raise RuntimeError
    file = wave.open(filename, "rb")
    if (file.getframerate() != 48000):
        file.close()
        subprocess.run(['mv', filename, filename + '.backup']).check_returncode()
        subprocess.run(['ffmpeg', '-i', filename + '.backup', '-ar', '48000', filename]).check_returncode() # , '-f', 's16le'
        subprocess.run(['rm', filename + '.backup']).check_returncode()
        file = wave.open(filename, 'rb')
    if (file.getnchannels() != 2):
        file.close()
        subprocess.run(['mv', filename, filename + '.backup']).check_returncode()
        subprocess.run(['ffmpeg', '-i', filename + '.backup', '-ac', '2', filename]).check_returncode() # , '-f', 's16le'
        subprocess.run(['rm', filename + '.backup']).check_returncode()
        file = wave.open(filename, 'rb')
    if file.getsampwidth() != 2:
        raise RuntimeError('unexpected sample width: ' + str(file.getsampwidth()))
    file.close()
    return 'file://' + filename


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
                        'url': self.url
                    }))
            else:
                try:
                    os.remove(filename)
                except:
                    pass

    def __listen(self):
        print('VOICE CONNECTION ' + self.guild_id + ' listening')
        while True:
            with self.lock:
                if not self.listener:
                    break
            try:
                data, address = self.socket.recvfrom(UDP_MAX_PAYLOAD)
                # print('VOICE CONNECTION received voice data package from ' + address[0] + ':' + str(address[1]) + ': ' + str(len(data)) + 'b')
            except: # TODO limit to socket closed exceptions only
                pass
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
        encoder = pyogg.opus.opus_encoder_create(
            pyogg.opus.opus_int32(frame_rate),
            ctypes.c_int(channels),
            ctypes.c_int(pyogg.opus.OPUS_APPLICATION_AUDIO),
            ctypes.byref(error)
        )
        if error.value != 0:
            raise RuntimeError(str(error.value))
        if self.mode != "xsalsa20_poly1305":
            raise RuntimeError('unexpected mode: ' + self.mode)

        sequence = 0
        filename = None
        file = None
        timestamp = time_millis()
        last_heartbeat = timestamp
        while True:
            # check if source has changed
            with self.lock:
                if not self.streamer:
                    break
                if not filename and not self.url:
                    pass
                elif filename and not self.url:
                    file.close()
                    os.remove(filename)
                    file = None
                    filename = None
                    print('VOICE CONNECTION ' + self.guild_id + ' stream completed')
                elif not filename and self.url:
                    filename = self.url[len('file://'):]
                    file = wave.open(filename, 'rb')
                    print('VOICE CONNECTION ' + self.guild_id + ' streaming ' + filename + ' (' + str(file.getnframes() / file.getframerate() / 60) + 'mins)')
                elif filename and self.url and filename != self.url[len('file://'):]:
                    file.close()
                    os.remove(filename)
                    file = None
                    filename = None
                    print('VOICE CONNECTION ' + self.guild_id + ' stream changing source')
            # encode a frame
            opus_frame = None
            if file:
                pcm = file.readframes(desired_frame_size)
                if len(pcm) == 0:
                    file.close()
                    os.remove(filename)
                    file = None
                    filename = None
                    threading.Thread(target=requests.post, kwargs={'url': self.callback_url, 'json': { "guild_id": self.guild_id, "user_id": self.user_id }}).start()
                effective_frame_size = len(pcm) // sample_width // channels
                if effective_frame_size < desired_frame_size:
                    pcm += b"\x00" * (desired_frame_size - effective_frame_size) * sample_width * channels
                encoded_bytes = pyogg.opus.opus_encode(encoder, ctypes.cast(pcm, pyogg.opus.opus_int16_p), ctypes.c_int(effective_frame_size), ctypes.cast(buffer, pyogg.opus.c_uchar_p), pyogg.opus.opus_int32(len(buffer)))
                opus_frame = bytes(buffer[:encoded_bytes])
            else:
                opus_frame = b"\x00" * desired_frame_size * sample_width * channels
            # send a frame
            package = create_voice_package(sequence, sequence * desired_frame_size, self.ssrc, secret_box, opus_frame)
            sequence += 1
            try:
                self.socket.sendto(package, (self.ip, self.port))
            except: # TODO limit to socket close exceptions only
                pass
            # check if we need to heartbeat and do so if necessary
            if last_heartbeat + self.heartbeat_interval // 2 <= time_millis():
                try:
                    last_heartbeat = time_millis()
                    self.ws.send(json.dumps({ "op": 3, "d": last_heartbeat }))
                except: # TODO limit to socket close exceptions
                    pass
            # sleep
            new_timestamp = time_millis()
            sleep_time = frame_duration - (new_timestamp - timestamp)
            if sleep_time < 0:
                # we are behind, what to do?
                pass
            elif sleep_time == 0:
                pass
            else:
                time.sleep(sleep_time / 1000.0 * 2) # I have no fucking idea why multiplying this by two results in a clean audio stream!!! (times to is actually just a tad too slow, but not noticable by humans)
            timestamp = new_timestamp

        if filename:
            file.close()
            os.remove(filename)
        pyogg.opus.opus_encoder_destroy(encoder)
        
        print('VOICE CONNECTION ' + self.guild_id + ' stream closed')
        

    def __ws_on_open(self, ws):
        with self.lock:
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
                    pass
                case 2:
                    print('VOICE GATEWAY ' + self.guild_id + ' received voice ready')
                    self.ssrc = payload['d']['ssrc']
                    self.ip = payload['d']['ip']
                    self.port = payload['d']['port']
                    modes = payload['d']['modes']
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
                    print('VOICE CONNECTION ' + self.guild_id + ' server ready at ' + my_ip + ':' + str(my_port))
                    self.listener = threading.Thread(target=self.__listen)
                    self.listener.start()
                    print('VOICE GATEWAY sending select protocol')
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
                    print('VOICE GATEWAY sending speaking')
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
                case _:
                    print('VOICE GATEWAY ' + self.guild_id + ' unknown opcode')
                    print(json.dumps(payload))

    def __ws_on_error(self, ws, error):
        print('VOICE GATEWAY ' + self.guild_id + ' error ' + str(error))
        # what to do?

    def __ws_on_close(self, ws, close_code, close_message):
        print('VOICE GATEWAY ' + self.guild_id + ' close ' + (str(close_code) if close_code else '?') + ': ' + (close_message if close_message else 'unknown'))
        self.__stop()
    
    def __try_start(self):
        with self.lock:
            if self.ws or not self.channel_id or not self.session_id or not self.endpoint or not self.token or not self.url:
                return
            print('VOICE GATEWAY ' + self.guild_id + ' connection starting')
            self.ws = websocket.WebSocketApp(self.endpoint + '?v=4', on_open=self.__ws_on_open, on_message=self.__ws_on_message, on_error=self.__ws_on_error, on_close=self.__ws_on_close)
            threading.Thread(target=self.ws.run_forever).start()
    
    def __stop(self):
        print('VOICE GATEWAY ' + self.guild_id + ' connection shutting down')
        listener = None
        streamer = None
        with self.lock:
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
        self.__try_start() # if we closed intentionally, channel id will be null

    def on_server_update(self, endpoint, token):
        with self.lock:
            self.endpoint = endpoint
            self.token = token
        self.__save()
        self.__stop()
        self.__try_start()


    def on_state_update(self, channel_id, user_id, session_id, callback_url):
        with self.lock:
            self.channel_id = channel_id
            self.user_id = user_id
            self.session_id = session_id
            self.callback_url = callback_url
            if not self.channel_id:
                self.endpoint = None
                self.token = None
        if not self.channel_id:
            self.__stop()
        else:
            self.__try_start()
        self.__save()

    def on_content_update(self, url):
        with self.lock:
            self.url = url
        self.__try_start()
        self.__save()

contexts_lock = threading.Lock()
contexts = {}

def get_context(guild_id):
    with contexts_lock:
        context = contexts.get(guild_id)
        if not context:
            context = contexts[guild_id] = Context(guild_id)
        return context

@app.route('/ping', methods=['GET'])
def ping():
    return 'pong'

@app.route('/voice_state_update', methods=['POST'])
def voice_state_update():
    body = request.json
    context = get_context(body['guild_id'])
    context.on_state_update(body['channel_id'], body['user_id'], body['session_id'], body['callback_url'])
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
    try:
        context.on_content_update(resolve_url(body['url']))
    except youtube_dl.utils.DownloadError as e:
        if 'Private video' in str(e):
            return Response('Private video', status = 403)
        elif 'blocked' in str(e) or 'unavailable' in str(e):
            return Response('Blocked video', status = 451)
        else:
            return Response('Video not found', status = 404)
    return 'Success'

@app.route('/voice_content_lookahead', methods=['POST'])
def voice_content_lookahead():
    body = request.json
    try:
        resolve_url(body['url'])
    except youtube_dl.utils.DownloadError as e:
        if 'Private video' in str(e):
            return Response('Private video', status = 403)
        elif 'blocked' in str(e) or 'unavailable' in str(e):
            return Response('Blocked video', status = 451)
        else:
            return Response('Video not found', status = 404)
    return 'Success'

def main():
    for file in os.listdir('.'):
        if not file.startswith('.state.') or not file.endswith('.json'):
            continue
        guild_id = file[len('.state.'):len(file) - len('.json')]
        get_context(guild_id)
    print('VOICE ready')
    app.run(port=HTTP_PORT)

# https://github.com/ytdl-org/youtube-dl/blob/master/README.md#embedding-youtube-dl
