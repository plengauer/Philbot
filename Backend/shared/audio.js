const process = require('process');
const os = require('os');
const child_process = require('child_process');
const { PassThrough } = require('stream');

const DEBUG = (process.env.DEBUG_AUDIO ?? 'false') == 'true';

function translate(input_stream, input_format, output_format) {
  if (input_format == output_format) return input_stream;
  let convertion = ffmpeg(['-i', 'pipe:0', '-f', output_format, 'pipe:1']);
  input_stream.pipe(convertion.stdin);
  return convertion.stdout;
}

function merge(inputs, output_format) {
  if (os.platform() == 'win32') return merge_v0(inputs, output_format);
  else return merge_v1(inputs, output_format);
 }

function merge_v0(inputs, output_format) {
  if (inputs.length == 0) throw new Error();

  for (let input of inputs) {
    input.stream = translate(input.stream, input.format, 'wav');
    input.format = 'wav';
  }

  let merged = new PassThrough();
  for (let i = 0; i < inputs.length; i++) {
    let index = i;
    inputs[index].stream.on('end', () => {
      if (index + 1 < inputs.length) inputs[index + 1].stream.pipe(merged, { end: false });
      else merged.end();
    });
  }
  inputs[0].stream.pipe(merged, { end: false });

  return translate(merged, 'wav', output_format);
}

function merge_v1(inputs, output_format) {
  if (inputs.length == 0) throw new Error();
  // ffmpeg -i input1.wav -i input2.wav -i input3.wav -i input4.wav -filter_complex '[0:0][1:0][2:0][3:0]concat=n=4:v=0:a=1[out]' -map '[out]' output.wav
  // ffmpeg -i pipe:3 -i pipe:4 -filter_complex '[0:0][1:0]concat=n=2:v=0:a=1[out]' -f mp3 -map '[out]' pipe:1
  let input_arguments = [];
  let channel_arguments = [];
  const first_pipe = 3;
  for (let index = 0; index < inputs.length; index++) {
    input_arguments.push('-i');
    input_arguments.push('pipe:' + (first_pipe + index));
    channel_arguments.push('[' + index + ':0]');
  }
  let merging = ffmpeg(
    input_arguments.concat(['-filter_complex', channel_arguments.join('') + 'concat=n=' + inputs.length + ':v=0:a=1[out]', '-f', output_format, '-map', '[out]', 'pipe:1']),
    ['pipe', 'pipe', 'pipe'].concat(inputs.map(_ => 'pipe'))
  );
  for (let index = 0; index < inputs.length; index++) {
    inputs[index].stream.pipe(merging.stdio[first_pipe + index]);
  }
  return merging.stdout;
}

function ffmpeg(arguments, stdio = ['pipe', 'pipe', 'pipe']) {
  let process = child_process.spawn('ffmpeg', arguments, { stdio: stdio });
  if (DEBUG) process.stderr.on('data', chunk => console.log('' + chunk));
  return process;
}

module.exports = { translate, merge }
