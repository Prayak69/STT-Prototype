import WebSocket from "ws";
import { config } from "./config";
import { logger } from "./logger";

/**
 * Client for the local pyannote sidecar (see `diarizer_server.py` at the repo
 * root). One instance exists per realtime browser session. The proxy forwards
 * the exact same PCM frames it sends to Gnani, and the sidecar answers with a
 * rolling speaker timeline in seconds since the start of the stream.
 *
 * Batch sessions never create one: Gnani Batch already returns `speaker_id`.
 */

export interface SpeakerTurn {
  start: number;
  end: number;
  speaker: number;
}

export interface SpeakerMatch {
  speaker: number;
  /** True when a turn actually covers/overlaps the segment, not just nearby. */
  exact: boolean;
}

export interface DiarizationSession {
  /** Queue a 1,024-byte, 16 kHz mono PCM frame. */
  pushFrame(frame: Buffer): void;
  /**
   * Best speaker match for [start, end] seconds.
   * When `maxDistanceSeconds` is set, a nearby turn is only used if it is
   * within that many seconds of the segment. `exact` is false for gaps.
   */
  matchFor(
    start: number,
    end: number,
    maxDistanceSeconds?: number,
  ): SpeakerMatch | null;
  /**
   * Ask the sidecar to close the speaker timeline before the session ends.
   * Resolves `true` when its `final: true` snapshot arrived, `false` on
   * timeout or when the sidecar is unavailable.
   */
  flush(timeoutMs?: number): Promise<boolean>;
  close(): void;
}

interface TimelineMessage {
  type?: string;
  message?: string;
  turns?: SpeakerTurn[];
  /** Set on the timeline produced by a `flush`. */
  final?: boolean;
}

const RECONNECT_DELAY_MS = 2000;
/** ~32 s of audio; enough to ride out a sidecar restart at session start. */
const MAX_QUEUED_FRAMES = 1000;
/** One 1,024-byte frame is 512 samples at 16 kHz. */
const FRAME_MS = 32;

function isTurn(value: unknown): value is SpeakerTurn {
  if (typeof value !== "object" || value === null) return false;
  const turn = value as Partial<SpeakerTurn>;
  return (
    typeof turn.start === "number" &&
    typeof turn.end === "number" &&
    typeof turn.speaker === "number"
  );
}

function matchSpeaker(
  turns: SpeakerTurn[],
  start: number,
  end: number,
  maxDistanceSeconds: number,
): SpeakerMatch | null {
  if (turns.length === 0) return null;

  const midpoint = (start + end) / 2;
  for (const turn of turns) {
    if (midpoint >= turn.start && midpoint <= turn.end) {
      return { speaker: turn.speaker, exact: true };
    }
  }

  // No turn covers the midpoint: use whichever turn overlaps the interval most.
  let best: SpeakerTurn | null = null;
  let bestOverlap = 0;
  for (const turn of turns) {
    const overlap = Math.min(turn.end, end) - Math.max(turn.start, start);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = turn;
    }
  }
  if (best) return { speaker: best.speaker, exact: true };

  // Diarization can lag behind Gnani and leave small gaps in the timeline.
  // Return the closest known turn so a transcript is never left unlabelled
  // (the UI would otherwise show a bare "Speaker"). Callers keep the segment
  // pending because the label may be corrected by the next window.
  let nearest: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const turn of turns) {
    const distance =
      midpoint < turn.start
        ? turn.start - midpoint
        : midpoint > turn.end
          ? midpoint - turn.end
          : 0;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = turn.speaker;
    }
  }
  if (nearest !== null && nearestDistance <= maxDistanceSeconds) {
    return { speaker: nearest, exact: false };
  }
  return null;
}

