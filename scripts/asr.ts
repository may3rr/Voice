// asr.ts
// Bun + TypeScript: WebSocket streaming ASR client for Doubao/Volc "bigmodel" protocol
// Usage:
//   bun run asr.ts "/path/to/audio.wav" --mode=async
//
// Notes:
// - This script expects WAV PCM_s16le, 16kHz, mono. It will extract the "data" chunk and stream raw PCM.
// - Packetization: 200ms per chunk (recommended for bidirectional streaming).
// - Payload compression: Gzip (matches the doc examples). You can switch to no compression if needed.
import { readFileSync } from "node:fs";

import WebSocket from "ws";
import { gzipSync, gunzipSync } from "node:zlib";

type Mode = "basic" | "async" | "nostream";

const ENDPOINTS: Record<Mode, string> = {
  basic: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel",
  async: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
  nostream: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream",
};

// ====== Fill these 3 ======
const X_API_APP_KEY = "2638861024"; // X-Api-App-Key
const X_API_ACCESS_KEY = "B3JkM_dqpXJbDwhd1TE5ikMM81YnXCtO"; // X-Api-Access-Key
const X_API_RESOURCE_ID = "volc.seedasr.sauc.duration"; // X-Api-Resource-Id (pick the correct one)
// ==========================

// Optional: if you want to manually set connect id; otherwise script will generate one.
const X_API_CONNECT_ID = ""; // e.g. "67ee89ba-7050-4c04-a3d7-ac61a63499b3"

// Protocol constants (per doc)
const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE_UNITS = 0b0001; // 1 * 4 bytes = 4 bytes header

enum MsgType {
  FULL_CLIENT_REQUEST = 0b0001,
  AUDIO_ONLY_REQUEST = 0b0010,
  FULL_SERVER_RESPONSE = 0b1001,
  ERROR_RESPONSE = 0b1111,
}

enum Serialization {
  NONE = 0b0000,
  JSON = 0b0001,
}

enum Compression {
  NONE = 0b0000,
  GZIP = 0b0001,
}

// In doc: flags nibble meaning
// 0b0000: no sequence after header
// 0b0001: sequence after header (positive)
// 0b0010: last packet, no sequence
// 0b0011: last packet, with sequence (negative required)
enum Flags {
  NONE = 0b0000,
  LAST_NO_SEQ = 0b0010,
}

const USE_GZIP = true; // matches doc examples

function buildHeader(params: {
  msgType: MsgType;
  flags: number;
  serialization: Serialization;
  compression: Compression;
}): Buffer {
  const b0 = ((PROTOCOL_VERSION & 0x0f) << 4) | (HEADER_SIZE_UNITS & 0x0f);
  const b1 = ((params.msgType & 0x0f) << 4) | (params.flags & 0x0f);
  const b2 = ((params.serialization & 0x0f) << 4) | (params.compression & 0x0f);
  const b3 = 0x00;
  return Buffer.from([b0, b1, b2, b3]);
}

function packClientMessage(params: {
  header: Buffer;
  payload: Buffer; // already compressed or raw, consistent with header.compression
}): Buffer {
  const payloadSize = params.payload.length;
  const out = Buffer.alloc(4 + 4 + payloadSize);
  params.header.copy(out, 0);
  out.writeUInt32BE(payloadSize >>> 0, 4);
  params.payload.copy(out, 8);
  return out;
}

function parseServerMessage(data: Buffer): {
  msgType: number;
  flags: number;
  serialization: number;
  compression: number;
  sequence?: number;
  payload?: Buffer;
  errorCode?: number;
  errorMessage?: string;
  json?: any;
} {
  if (data.length < 4) {
    return { msgType: -1, flags: 0, serialization: 0, compression: 0 };
  }
  const b1 = data[1];
  const b2 = data[2];
  const msgType = (b1 >> 4) & 0x0f;
  const flags = b1 & 0x0f;
  const serialization = (b2 >> 4) & 0x0f;
  const compression = b2 & 0x0f;

  if (msgType === MsgType.FULL_SERVER_RESPONSE) {
    // header(4) + sequence(4) + payloadSize(4) + payload
    if (data.length < 12) return { msgType, flags, serialization, compression };
    const sequence = data.readInt32BE(4);
    const payloadSize = data.readUInt32BE(8);
    const start = 12;
    const end = start + payloadSize;
    const payloadRaw = data.slice(start, Math.min(end, data.length));

    let payload = payloadRaw;
    if (compression === Compression.GZIP) {
      try {
        payload = gunzipSync(payloadRaw);
      } catch {
        // keep raw if decompression fails
      }
    }

    let json: any = undefined;
    if (serialization === Serialization.JSON) {
      try {
        json = JSON.parse(payload.toString("utf8"));
      } catch {
        // ignore
      }
    }

    return { msgType, flags, serialization, compression, sequence, payload, json };
  }

  if (msgType === MsgType.ERROR_RESPONSE) {
    // header(4) + errorCode(4) + errorMsgSize(4) + errorMsg(UTF8 string)
    if (data.length < 12) return { msgType, flags, serialization, compression };
    const errorCode = data.readUInt32BE(4);
    const size = data.readUInt32BE(8);
    const start = 12;
    const end = start + size;
    let msgBuf = data.slice(start, Math.min(end, data.length));

    if (compression === Compression.GZIP) {
      try {
        msgBuf = gunzipSync(msgBuf);
      } catch {
        // keep raw
      }
    }

    const errorMessage = msgBuf.toString("utf8");
    let json: any = undefined;
    if (serialization === Serialization.JSON) {
      try {
        json = JSON.parse(errorMessage);
      } catch {
        // ignore
      }
    }
    return { msgType, flags, serialization, compression, errorCode, errorMessage, json };
  }

  return { msgType, flags, serialization, compression };
}

