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
  if (inputs.length == 0) throw new Error();

  for (let input of inputs) {
    input.stream = translate(input.stream, input.format, 'wav');
    input.format = 'wav';
  }

  let merged = new PassThrough();
  for (let i = 0; i < inputs.length; i++) {
    const index = i;
    inputs[index].stream.on('end', () => {
      if (index == inputs.length - 1) merged.end();
      else inputs[index + 1].stream.pipe(merged, { end: false });
    });
  }
  inputs[0].stream.pipe(merged, { end: false });

  return translate(merged, 'wav', output_format);
}

module.exports = { translate, merge }
