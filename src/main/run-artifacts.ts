import { execFile } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import type { StepResult } from "../shared/models";

const executeFile = promisify(execFile);

interface ReplayStep {
  description?: unknown;
  log?: { start?: unknown; duration?: unknown };
}

export interface CollectedRunArtifacts {
  steps: StepResult[];
  videoPath?: string;
}

export async function collectRunArtifacts(
  resultDirectory: string,
  failed = false,
): Promise<CollectedRunArtifacts> {
  const files = await listFiles(resultDirectory);
  const replayLog = await findReplayLog(files);
  const video = files.find((path) => path.endsWith(".webm"));
  if (!replayLog) return { steps: [], videoPath: video };

  const document = parse(await readFile(replayLog, "utf8")) as {
    steps?: ReplayStep[];
    log?: { start?: unknown };
  };
  if (!Array.isArray(document.steps)) return { steps: [], videoPath: video };
  const videoStartedAt = await readVideoStartedAt(resultDirectory, files, document.log?.start);
  const ffmpeg = video ? await resolveFfmpegExecutable() : undefined;
  if (ffmpeg) await mkdir(join(resultDirectory, "screenshots"), { recursive: true });

  const steps: StepResult[] = [];
  for (const [index, step] of document.steps.entries()) {
    const result: StepResult = {
      sequence: index + 1,
      status: failed && index === document.steps.length - 1 ? "FAILED" : "PASSED",
      description:
        typeof step.description === "string"
          ? stripCaptionMarkup(step.description)
          : `Step ${index + 1}`,
      durationMs: typeof step.log?.duration === "number" ? step.log.duration : undefined,
    };
    const stepStartedAt = parseTimestamp(step.log?.start);
    if (
      result.status === "FAILED" &&
      video &&
      ffmpeg &&
      videoStartedAt !== undefined &&
      stepStartedAt !== undefined
    ) {
      const screenshotPath = join(resultDirectory, "screenshots", `step-${index + 1}.png`);
      try {
        await extractFrame(ffmpeg, video, screenshotPath, (stepStartedAt - videoStartedAt) / 1000);
        result.screenshotPath = screenshotPath;
      } catch (error) {
        console.warn(`The screenshot for step ${index + 1} could not be taken.`, error);
      }
    }
    steps.push(result);
  }
  return { steps, videoPath: video };
}

async function findReplayLog(files: string[]): Promise<string | undefined> {
  const named = files.find((path) => basename(path) === "replay-log.yml");
  if (named) return named;
  let recording: string | undefined;
  for (const path of files.filter((candidate) => /\.ya?ml$/i.test(candidate))) {
    try {
      const document = parse(await readFile(path, "utf8")) as {
        steps?: unknown;
        log?: unknown;
      };
      if (!Array.isArray(document.steps)) continue;
      if (document.log && typeof document.log === "object") return path;
      recording ??= path;
    } catch {
      // Continue with the next YAML artifact.
    }
  }
  return recording;
}

async function readVideoStartedAt(
  resultDirectory: string,
  files: string[],
  replayStartedAt: unknown,
): Promise<number | undefined> {
  try {
    const timeline = JSON.parse(
      await readFile(join(resultDirectory, "video-timeline.json"), "utf8"),
    ) as { videoStartedAt?: unknown };
    return parseTimestamp(timeline.videoStartedAt);
  } catch {
    const resultsXml = files.find((path) => basename(path) === "results.xml");
    if (resultsXml) {
      const match = (await readFile(resultsXml, "utf8")).match(
        /<testsuite[^>]+timestamp="([^"]+)"/,
      );
      const timestamp = parseTimestamp(match?.[1]);
      if (timestamp !== undefined) return timestamp;
    }
    return parseTimestamp(replayStartedAt);
  }
}

function stripCaptionMarkup(value: string): string {
  return value.replace(/<caption>(.*?)<\/caption>/g, "$1");
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

async function extractFrame(
  ffmpeg: string,
  video: string,
  screenshot: string,
  offsetSeconds: number,
): Promise<void> {
  await executeFile(ffmpeg, [
    "-loglevel",
    "error",
    "-ss",
    String(Math.max(0, offsetSeconds)),
    "-i",
    video,
    "-frames:v",
    "1",
    "-y",
    screenshot,
  ]);
}

async function resolveFfmpegExecutable(): Promise<string | undefined> {
  if (process.platform !== "darwin") return "ffmpeg";
  const cache = join(homedir(), "Library", "Caches", "ms-playwright");
  const entries = await readdir(cache, { withFileTypes: true }).catch(() => []);
  const directory = entries.find(
    (entry) => entry.isDirectory() && entry.name.startsWith("ffmpeg-"),
  );
  return directory ? join(cache, directory.name, "ffmpeg-mac") : undefined;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : Promise.resolve([path]);
    }),
  );
  return files.flat();
}
