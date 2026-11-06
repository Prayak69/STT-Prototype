import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { config } from "./config";
import { createDiarizationSession, type DiarizationSession } from "./diarization";
import { logger } from "./logger";

const REALTIME_PATH = "/ws/stt/realtime";
const BATCH_PATH = "/ws/stt/batch";
/** Legacy realtime path kept for older clients. */
const LEGACY_PATH = "/ws/stt";
const PCM_FRAME_BYTES = 1024;
/** One 1,024-byte frame is 512 samples at 16 kHz. */
const PCM_FRAME_MS = 32;
/**
 * How far a transcript may sit from the nearest diarization turn before we
 * stop using a nearby guess. Segments matched through a gap keep waiting for
 * a later timeline so the provisional label can be corrected.
 */
const SPEAKER_MATCH_WINDOW_SECONDS = 8;

interface PendingTranscript {
  segment_id?: string | number;
  segment_index?: number;
  start: number;
  end: number;
  /** Last provisional label sent to the browser, to avoid duplicate updates. */
  lastSpeaker?: number;
}

/**
 * Batch uploads are sent faster than real time, so the browser uses a
 * per-connection window and waits for acknowledgements. The server forwards
 * queued frames only while the upstream socket has room, which prevents the
 * proxy from ever dropping audio from an uploaded file.
 */
const BATCH_ACK_EVERY = 8;
const BATCH_HIGH_WATER_BYTES = 128 * 1024;
const BATCH_MAX_QUEUE_FRAMES = 1024;
const BATCH_PUMP_INTERVAL_MS = 20;

interface ProxyErrorFrame {
  type: "proxy_error";
  code:
    | "AUTH_FAILED"
    | "RATE_LIMITED"
    | "UPSTREAM_REJECTED"
    | "UPSTREAM_ERROR"
    | "CONFIG"
    | "SESSION_LIMIT"
    | "BAD_FRAME";
  message: string;
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch (error) {
    logger.warn("Failed to send proxy frame", { error: (error as Error).message });
  }
}