function parseArgs(argv: string[]) {
  const args = { file: "", mode: "async" as Mode };
  for (const a of argv) {
    if (!a) continue;
    if (a.startsWith("--mode=")) args.mode = a.slice("--mode=".length) as Mode;
    else if (!a.startsWith("--") && !args.file) args.file = a;
  }
  return args;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// Minimal WAV (RIFF) parser to extract PCM data chunk and format info.
function readWavPcm(path: string): {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
} {
  const fileBuf = readFileSync(path);


  const riff = fileBuf.toString("ascii", 0, 4);
  const wave = fileBuf.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Not a valid WAV file (RIFF/WAVE header missing).");
  }

  let offset = 12;
  let fmtFound = false;
  let dataFound = false;

  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;

  let pcmData: Buffer | null = null;

  while (offset + 8 <= fileBuf.length) {
    const chunkId = fileBuf.toString("ascii", offset, offset + 4);
    const chunkSize = fileBuf.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkSize;

    if (chunkDataEnd > fileBuf.length) break;

    if (chunkId === "fmt ") {
      fmtFound = true;
      audioFormat = fileBuf.readUInt16LE(chunkDataStart + 0);
      channels = fileBuf.readUInt16LE(chunkDataStart + 2);
      sampleRate = fileBuf.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = fileBuf.readUInt16LE(chunkDataStart + 14);
    } else if (chunkId === "data") {
      dataFound = true;
      pcmData = fileBuf.slice(chunkDataStart, chunkDataEnd);
    }

    // Chunks are word-aligned
    offset = chunkDataEnd + (chunkSize % 2);
  }

  if (!fmtFound || !dataFound || !pcmData) {
    throw new Error('WAV parse failed (missing "fmt " or "data" chunk).');
  }
  if (audioFormat !== 1) {
    throw new Error(`Unsupported WAV format: audioFormat=${audioFormat} (only PCM=1 supported).`);
  }

  return { pcm: pcmData, sampleRate, channels, bitsPerSample };
}

