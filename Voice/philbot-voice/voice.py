from os import path, environ
import time
import threading
import socket
import json
from flask import Flask, request
import websocket
import nacl.secret
import pyogg
import youtube_dl

# TODO resume after restart, somehow saving and restoring state
# TODO cache and file lookahead so files are created ahead of time
# TODO resolve public IP properly
# TODO callback when playback is finished

UDP_MAX_PAYLOAD = 65507
PORT = environ.get('PORT', 12345)

def run_server():
    server = socket.socket(family=socket.AF_INET, type=socket.SOCK_DGRAM)
    server.bind(('127.0.0.1', PORT))
    while True:
        server.recvfrom(1024 * 1024)

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
    return header + encrypted_voice_chunk

def download_from_youtube(url):
    filename = url[url.index('v=') + 2:]
    if '&' in filename:
        filename = filename[:filename.index('&')]
    if path.exists(filename + '.opus'):
        return 'file://' + filename + '.opus'
    options = {
        'format': 'bestaudio',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'opus', # apparently this makes aac first, opus later
        }],
        'outtmpl': filename + '.aac',
        'nooverwrites': False
    }
    with youtube_dl.YoutubeDL(options) as ydl:
        ydl.download([url])
        return 'file://' + filename + '.opus'

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

    def __stream(self, url, ssrc, secret_key, ip, port):
        # https://discord.com/developers/docs/topics/voice-connections#encrypting-and-sending-voice
        my_socket = self.socket
        if my_socket == None:
            return
        if not url.startswith('file://'):
            raise RuntimeError
        print('VOICE CONNECTION streaming')
        opus_frame_duration = 20
        filename = self.url[len('file://'):]
        secret_box = nacl.secret.SecretBox(bytes(secret_key))
        file = pyogg.OpusFileStream(filename)
        sequence = 0
        frame = file.get_buffer()
        timestamp = time_millis()
        while frame:
            if sequence % (1000 / opus_frame_duration) == 0:
                print('VOICE CONNECTION streaming (sequence ' + str(sequence) + ')')
            package = create_voice_package(sequence, ssrc, secret_box, bytes(frame[0].contents)[0:frame[1]])
            if (len(package) > UDP_MAX_PAYLOAD):
                raise RuntimeError('Package too big for UDP')
            with self.lock:
                if (my_socket != self.socket):
                    return
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
        file.clean_up()

    def __ws_on_open(self, ws):
        with self.lock:
            print('VOICE GATEWAY connection established')

    def __heartbeat(self, interval):
        my_ws = self.ws
        while True:
            time.sleep(interval)
            with self.lock:
                if (self.ws != None and my_ws == self.ws):
                    print('VOICE GATEWAY sending heartbeat')
                    self.ws.send(json.dumps({ "op": 4, "d": 42 }))
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
                    # modes = payload['d']['modes']
                    my_ip = '3.73.14.87' # TODO
                    my_port = PORT
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
                        "op": 1,
                        "d": {
                            "speaking": 1,
                            "delay": 0,
                            "ssrc": self.ssrc
                        }
                    }))
                    time.sleep(1) # give the discord server time to catch up
                    print('VOICE GATEWAY opening UDP socket')
                    self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, UDP_MAX_PAYLOAD * 2)
                    threading.Thread(target=self.__stream, kwargs = { 'url': self.url, 'ssrc': self.ssrc, 'secret_key': self.secret_key, 'ip': self.ip, 'port': self.port }).start()
                case 5:
                    print('VOICE GATEWAY received speaking')
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
    threading.Thread(target=run_server).start()
    print('VOICE CONNECTION server running')
    print('VOICE ready')
    app.run(port=12345)

# https://github.com/ytdl-org/youtube-dl/blob/master/README.md#embedding-youtube-dl