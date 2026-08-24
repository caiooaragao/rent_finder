import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";

const MAX_LOG_LINES = 10_000;

export type ScrapeStreamEvent =
  | { type: "start"; message: string; pid?: number }
  | { type: "log"; stream: "stdout" | "stderr"; line: string }
  | { type: "done"; code: number | null; signal: string | null }
  | { type: "error"; message: string };

type ScrapeState = {
  running: boolean;
  logs: string[];
  exitCode: number | null;
  child: ChildProcess | null;
};

const state: ScrapeState = {
  running: false,
  logs: [],
  exitCode: null,
  child: null,
};

function pushLog(line: string) {
  state.logs.push(line);
  if (state.logs.length > MAX_LOG_LINES) {
    state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
  }
}

function formatLogLine(stream: "stdout" | "stderr", line: string) {
  const prefix = stream === "stderr" ? "[stderr] " : "";
  return `${prefix}${line}`;
}

function appendChunk(
  stream: "stdout" | "stderr",
  chunk: string,
  pending: { stdout: string; stderr: string },
  onLine: (line: string, stream: "stdout" | "stderr") => void,
) {
  pending[stream] += chunk;
  const parts = pending[stream].split(/\r?\n/);
  pending[stream] = parts.pop() ?? "";
  for (const part of parts) {
    onLine(part, stream);
  }
}

export function getScrapeState() {
  return {
    running: state.running,
    logs: [...state.logs],
    exitCode: state.exitCode,
  };
}

export function isScrapeRunning(): boolean {
  return state.running;
}

export function startScrapeStream(): ReadableStream<Uint8Array> {
  if (state.running) {
    throw new Error("Já existe um scrape em execução");
  }

  const encoder = new TextEncoder();
  const pending = { stdout: "", stderr: "" };

  const emit = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: ScrapeStreamEvent,
  ) => {
    const payload = `${JSON.stringify(event)}\n`;
    controller.enqueue(encoder.encode(payload));
  };

  const onLogLine = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    line: string,
    stream: "stdout" | "stderr",
  ) => {
    const formatted = formatLogLine(stream, line);
    pushLog(formatted);
    emit(controller, { type: "log", stream, line: formatted });
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      state.running = true;
      state.logs = [];
      state.exitCode = null;

      const repoRoot = path.resolve(process.cwd(), "..");
      const child = spawn("npm", ["run", "scrape"], {
        cwd: repoRoot,
        shell: true,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      state.child = child;

      emit(controller, {
        type: "start",
        message: "Scrape iniciado…",
        pid: child.pid,
      });
      pushLog("Scrape iniciado…");

      child.stdout?.on("data", (data: Buffer | string) => {
        appendChunk("stdout", data.toString(), pending, (line, stream) =>
          onLogLine(controller, line, stream),
        );
      });

      child.stderr?.on("data", (data: Buffer | string) => {
        appendChunk("stderr", data.toString(), pending, (line, stream) =>
          onLogLine(controller, line, stream),
        );
      });

      child.on("error", (error) => {
        const message =
          error instanceof Error ? error.message : "Erro ao iniciar scrape";
        pushLog(`[erro] ${message}`);
        emit(controller, { type: "error", message });
        state.running = false;
        state.child = null;
        controller.close();
      });

      child.on("close", (code, signal) => {
        for (const stream of ["stdout", "stderr"] as const) {
          const remainder = pending[stream].trim();
          if (remainder) onLogLine(controller, remainder, stream);
        }

        state.exitCode = code;
        state.running = false;
        state.child = null;

        const summary =
          code === 0
            ? "Scrape concluído com sucesso."
            : `Scrape finalizado com código ${code ?? "desconhecido"}.`;
        pushLog(summary);
        emit(controller, { type: "done", code, signal });
        controller.close();
      });
    },
    cancel() {
      if (state.child && !state.child.killed) {
        state.child.kill("SIGTERM");
      }
    },
  });
}