export function createDiarizationSession(options: {
  sessionId: string;
  /** Called whenever a new timeline snapshot arrives. */
  onTimeline: () => void;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}): DiarizationSession {
  const log =
    options.log ??
    ((message: string, meta?: Record<string, unknown>) =>
      logger.info(`[${options.sessionId}] diarizer: ${message}`, meta));

  let socket: WebSocket | null = null;
  let turns: SpeakerTurn[] = [];
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let dropped = 0;
  let pushedFrames = 0;
  let failures = 0;

  /** Pending `flush()` call, settled by the `final: true` timeline. */
  let flushResolve: ((ok: boolean) => void) | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const settleFlush = (ok: boolean) => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const resolve = flushResolve;
    flushResolve = null;
    resolve?.(ok);
  };

  const queue: Array<{ frame: Buffer; clockMs: number }> = [];

  const target = new URL(config.diarization.url);
  target.searchParams.set("session_id", options.sessionId);
  target.searchParams.set("num_speakers", String(config.diarization.numSpeakers));

  const scheduleReconnect = () => {
    if (closed || retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  const connect = () => {
    if (closed) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(target.toString(), {
        perMessageDeflate: false,
        handshakeTimeout: 5000,
      });
    } catch (error) {
      log("could not create socket", { message: (error as Error).message });
      scheduleReconnect();
      return;
    }

    socket = ws;

    ws.on("open", () => {
      // Tell the sidecar which absolute stream time the audio we are about to
      // send starts at. It stays 0 on a normal first connection, and lets a
      // restarted sidecar rejoin an in-progress session without shifting the
      // whole timeline.
      const startMs =
        queue.length > 0 ? queue[0].clockMs : pushedFrames * FRAME_MS;
      ws.send(JSON.stringify({ type: "sync", audio_ms: startMs }));

      log("connected", { queued: queue.length, startMs });
      failures = 0;
      while (queue.length > 0) {
        const item = queue.shift();
        if (item && ws.readyState === WebSocket.OPEN) ws.send(item.frame);
      }
    });

    ws.on("message", (data) => {
      let message: TimelineMessage;
      try {
        message = JSON.parse(data.toString()) as TimelineMessage;
      } catch {
        return;
      }

      if (message.type === "timeline" && Array.isArray(message.turns)) {
        turns = message.turns.filter(isTurn);
        options.onTimeline();
        if (message.final) settleFlush(true);
      } else if (message.type === "error") {
        log("sidecar error", { message: message.message ?? "unknown" });
      }
    });

    ws.on("error", (error) => {
      failures += 1;
      // A missing sidecar retries every 2 s; log only occasionally.
      if (failures === 1 || failures % 30 === 0) {
        log("socket error", { message: error.message, failures });
      }
    });

    ws.on("close", () => {
      socket = null;
      settleFlush(false);
      if (!closed) scheduleReconnect();
    });
  };

  connect();

  return {
    pushFrame(frame: Buffer) {
      if (closed) return;

      const clockMs = pushedFrames * FRAME_MS;
      pushedFrames += 1;

      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(frame);
          return;
        } catch {
          // Fall through to the queue; the close handler will reconnect.
        }
      }

      if (queue.length >= MAX_QUEUED_FRAMES) {
        queue.shift();
        dropped += 1;
        if (dropped === 1) {
          log("sidecar is not accepting audio; dropping oldest frames");
        }
      }
      queue.push({ frame: Buffer.from(frame), clockMs });
    },

    matchFor(start: number, end: number, maxDistanceSeconds = Number.POSITIVE_INFINITY) {
      return matchSpeaker(turns, start, end, maxDistanceSeconds);
    },

    flush(timeoutMs = 6000) {
      if (closed || flushResolve !== null) return Promise.resolve(false);

      const current = socket;
      if (!current || current.readyState !== WebSocket.OPEN) {
        return Promise.resolve(false);
      }

      return new Promise<boolean>((resolve) => {
        flushResolve = resolve;
        flushTimer = setTimeout(() => settleFlush(false), timeoutMs);
        try {
          current.send(JSON.stringify({ type: "flush" }));
          log("flush requested for final speaker confirmation");
        } catch (error) {
          log("could not request final pass", { message: (error as Error).message });
          settleFlush(false);
        }
      });
    },

    close() {
      closed = true;
      settleFlush(false);
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      queue.length = 0;

      if (socket) {
        const current = socket;
        socket = null;
        current.removeAllListeners();
        current.on("error", () => {});
        try {
          current.terminate();
        } catch {
          // Already closed.
        }
      }
    },
  };
}
