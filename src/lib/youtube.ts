import path from 'path';
import fs from 'fs';
import YTDlpWrap from 'yt-dlp-wrap';
import ffmpegPath from 'ffmpeg-static';
import { buildVideoFormats, getFormatArgs, parseDownloadProgress, type SourceFormat, type VideoFormat } from './download-options';
export type { VideoFormat } from './download-options';

const BIN_DIR = path.join(process.cwd(), 'bin');
const YT_DLP_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const TEMP_DIR = path.join(process.cwd(), 'temp');

function getFfmpegPath(): string {
  const configured = process.env.FFMPEG_BIN || ffmpegPath;
  const physicalPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const resolved = configured && !configured.includes('ROOT') && path.isAbsolute(configured)
    ? configured : physicalPath;
  fs.accessSync(resolved, fs.constants.X_OK);
  return resolved;
}

export interface VideoInfo {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  duration: number; // seconds
  author: string;
  formats: VideoFormat[];
}

export interface DownloadJob {
  id: string;
  url: string;
  title: string;
  status: 'downloading' | 'merging' | 'completed' | 'failed';
  progress: number; // 0 to 100
  speed: string;
  eta: string;
  outputPath: string | null;
  filename: string | null;
  error?: string;
}

// Route bundles and development reloads must share the same jobs and cleanup timer.
const globalState = globalThis as typeof globalThis & {
  youtubeDownloads?: { jobs: Map<string, DownloadJob>; cleanupTimer: NodeJS.Timeout };
};