async function main() {
  const { file, mode } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error('Usage: bun run asr.ts "/path/to/audio.wav" --mode=async');
    process.exit(1);
  }
  if (!ENDPOINTS[mode]) {
    console.error(`Invalid --mode. Use one of: basic | async | nostream`);
    process.exit(1);
  }

  if (!X_API_APP_KEY || !X_API_ACCESS_KEY || !X_API_RESOURCE_ID) {
    console.error("Please fill X_API_APP_KEY / X_API_ACCESS_KEY / X_API_RESOURCE_ID in the script.");
    process.exit(1);
  }

  const { pcm, sampleRate, channels, bitsPerSample } = readWavPcm(file);

  // Doc constraints: 16kHz, 16-bit, mono recommended/expected
  if (sampleRate !== 16000 || bitsPerSample !== 16 || channels !== 1) {
    console.error(
      `WAV must be 16kHz/16bit/mono. Got sampleRate=${sampleRate}, bits=${bitsPerSample}, channels=${channels}\n` +
        `Convert with:\n` +
        `  ffmpeg -i "${file}" -ac 1 -ar 16000 -sample_fmt s16 output_16k_mono.wav`
    );
    process.exit(1);
  }

  const connectId = X_API_CONNECT_ID?.trim() ? X_API_CONNECT_ID.trim() : crypto.randomUUID();

  const ws = new WebSocket(ENDPOINTS[mode], {
    headers: {
      "X-Api-App-Key": X_API_APP_KEY,
      "X-Api-Access-Key": X_API_ACCESS_KEY,
      "X-Api-Resource-Id": X_API_RESOURCE_ID,
      "X-Api-Connect-Id": connectId,
    },
  });

  // Capture handshake response headers if available (ws supports it via 'upgrade')
  ws.on("upgrade", (res) => {
    const logid = (res.headers["x-tt-logid"] as string) || "";
    if (logid) console.log(`[handshake] X-Tt-Logid: ${logid}`);
  });

  ws.on("error", (e) => {
    console.error("[ws error]", e);
  });

  const done = new Promise<void>((resolve, reject) => {
    ws.on("close", () => resolve());
    ws.on("unexpected-response", (_req, res) => {
      reject(new Error(`Unexpected response: ${res.statusCode}`));
    });

    let lastPrinted = "";
    ws.on("message", (raw) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as any);
      const parsed = parseServerMessage(buf);

      if (parsed.msgType === MsgType.ERROR_RESPONSE) {
        console.error(`[server error] code=${parsed.errorCode}`);
        if (parsed.json) console.error(parsed.json);
        else console.error(parsed.errorMessage);
        return;
      }

      if (parsed.msgType === MsgType.FULL_SERVER_RESPONSE) {
        // Common payload: { result: { text, utterances... }, audio_info: {...} }
        const j = parsed.json;
        const text: string | undefined = j?.result?.text;
        if (text && text !== lastPrinted) {
          // Print only the delta to reduce spam
          if (text.startsWith(lastPrinted)) console.log(text.slice(lastPrinted.length));
          else console.log(text);
          lastPrinted = text;
        }

        // If server marks last response (flags=0b0011), we can close.
        if ((parsed.flags & 0x0f) === 0b0011) {
          try {
            ws.close();
          } catch {}
        }
      }
    });
  });

  ws.on("open", async () => {
    console.log(`[open] mode=${mode}, connectId=${connectId}`);

    // 1) Send full client request (JSON)
    const requestPayload = {
      user: { uid: "local_test" },
      audio: {
        format: "pcm", // we stream raw PCM extracted from WAV
        rate: 16000,
        bits: 16,
        channel: 1,
        // language: "zh-CN", // only for nostream per doc; enable if you use mode=nostream
      },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
        enable_ddc: false,
        show_utterances: true,
        result_type: "full",
        // For async mode, you can also experiment with:
        // enable_nonstream: true, // only supported on async mode per doc (2-pass)
        // end_window_size: 800,
      },
    };

    const jsonBuf = Buffer.from(JSON.stringify(requestPayload), "utf8");
    const jsonCompressed = USE_GZIP ? gzipSync(jsonBuf) : jsonBuf;

    const header1 = buildHeader({
      msgType: MsgType.FULL_CLIENT_REQUEST,
      flags: Flags.NONE,
      serialization: Serialization.JSON,
      compression: USE_GZIP ? Compression.GZIP : Compression.NONE,
    });

    ws.send(
      packClientMessage({
        header: header1,
        payload: jsonCompressed,
      })
    );

    // 2) Stream audio in 200ms chunks
    const bytesPerSample = 2; // 16-bit
    const chunkMs = 200;
    const samplesPerChunk = Math.floor((sampleRate * chunkMs) / 1000);
    const bytesPerChunk = samplesPerChunk * bytesPerSample * channels;

    console.log(
      `[stream] pcmBytes=${pcm.length}, chunk=${chunkMs}ms, bytesPerChunk=${bytesPerChunk}, totalChunks=${Math.ceil(
        pcm.length / bytesPerChunk
      )}`
    );

    for (let off = 0; off < pcm.length; off += bytesPerChunk) {
      const isLast = off + bytesPerChunk >= pcm.length;

      const chunk = pcm.slice(off, Math.min(off + bytesPerChunk, pcm.length));
      const chunkCompressed = USE_GZIP ? gzipSync(chunk) : chunk;

      const header2 = buildHeader({
        msgType: MsgType.AUDIO_ONLY_REQUEST,
        flags: isLast ? Flags.LAST_NO_SEQ : Flags.NONE,
        serialization: Serialization.NONE,
        compression: USE_GZIP ? Compression.GZIP : Compression.NONE,
      });

      ws.send(
        packClientMessage({
          header: header2,
          payload: chunkCompressed,
        })
      );

      // 最后一包发完就不用再 sleep 了
      if (!isLast) await sleep(chunkMs);
    }

    console.log("[stream] sent last audio packet (flagged as last)");

  });

  await done;
  console.log("[done]");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
