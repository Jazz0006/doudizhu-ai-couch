const sherpa = require("sherpa-onnx-node");

const requiredExports = [
  "LinearResampler",
  "OfflineTts",
  "OnlineRecognizer",
  "Vad",
  "readWave",
  "writeWave",
];
const missingExports = requiredExports.filter((name) => !(name in sherpa));

const result = {
  packageVersion: sherpa.version,
  gitSha1: sherpa.gitSha1,
  gitDate: sherpa.gitDate,
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  requiredExports,
  missingExports,
};

console.log(JSON.stringify(result, null, 2));
if (missingExports.length > 0) process.exitCode = 1;