function sendProxyError(socket: WebSocket, code: ProxyErrorFrame["code"], message: string): void {
  sendJson(socket, { type: "proxy_error", code, message } satisfies ProxyErrorFrame);
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Headers are attached server-side only. The browser never sees the API key. */
function upstreamHeaders(requestId: string): Record<string, string> {
  return {
    "x-api-key-id": config.stt.apiKey,
    model: config.stt.model,
    language_code: config.stt.languageCode,
    "x-sample-rate": String(config.stt.sampleRate),
    format: config.stt.format,
    "x-min-silence-ms": String(config.stt.minSilenceMs),
    "x-vad-threshold": String(config.stt.vadThreshold),
    "x-idle-timeout-sec": String(config.stt.idleTimeoutSec),
    "x-max-speech-s": String(config.stt.maxSpeechSec),
    "x-api-request-id": requestId,
  };
}

/**
 * Attaches the WebSocket proxies:
 * - /ws/stt/realtime — microphone sessions
 * - /ws/stt/batch    — uploaded file sessions with flow control
 *
 * Both attach the Gnani credentials server-side; the browser never sees them.
 */
export function attachSttProxy(server: HttpServer): { close: () => void } {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 64 * 1024,
  });

  const sessionsByIp = new Map<string, number>();

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }

    let mode: "realtime" | "batch";
    if (url.pathname === BATCH_PATH) {
      mode = "batch";
    } else if (url.pathname === REALTIME_PATH || url.pathname === LEGACY_PATH) {
      mode = "realtime";
    } else {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req, mode === "batch");
    });
  });

  wss.on("connection", (client: WebSocket, req: IncomingMessage, isBatch = false) => {
    const sessionId = randomUUID().slice(0, 8);
    const requestId = randomUUID();
    const ip = clientIp(req);
    const log = (message: string, meta?: Record<string, unknown>) =>
      logger.info(`[${sessionId}] ${message}`, meta);

    const active = sessionsByIp.get(ip) ?? 0;
    if (active >= config.limits.sessionsPerIp) {
      logger.warn(`[${sessionId}] rejected: session limit for ip`, { ip, active });
      sendProxyError(client, "SESSION_LIMIT", "Too many active recording sessions. Stop one and try again.");
      client.close(1013, "Session limit reached");
      return;
    }
    sessionsByIp.set(ip, active + 1);

    let released = false;
    const releaseSlot = () => {
      if (released) return;
      released = true;
      const remaining = (sessionsByIp.get(ip) ?? 1) - 1;
      if (remaining <= 0) sessionsByIp.delete(ip);
      else sessionsByIp.set(ip, remaining);
    };
    client.on("close", releaseSlot);

    if (!config.stt.apiKey) {
      sendProxyError(client, "CONFIG", "Speech service is not configured on the server.");
      client.close(1011, "Missing server configuration");
      return;
    }

    log("browser connected; opening upstream", { ip, requestId });

    let upstream: WebSocket;
    try {
      upstream = new WebSocket(config.stt.url, {
        headers: upstreamHeaders(requestId),
        handshakeTimeout: 15_000,
        perMessageDeflate: false,
      });
    } catch (error) {
      logger.error(`[${sessionId}] could not create upstream socket`, {
        message: (error as Error).message,
      });
      sendProxyError(client, "CONFIG", "The speech service is not configured correctly on the server.");
      client.close(1011, "Upstream unavailable");
      return;
    }

    let clientClosed = false;
    let handshakeRejected = false;
    let framesSent = 0;
    let framesDropped = 0;
    let invalidFrames = 0;
    let transcripts = 0;

    const startedAt = Date.now();

    /**
     * Realtime-only speaker labeling. `audioClockMs` is the stream time of the
     * audio actually forwarded to Gnani, so it lines up with the sidecar's
     * timeline (both start at 0 and advance one 32 ms frame at a time).
     */
    let audioClockMs = 0;
    /** Stream time of the last Gnani `processing` event (end of speech). */
    let lastSpeechEndMs: number | null = null;
    /** Stable ids for transcripts that arrive without a Gnani `segment_id`. */
    let syntheticSegmentId = 0;
    const pendingTranscripts = new Map<string, PendingTranscript>();
    let diarization: DiarizationSession | null = null;

    /**
     * Stable sidecar ids can skip numbers (1, 2, 4) when a cluster is dropped.
     * Renumber them by first appearance so the UI is always Speaker 1, 2, 3...
     */
    const displaySpeakers = new Map<number, number>();
    const displaySpeakerId = (stableId: number): number => {
      const existing = displaySpeakers.get(stableId);
      if (existing !== undefined) return existing;
      const next = displaySpeakers.size;
      displaySpeakers.set(stableId, next);
      return next;
    };

    const emitSpeakerUpdates = () => {
      if (!diarization || pendingTranscripts.size === 0) return;

      const updates: Array<Record<string, unknown>> = [];
      const staleBefore = audioClockMs / 1000 - 600;
      for (const [key, item] of pendingTranscripts) {
        if (item.end < staleBefore) {
          pendingTranscripts.delete(key);
          continue;
        }
        const match = diarization.matchFor(
          item.start,
          item.end,
          SPEAKER_MATCH_WINDOW_SECONDS,
        );
        if (match === null) continue;
        const speakerId = displaySpeakerId(match.speaker);
        if (match.exact) {
          // A real turn now covers the segment: this is the final label.
          pendingTranscripts.delete(key);
        } else if (item.lastSpeaker === speakerId) {
          // No better data yet; keep waiting without spamming the browser.
          continue;
        } else {
          item.lastSpeaker = speakerId;
        }
        updates.push({
          segment_id: item.segment_id,
          segment_index: item.segment_index,
          // The UI expects Gnani-style 0-based ids (`speaker_id + 1` is shown).
          speaker_id: speakerId,
        });
      }

      if (updates.length === 0 || client.readyState !== WebSocket.OPEN) return;

      sendJson(client, { type: "speaker_update", updates });
      log("speaker labels updated", { count: updates.length });
    };

    if (!isBatch && config.diarization.enabled) {
      diarization = createDiarizationSession({
        sessionId,
        onTimeline: emitSpeakerUpdates,
        log,
      });
    }

    /**
     * Attach `speaker_id` to a Gnani transcript frame when the sidecar already
     * knows the region. Otherwise remember the interval and send a
     * `speaker_update` once the next window covers it.
     */
    const annotateTranscript = (text: string): string => {
      if (!diarization) return text;

      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return text;
      }

      // Gnani signals end-of-speech just before transcription starts. Anchoring
      // to this event is far more accurate than using the transcript arrival
      // time, which includes Gnani's processing latency.
      if (frame.type === "processing") {
        // VAD reports end-of-speech after the configured silence window, so
        // back off that silence to land on the real speech boundary.
        lastSpeechEndMs = Math.max(
          0,
          audioClockMs - config.stt.minSilenceMs,
        );
        return text;
      }
      if (frame.type !== "transcript") return text;

      // Guarantee a stable id so late `speaker_update` frames can always be
      // matched in the browser, even if Gnani omits `segment_id`.
      if (frame.segment_id === undefined || frame.segment_id === null) {
        syntheticSegmentId += 1;
        frame.segment_id = `rt-${syntheticSegmentId}`;
      }

      const latencyMs = Number(frame.latency);
      const endMs =
        lastSpeechEndMs ??
        Math.max(
          0,
          audioClockMs -
            config.stt.minSilenceMs -
            (Number.isFinite(latencyMs) ? latencyMs : 0),
        );
      lastSpeechEndMs = null;

      if (typeof frame.speaker_id === "number") return JSON.stringify(frame);

      const durationMs = Number(frame.audio_duration_ms);
      const end = endMs / 1000;
      const speech =
        Number.isFinite(durationMs) && durationMs > 0
          ? Math.min(durationMs / 1000, 30)
          : 1.5;
      const start = Math.max(0, end - speech);

      const segmentId = frame.segment_id as string | number | undefined;
      const segmentIndex =
        typeof frame.segment_index === "number" ? frame.segment_index : undefined;

      const key = `id:${segmentId}`;
      const match = diarization.matchFor(
        start,
        end,
        SPEAKER_MATCH_WINDOW_SECONDS,
      );

      const displayId = match ? displaySpeakerId(match.speaker) : null;
      if (displayId !== null) {
        // The UI (like Gnani Batch) expects 0-based ids (`speaker_id + 1`).
        frame.speaker_id = displayId;
      }

      // Keep the segment pending unless a real turn covers it, so a later
      // window can correct a provisional label (or fill in a missing one).
      if ((match === null || !match.exact) && pendingTranscripts.size < 1000) {
        pendingTranscripts.set(key, {
          segment_id: segmentId,
          segment_index: segmentIndex,
          start,
          end,
          lastSpeaker: displayId ?? undefined,
        });
      }
      return JSON.stringify(frame);
    };

    // Batch-only flow control. Realtime sockets keep their original behaviour.
    const batchQueue: Buffer[] = [];
    let batchForwarded = 0;
    let batchAcked = 0;
    let batchPendingCommit = false;
    let batchPumpTimer: ReturnType<typeof setInterval> | null = null;

    const sendBatchAck = (force = false) => {
      if (batchForwarded === batchAcked) return;
      if (!force && batchForwarded - batchAcked < BATCH_ACK_EVERY) return;
      batchAcked = batchForwarded;
      sendJson(client, { type: "batch_ack", frames: batchAcked });
    };

    const pumpBatch = () => {
      if (!isBatch || upstream.readyState !== WebSocket.OPEN) return;

      while (
        batchQueue.length > 0 &&
        upstream.bufferedAmount < BATCH_HIGH_WATER_BYTES
      ) {
        const frame = batchQueue.shift();
        if (!frame) break;
        upstream.send(frame);
        batchForwarded += 1;
      }

      // Acknowledge when a full window has gone through or when the queue has
      // drained, so the final partial group of frames is never left un-acked.
      if (batchQueue.length === 0 || batchForwarded - batchAcked >= BATCH_ACK_EVERY) {
        sendBatchAck();
      }

      if (batchQueue.length === 0 && batchPendingCommit) {
        batchPendingCommit = false;
        sendBatchAck(true);
        upstream.send(JSON.stringify({ type: "commit" }));
        log("batch commit sent", { framesSent, batchForwarded });
      }
    };

    const stopBatchPump = () => {
      if (batchPumpTimer !== null) {
        clearInterval(batchPumpTimer);
        batchPumpTimer = null;
      }
      batchQueue.length = 0;
    };

    const closeUpstream = (code = 1000, reason = "client closed") => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(code, reason);
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        upstream.terminate();
      }
    };

    upstream.on("open", () => {
      log("upstream open", { mode: isBatch ? "batch" : "realtime" });
      if (isBatch && batchPumpTimer === null) {
        batchPumpTimer = setInterval(pumpBatch, BATCH_PUMP_INTERVAL_MS);
      }
    });

    upstream.on("message", (data, isBinary) => {
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

      if (!isBinary) {
        const text = payload.toString("utf8");
        if (text.includes('"transcript"')) transcripts += 1;
        if (client.readyState !== WebSocket.OPEN) return;
        client.send(isBatch ? text : annotateTranscript(text));
        return;
      }

      if (client.readyState === WebSocket.OPEN) {
        client.send(payload, { binary: true });
      }
    });

    upstream.on("unexpected-response", (request, response) => {
      handshakeRejected = true;
      const status = response.statusCode ?? 0;
      logger.error(`[${sessionId}] upstream handshake rejected`, { status, requestId });

      let code: ProxyErrorFrame["code"] = "UPSTREAM_REJECTED";
      let message = "The speech service rejected the connection. Please try again.";
      if (status === 401 || status === 403) {
        code = "AUTH_FAILED";
        message = "The speech service rejected the API credentials. Check GNANI_API_KEY on the server.";
      } else if (status === 429) {
        code = "RATE_LIMITED";
        message = "The speech service is rate limiting requests. Try again in a moment.";
      }

      sendProxyError(client, code, message);
      response.resume();
      request.destroy();
      client.close(1011, "Upstream handshake failed");
    });

    upstream.on("error", (error) => {
      stopBatchPump();
      logger.error(`[${sessionId}] upstream error`, { message: error.message, requestId });
      if (clientClosed || handshakeRejected) return;
      sendProxyError(client, "UPSTREAM_ERROR", "Could not reach the speech service. Check your connection and try again.");
      client.close(1011, "Upstream error");
    });

    upstream.on("close", (code, reason) => {
      stopBatchPump();
      diarization?.close();
      const reasonText = reason.toString().slice(0, 200);
      log("upstream closed", {
        code,
        reason: reasonText,
        framesSent,
        framesDropped,
        transcripts,
        mode: isBatch ? "batch" : "realtime",
      });

      if (clientClosed) return;

      sendJson(client, { type: "proxy_closed", code });
      const mapped = code === 1000 || code === 1001 || code === 1008 || code === 1011 ? code : 1011;
      client.close(mapped, "Upstream closed");
    });

    client.on("message", (data, isBinary) => {
      if (isBinary) {
        const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

        if (frame.byteLength !== PCM_FRAME_BYTES) {
          invalidFrames += 1;
          if (invalidFrames <= 5 || invalidFrames % 100 === 0) {
            logger.warn(`[${sessionId}] dropped non-conforming audio frame`, {
              bytes: frame.byteLength,
              invalidFrames,
            });
          }
          if (invalidFrames > 200) {
            sendProxyError(client, "BAD_FRAME", "Audio streaming failed because of an unsupported audio format.");
            client.close(1003, "Unsupported audio frame");
          }
          return;
        }

        if (upstream.readyState !== WebSocket.OPEN) return;

        if (isBatch) {
          // Never drop uploaded audio. The client keeps a small in-flight
          // window, so this queue stays bounded in normal operation.
          if (batchQueue.length >= BATCH_MAX_QUEUE_FRAMES) {
            logger.error(`[${sessionId}] batch queue overflow; closing session`);
            sendProxyError(
              client,
              "UPSTREAM_ERROR",
              "The upload is moving faster than the transcription service can accept. Please try again.",
            );
            client.close(1011, "Batch queue overflow");
            return;
          }
          batchQueue.push(frame);
          framesSent += 1;
          pumpBatch();
          return;
        }

        if (upstream.bufferedAmount > config.limits.maxUpstreamBufferedBytes) {
          framesDropped += 1;
          if (framesDropped <= 5 || framesDropped % 100 === 0) {
            logger.warn(`[${sessionId}] upstream backpressure; dropping frame`, {
              bufferedAmount: upstream.bufferedAmount,
              framesDropped,
            });
          }
          return;
        }

        upstream.send(frame);
        framesSent += 1;
        audioClockMs += PCM_FRAME_MS;
        diarization?.pushFrame(frame);
        return;
      }

      // Only allow whitelisted control frames through to Gnani.
      const text = data.toString();
      if (text.length > 2048) return;
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof message !== "object" || message === null) return;

      const type = (message as { type?: unknown }).type;
      if (type === "commit") {
        if (upstream.readyState === WebSocket.OPEN) {
          if (isBatch) {
            // Preserve ordering: the commit is sent after every queued frame.
            batchPendingCommit = true;
            pumpBatch();
          } else {
            upstream.send(JSON.stringify({ type: "commit" }));
            log("commit sent", { framesSent });
          }
        }
      }
    });

    client.on("close", (code, reason) => {
      clientClosed = true;
      stopBatchPump();
      diarization?.close();
      const durationMs = Date.now() - startedAt;
      log("browser closed", {
        code,
        reason: reason.toString().slice(0, 120),
        durationMs,
        framesSent,
        framesDropped,
        transcripts,
        mode: isBatch ? "batch" : "realtime",
      });
      closeUpstream();
    });

    client.on("error", (error) => {
      log("browser socket error", { message: error.message });
    });
  });

  return {
    close: () => {
      for (const client of wss.clients) {
        try {
          client.close(1001, "Server shutting down");
        } catch {
          client.terminate();
        }
      }
      wss.close();
    },
  };
}