function cleanupOrphanedFiles(jobs: Map<string, DownloadJob>) {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    for (const file of fs.readdirSync(TEMP_DIR)) {
      const active = [...jobs.values()].some(job =>
        (job.status === 'downloading' || job.status === 'merging') && file.startsWith(`${job.id}.`)
      );
      if (active) continue;
      const filePath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && Date.now() - stat.mtimeMs > 10 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (error) {
    console.error('Failed to clean orphaned downloads:', error);
  }
}

if (!globalState.youtubeDownloads) {
  const jobs = new Map<string, DownloadJob>();
  cleanupOrphanedFiles(jobs);
  const cleanupTimer = setInterval(() => cleanupOrphanedFiles(jobs), 5 * 60 * 1000);
  cleanupTimer.unref();
  globalState.youtubeDownloads = { jobs, cleanupTimer };
}
export const downloadJobs = globalState.youtubeDownloads.jobs;

async function downloadYtDlp(dest: string): Promise<void> {
  let url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  if (process.platform === 'win32') {
    url += '.exe';
  } else if (process.platform === 'darwin') {
    url += '_macos';
  }
  
  console.log(`Downloading yt-dlp from: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download yt-dlp: ${response.status} ${response.statusText}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.promises.writeFile(dest, buffer);
  console.log(`yt-dlp downloaded successfully to: ${dest}`);
}

let lastCheckTime = 0;
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Ensures yt-dlp binary is downloaded and ready for use.
 * Automatically keeps yt-dlp updated if it is older than 2 days or if forced.
 */
export async function ensureYtDlp(forceUpdate = false): Promise<string> {
  // Container deployments use the version installed in the image. Update it
  // by rebuilding the image rather than modifying a running container.
  if (process.env.YT_DLP_PATH) {
    fs.accessSync(process.env.YT_DLP_PATH, fs.constants.X_OK);
    return process.env.YT_DLP_PATH;
  }

  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  const exists = fs.existsSync(YT_DLP_PATH);
  const now = Date.now();
  let shouldDownload = !exists || forceUpdate;

  if (exists && !shouldDownload && now - lastCheckTime > CHECK_INTERVAL) {
    try {
      const stats = fs.statSync(YT_DLP_PATH);
      const ageDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > 2) {
        console.log(`yt-dlp binary is ${ageDays.toFixed(1)} days old. Automatically refreshing...`);
        shouldDownload = true;
      }
      lastCheckTime = now;
    } catch (e) {
      console.warn('Could not inspect yt-dlp binary stats:', e);
    }
  }

  if (shouldDownload) {
    console.log(`Downloading / updating yt-dlp to ${YT_DLP_PATH}...`);
    await downloadYtDlp(YT_DLP_PATH);
    lastCheckTime = now;
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(YT_DLP_PATH, '755');
    } catch (e) {
      console.warn('Failed to set permissions on yt-dlp:', e);
    }
  }

  return YT_DLP_PATH;
}

/**
 * Standard yt-dlp arguments for modern YouTube compatibility
 */
export function getStandardYtDlpArgs(url: string): string[] {
  return [
    url,
    '--ignore-config',
    '--no-playlist',
    '--no-update',
    '--js-runtimes',
    'node',
  ];
}

/**
 * Retrieves metadata for a video and parses available formats.
 */
export async function getVideoInfo(url: string, isRetry = false): Promise<VideoInfo> {
  const binaryPath = await ensureYtDlp();
  const ytDlpWrap = new YTDlpWrap(binaryPath);
  
  let metadata: {
    id: string;
    title: string;
    thumbnail?: string;
    duration?: number;
    uploader?: string;
    author?: string;
    formats?: SourceFormat[];
  };
  try {
    // Fetch raw JSON metadata with JS runtime and modern extractor parameters
    // The wrapper forces '-f best', which fails when there is no combined stream.
    metadata = JSON.parse(await ytDlpWrap.execPromise([
      ...getStandardYtDlpArgs(url), '--dump-single-json', '--skip-download',
    ]));
  } catch (error) {
    if (!isRetry) {
      console.log('getVideoInfo failed. Forcing yt-dlp update and retrying once...', error instanceof Error ? error.message : String(error));
      await ensureYtDlp(true);
      return getVideoInfo(url, true);
    }
    throw error;
  }
  
  const formats = buildVideoFormats(metadata.formats || []);

  return {
    id: metadata.id,
    url,
    title: metadata.title,
    thumbnail: metadata.thumbnail || `https://img.youtube.com/vi/${metadata.id}/mqdefault.jpg`,
    duration: metadata.duration || 0,
    author: metadata.uploader || metadata.author || 'Unknown Artist',
    formats
  };
}

/**
 * Initiates the download in the background.
 */
export async function startDownloadJob(
  jobId: string,
  url: string,
  title: string,
  formatId: string,
  ext: string
): Promise<void> {
  const job: DownloadJob = {
    id: jobId, url, title, status: 'downloading', progress: 0,
    speed: '0 KiB/s', eta: '--:--', outputPath: null, filename: null,
  };
  // Register before awaiting setup so the status endpoint can always find the job.
  downloadJobs.set(jobId, job);

  const fail = (error: unknown, diagnostics = '') => {
    console.error(`Job ${jobId} failed:`, error, diagnostics);
    job.status = 'failed';
    const message = error instanceof Error ? error.message : String(error);
    const detail = message.split('\n').filter(line => line.startsWith('ERROR:')).pop();
    job.error = /Postprocessing|Conversion failed/i.test(message)
      ? 'Video/audio processing failed. FFmpeg details are available in the server logs.'
      : detail || message;
  };

  try {
    const binaryPath = await ensureYtDlp();
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const finalPathFile = path.join(TEMP_DIR, `${jobId}.filepath`);
    const args = [
      ...getStandardYtDlpArgs(url),
      '-o', path.join(TEMP_DIR, `${jobId}.%(ext)s`),
      '--ffmpeg-location', getFfmpegPath(),
      '--concurrent-fragments', '4',
      '--abort-on-unavailable-fragments',
      '--newline', '--progress', '--no-colors', '--verbose',
      '--print-to-file', 'after_move:%(filepath)s', finalPathFile,
      ...getFormatArgs(formatId, ext),
    ];
    const ytDlpProcess = new YTDlpWrap(binaryPath).exec(args);
    let diagnostics = '';
    // Verbose mode preserves the FFmpeg command and stderr on stream-copy errors.
    ytDlpProcess.ytDlpProcess?.stderr?.on('data', (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-32000);
    });
    ytDlpProcess
      .on('progress', (progress) => {
        if (job.status === 'failed' || job.status === 'completed') return;
        job.status = 'downloading';
        job.progress = progress.percent ?? job.progress;
        job.speed = progress.currentSpeed || job.speed;
        job.eta = progress.eta || job.eta;
      })
      .on('ytDlpEvent', (event, data: string) => {
        if (event === 'download') {
          const progress = parseDownloadProgress(data);
          if (progress) {
            job.progress = progress.percent;
            job.speed = progress.speed;
            job.eta = progress.eta;
          }
        }
        // yt-dlp-wrap strips the [Event] prefix from the event data.
        if (['Merger', 'FixupM4a', 'FixupM3u8', 'VideoRemuxer'].includes(event)) {
          job.status = 'merging';
          job.speed = '';
          job.eta = '--:--';
        }
      })
      .on('error', (error) => fail(error, diagnostics))
      .on('close', () => {
        if (job.status === 'failed') return;
        try {
          // Read yt-dlp's final path after all postprocessors, never a .part/source file.
          const outputPath = fs.readFileSync(finalPathFile, 'utf8').trim();
          const outputName = path.basename(outputPath);
          if (path.dirname(outputPath) !== TEMP_DIR || !outputName.startsWith(`${jobId}.`) ||
            !['.mp4', '.webm', '.mkv', '.m4a', '.mp3', '.opus', '.ogg', '.aac', '.flac', '.wav'].includes(path.extname(outputPath)) ||
            fs.statSync(outputPath).size === 0) {
            throw new Error('Completed media file not found.');
          }
          fs.unlinkSync(finalPathFile);
          const safeTitle = title.replace(/[^\x20-\x7E]/g, '').replace(/[\/\\:*?"<>|]/g, '_');
          job.status = 'completed';
          job.progress = 100;
          job.outputPath = outputPath;
          job.filename = `${safeTitle || 'video'}${path.extname(outputPath)}`;
          console.log(`Job ${jobId} finished. File: ${outputName}`);
        } catch (error) {
          fail(error, diagnostics);
        }
      });
  } catch (error) {
    fail(error);
  }
}
