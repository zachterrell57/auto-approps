import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setUserDataPath, settings } from "../electron/services/config";
import {
  readApiKey,
  readOpenAiApiKey,
} from "../electron/services/settings-store";
import {
  createHearingIntelligenceJob,
  exportHearingIntelligence,
  generateHearingIntelligenceOutput,
  getHearingIntelligenceWorkspace,
  resolveHearingIntelligenceStream,
  runHearingWatchlist,
} from "../electron/services/hearing-intelligence";
import { transcribeLiveAudioChunk } from "../electron/services/hearing-live-transcription";
import { appendTranscriptSegments } from "../electron/services/hearing-store";
import { requireMediaTool } from "../electron/services/media-tools";

interface Args {
  url: string;
  seconds: number;
  offset: number;
  useAi: boolean | "auto";
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    url: "",
    seconds: 60,
    offset: 0,
    useAi: "auto",
  };
  for (let idx = 2; idx < argv.length; idx += 1) {
    const value = argv[idx];
    if (value === "--seconds") {
      args.seconds = Number(argv[++idx] ?? args.seconds);
    } else if (value === "--offset") {
      args.offset = Number(argv[++idx] ?? args.offset);
    } else if (value === "--no-ai") {
      args.useAi = false;
    } else if (value === "--ai") {
      args.useAi = true;
    } else if (!args.url) {
      args.url = value;
    }
  }
  if (!args.url) throw new Error("Usage: hearing-url-e2e <url> [--seconds 60] [--offset 0] [--ai|--no-ai]");
  if (!Number.isFinite(args.seconds) || args.seconds <= 0) {
    throw new Error("--seconds must be a positive number.");
  }
  if (!Number.isFinite(args.offset) || args.offset < 0) {
    throw new Error("--offset must be zero or a positive number.");
  }
  return args;
}

async function copySettingsIntoTempUserData(userDataDir: string): Promise<void> {
  const candidates = [
    process.env.AUTOAPPROPS_SETTINGS_PATH,
    path.join(os.homedir(), "Library", "Application Support", "autoapprops", "settings.json"),
    path.join(os.homedir(), "Library", "Application Support", "AutoApprops", "settings.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await fs.copyFile(candidate, path.join(userDataDir, "settings.json"));
      return;
    } catch {
      // Try the next likely local settings path.
    }
  }
}

