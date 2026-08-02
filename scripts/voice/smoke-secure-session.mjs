import { once } from "node:events";
import { readFileSync } from "node:fs";

import { WebSocket } from "ws";
import { encodePcm16Frame } from "@ai-doudizhu/shared-types";

import {
  createAppServer,
  listenForHttp,
  stopHttpServer,
} from "../../apps/server/dist/index.js";

const certificatePath = process.argv[2];
const keyPath = process.argv[3];
if (!certificatePath || !keyPath) {
  throw new Error("Pass certificate and key paths to the secure smoke test");
}

const server = createAppServer({
  tls: {
    cert: readFileSync(certificatePath),
    key: readFileSync(keyPath),
  },
});
const listening = await listenForHttp(server, { host: "127.0.0.1", port: 0 });
const baseUrl = `https://localhost:${listening.port}`;

try {
  const response = await fetch(`${baseUrl}/api/voice/session`, {
    method: "POST",
  });
  if (!response.ok)
    throw new Error(`Session creation returned HTTP ${response.status}`);
  const session = await response.json();

  const webSocket = new WebSocket(
    `${baseUrl.replace(/^https:/, "wss:")}/api/voice/ws`,
    { origin: baseUrl },
  );
  await once(webSocket, "open");
  webSocket.send(
    JSON.stringify({
      type: "session.start",
      protocolVersion: session.protocolVersion,
      sessionId: session.sessionId,
      token: session.token,
    }),
  );
  const [readyData] = await once(webSocket, "message");
  const ready = JSON.parse(readyData.toString());
  if (ready.type !== "session.ready") {
    throw new Error(`Expected session.ready, received ${readyData.toString()}`);
  }

  webSocket.send(JSON.stringify({ type: "ping", timestamp: 123 }));
  const [pongData] = await once(webSocket, "message");
  const pong = JSON.parse(pongData.toString());
  if (pong.type !== "pong" || pong.timestamp !== 123) {
    throw new Error(`Expected pong, received ${pongData.toString()}`);
  }

  webSocket.send(JSON.stringify({ type: "input.start", sampleRate: 16_000 }));
  const [inputReadyData] = await once(webSocket, "message");
  const inputReady = JSON.parse(inputReadyData.toString());
  if (inputReady.type !== "input.ready" || inputReady.sampleRate !== 16_000) {
    throw new Error(
      `Expected input.ready at 16kHz, received ${inputReadyData.toString()}`,
    );
  }

  webSocket.send(
    encodePcm16Frame({
      kind: "input",
      sequence: 0,
      generationId: 0,
      sampleRate: 16_000,
      samples: new Float32Array(320),
    }),
  );
  const [ackData] = await once(webSocket, "message");
  const ack = JSON.parse(ackData.toString());
  if (ack.type !== "input.audio.ack" || ack.sequence !== 0) {
    throw new Error(`Expected input.audio.ack, received ${ackData.toString()}`);
  }

  webSocket.send(JSON.stringify({ type: "input.stop" }));
  const [stoppedData] = await once(webSocket, "message");
  const stopped = JSON.parse(stoppedData.toString());
  if (stopped.type !== "input.stopped" || stopped.totalSamples !== 320) {
    throw new Error(
      `Expected input.stopped after 320 samples, received ${stoppedData.toString()}`,
    );
  }

  webSocket.close(1000);
  await once(webSocket, "close");
  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        protocolVersion: session.protocolVersion,
        sessionId: session.sessionId,
        acknowledgedAudioSamples: ack.totalSamples,
      },
      null,
      2,
    ),
  );
} finally {
  await stopHttpServer(server);
}
