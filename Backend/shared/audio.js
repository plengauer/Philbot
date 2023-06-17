const child_process = require('child_process');
const { PassThrough } = require('stream');
const fs = require('fs');

function translate(input_stream, input_format, output_format) {
  if (input_format == output_format) return input_stream;
  let convertion = child_process.spawn("ffmpeg", ["-i", "pipe:0", "-f", output_format, "pipe:1"]);
  input_stream.pipe(convertion.stdin);
  return convertion.stdout;
}

function merge(inputs, output_format) {
  for (let input of inputs) {
    input.stream = translate(input.stream, input.format, 'wav');
    input.format = 'wav';
  }

  let merged = new PassThrough();
  for (let index = 0; index < inputs.length; index++) {
    inputs[index].stream.pipe(merged, { end: index == inputs.length - 1 });
  }
  return translate(merged, 'wav', output_format);
}

module.exports = { translate, merge }