function runProcess(args: {
  command: string;
  commandArgs: string[];
  input?: NodeJS.ReadableStream;
  ignoreExitAfterSuccess?: boolean;
}): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const child = spawn(args.command, args.commandArgs, {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf-8")}`.slice(-4000);
    });
    child.on("error", fail);
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE") return;
      fail(err);
    });
    child.on("exit", (code) => {
      if (code === 0 || args.ignoreExitAfterSuccess) {
        settled = true;
        resolve({ stderr });
        return;
      }
      fail(new Error(`${path.basename(args.command)} exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
    });
    if (args.input) {
      args.input.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE") fail(err);
      });
      args.input.pipe(child.stdin);
    } else {
      child.stdin.end();
    }
  });
}

async function extractAudioSample(args: {
  sourceUrl: string;
  outputPath: string;
  seconds: number;
  offset: number;
}): Promise<void> {
  const ytDlpPath = await requireMediaTool("yt-dlp");
  const ffmpegPath = await requireMediaTool("ffmpeg");
  const ytdlp = spawn(
    ytDlpPath,
    ["-f", "ba/bestaudio/best", "--no-playlist", "-o", "-", args.sourceUrl],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let ytdlpStderr = "";
  let ytdlpStreamError: Error | null = null;
  ytdlp.stderr.on("data", (chunk: Buffer) => {
    ytdlpStderr = `${ytdlpStderr}${chunk.toString("utf-8")}`.slice(-4000);
  });
  ytdlp.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "EPIPE") ytdlpStreamError = err;
  });

  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-y",
    "-i",
    "pipe:0",
  ];
  if (args.offset > 0) ffmpegArgs.push("-ss", String(args.offset));
  ffmpegArgs.push(
    "-t",
    String(args.seconds),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    args.outputPath,
  );

  try {
    await runProcess({
      command: ffmpegPath,
      commandArgs: ffmpegArgs,
      input: ytdlp.stdout,
    });
  } finally {
    if (!ytdlp.killed) ytdlp.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2500);
      ytdlp.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  if (ytdlpStreamError) throw ytdlpStreamError;
  const stat = await fs.stat(args.outputPath).catch(() => null);
  if (!stat || stat.size < 1024) {
    throw new Error(`Audio sample was not created.${ytdlpStderr ? ` yt-dlp: ${ytdlpStderr}` : ""}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  process.env.HEARING_ALLOW_UNREVIEWED_EXPORTS = "true";

  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoapprops-hearing-e2e-"));
  await copySettingsIntoTempUserData(userDataDir);
  setUserDataPath(userDataDir);
  settings.anthropic_api_key = readApiKey();
  settings.openai_api_key = readOpenAiApiKey();
  if (!settings.openai_api_key && !process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key is required for the audio transcription portion of this e2e test.");
  }

  const job = await createHearingIntelligenceJob({
    source_url: args.url,
    mode: "full_memo",
    client_context: {
      care_about: "Energy and water appropriations issues mentioned in the hearing.",
      preferred_output_style: "formal_memo",
    },
    watch_items: [
      {
        type: "topic",
        label: "Energy and Water Development",
        aliases: ["energy and water", "water development"],
        match_mode: "hybrid",
        importance: "high",
        negative_filters: [],
      },
      {
        type: "topic",
        label: "appropriations",
        aliases: ["funding", "fiscal year 2027"],
        match_mode: "hybrid",
        importance: "high",
        negative_filters: [],
      },
    ],
  });

  const resolved = await resolveHearingIntelligenceStream(job.id);
  const streamUrl = resolved.stream_url;
  if (!streamUrl) throw new Error("Resolver did not return a YouTube URL.");

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoapprops-hearing-audio-"));
  const audioPath = path.join(workDir, "sample.wav");
  await extractAudioSample({
    sourceUrl: streamUrl,
    outputPath: audioPath,
    seconds: args.seconds,
    offset: args.offset,
  });

  const segments = await transcribeLiveAudioChunk({
    hearingJobId: job.id,
    audioPath,
    offsetMs: Math.round(args.offset * 1000),
  });
  await fs.rm(workDir, { recursive: true, force: true });
  if (segments.length === 0) {
    throw new Error("OpenAI transcription returned no transcript segments for the audio sample.");
  }
  appendTranscriptSegments(job.id, segments);
  runHearingWatchlist(job.id);

  const shouldUseAi =
    args.useAi === "auto" ? Boolean(settings.anthropic_api_key) : args.useAi;
  const output = await generateHearingIntelligenceOutput({
    hearingJobId: job.id,
    outputType: "full_memo",
    useAi: shouldUseAi,
    reviewerInstructions:
      "This is an automated e2e test using a short audio sample from the hearing URL. Clearly flag coverage limits.",
  });

  const exported = await exportHearingIntelligence({
    hearingJobId: job.id,
    format: "markdown",
    outputId: output.id,
  });

  const outDir = path.join(
    process.cwd(),
    "out",
    "hearing-e2e",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await fs.mkdir(outDir, { recursive: true });
  const exportPath = path.join(outDir, exported.filename);
  await fs.writeFile(exportPath, Buffer.from(exported.buffer));

  const workspace = getHearingIntelligenceWorkspace(job.id);
  const summary = {
    ok: true,
    user_data_dir: userDataDir,
    job_id: job.id,
    hearing_title: workspace.job.hearing_title,
    stream_url: workspace.job.stream_url,
    youtube_source: workspace.job.metadata.youtube_source ?? null,
    transcript_segments: workspace.transcript_segments.length,
    watch_hits: workspace.watch_hits.length,
    output_id: output.id,
    output_type: output.type,
    generated_with_ai: Boolean(output.model_metadata.generated_with_ai),
    output_markdown_chars: output.content_markdown.length,
    export_path: exportPath,
  };
  await fs.writeFile(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
