import path from 'path';
import fs from 'fs';
import YTDlpWrap from 'yt-dlp-wrap';
import ffmpegPath from 'ffmpeg-static';

const BIN_DIR = path.join(process.cwd(), 'bin');
const YT_DLP_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const TEMP_DIR = path.join(process.cwd(), 'temp');

// Resolve physical ffmpeg path to bypass Next.js server bundling rewriting
let resolvedFfmpegPath: string | null = null;
if (ffmpegPath) {
  if (ffmpegPath.includes('ROOT') || !path.isAbsolute(ffmpegPath)) {
    const physicalPath = path.join(
      process.cwd(),
      'node_modules',
      'ffmpeg-static',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    );
    if (fs.existsSync(physicalPath)) {
      resolvedFfmpegPath = physicalPath;
    } else {
      resolvedFfmpegPath = ffmpegPath;
    }
  } else {
    resolvedFfmpegPath = ffmpegPath;
  }
}

// Ensure temp directory exists and clean up leftover files on start
try {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  } else {
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') console.error('Error cleaning file on start:', err);
      });
    }
    console.log('Cleaned up temp directory on server startup.');
  }
} catch (err) {
  console.error('Failed to clean temp directory on startup:', err);
}

// Periodic auto-cleanup for orphaned files older than 10 minutes
if (typeof window === 'undefined') {
  setInterval(() => {
    try {
      if (fs.existsSync(TEMP_DIR)) {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        const maxAge = 10 * 60 * 1000; // 10 minutes
        
        for (const file of files) {
          const filePath = path.join(TEMP_DIR, file);
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > maxAge) {
            fs.unlink(filePath, (err) => {
              if (err && err.code !== 'ENOENT') console.error('Error auto-cleaning orphan file:', err);
              else console.log('Auto-cleaned orphan temp file:', filePath);
            });
          }
        }
      }
    } catch (err) {
      console.error('Failed to run periodic temp file cleanup:', err);
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
}

export interface VideoFormat {
  formatId: string;
  ext: string;
  resolution: string; // e.g., '1080p', '720p', 'Audio'
  qualityLabel: string; // e.g., '1080p (MP4)', '128kbps (M4A)'
  filesize: number | null; // bytes
  vcodec: string;
  acodec: string;
  fps?: number;
  tbr?: number;
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

// In-memory job cache
export const downloadJobs = new Map<string, DownloadJob>();

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

/**
 * Ensures yt-dlp binary is downloaded and ready for use.
 */
export async function ensureYtDlp(): Promise<string> {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  if (!fs.existsSync(YT_DLP_PATH)) {
    console.log(`yt-dlp not found. Downloading to ${YT_DLP_PATH}...`);
    await downloadYtDlp(YT_DLP_PATH);
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(YT_DLP_PATH, '755');
  }

  return YT_DLP_PATH;
}

/**
 * Retrieves metadata for a video and parses available formats.
 */
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const binaryPath = await ensureYtDlp();
  const ytDlpWrap = new YTDlpWrap(binaryPath);
  
  // Fetch raw JSON metadata
  const metadata = await ytDlpWrap.getVideoInfo(url);
  
  const rawFormats = metadata.formats || [];
  
  // Find the best audio-only format for merging size calculations
  const audioFormats = rawFormats.filter((f: any) => f.acodec !== 'none' && f.vcodec === 'none');
  const bestAudio = audioFormats.reduce((best: any, current: any) => {
    const bestTbr = best?.tbr || 0;
    const currentTbr = current?.tbr || 0;
    return currentTbr > bestTbr ? current : best;
  }, audioFormats[0] || null);

  const bestAudioSize = bestAudio ? (bestAudio.filesize || bestAudio.filesize_approx || 0) : 0;

  // Process formats
  const formats: VideoFormat[] = [];
  const resolutionMap = new Map<string, VideoFormat>();

  // 1. Group video formats by height (resolution)
  const videoFormats = rawFormats.filter((f: any) => f.vcodec !== 'none');
  
  for (const f of videoFormats) {
    if (!f.height) continue;
    
    const resolution = `${f.height}p`;
    const isVideoOnly = f.acodec === 'none';
    
    // Estimate size: if video-only, add best audio size since we will merge them
    const rawSize = f.filesize || f.filesize_approx || null;
    const totalSize = rawSize ? (isVideoOnly ? rawSize + bestAudioSize : rawSize) : null;
    
    const format: VideoFormat = {
      formatId: f.format_id,
      ext: isVideoOnly ? 'mp4' : f.ext, // force mp4 container for merged files
      resolution,
      qualityLabel: `${resolution} (${isVideoOnly ? 'Merged' : 'Direct'})`,
      filesize: totalSize,
      vcodec: f.vcodec,
      acodec: f.acodec,
      fps: f.fps,
      tbr: f.tbr
    };

    // If we already have a format for this resolution, keep the one with higher bitrate (tbr)
    const existing = resolutionMap.get(resolution);
    if (!existing || (format.tbr || 0) > (existing.tbr || 0)) {
      resolutionMap.set(resolution, format);
    }
  }

  // Add video formats to the list
  resolutionMap.forEach(f => formats.push(f));

  // Sort video formats from highest resolution to lowest
  formats.sort((a, b) => {
    const resA = parseInt(a.resolution);
    const resB = parseInt(b.resolution);
    return resB - resA;
  });

  // 2. Add standard Audio Only formats
  // We'll offer MP3 (converted via FFmpeg) and the native high-quality M4A
  if (bestAudio) {
    formats.push({
      formatId: 'bestaudio_mp3',
      ext: 'mp3',
      resolution: 'Audio',
      qualityLabel: 'MP3 (High Quality 320kbps)',
      filesize: bestAudioSize ? Math.round(bestAudioSize * 1.5) : null, // MP3 conversion usually increases size slightly
      vcodec: 'none',
      acodec: 'mp3'
    });

    formats.push({
      formatId: bestAudio.format_id,
      ext: bestAudio.ext === 'webm' ? 'm4a' : bestAudio.ext, // Prefer m4a if possible
      resolution: 'Audio',
      qualityLabel: `M4A (Native Quality ${Math.round((bestAudio.tbr || 128))}kbps)`,
      filesize: bestAudioSize || null,
      vcodec: 'none',
      acodec: bestAudio.acodec
    });
  }

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
  const binaryPath = await ensureYtDlp();
  
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const job: DownloadJob = {
    id: jobId,
    url,
    title,
    status: 'downloading',
    progress: 0,
    speed: '0 KiB/s',
    eta: '--:--',
    outputPath: null,
    filename: null
  };
  
  downloadJobs.set(jobId, job);

  // Build command-line arguments
  const args: string[] = [url];

  // Configure output path template
  // We use the jobId to make the filename unique and easy to find
  args.push('-o', path.join(TEMP_DIR, `${jobId}.%(ext)s`));

  // Provide FFmpeg location for conversions or merging
  if (resolvedFfmpegPath) {
    args.push('--ffmpeg-location', resolvedFfmpegPath);
  }

  // Handle format flags
  if (formatId === 'bestaudio_mp3') {
    // Extract audio and convert to MP3
    args.push('-f', 'bestaudio');
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (formatId.includes('+') || formatId.match(/^\d+$/)) {
    // User requested a specific format or merged stream
    args.push('-f', formatId);
  } else {
    // If it's a resolution-based request, we let yt-dlp download the video format
    // and best audio format, and merge them
    // E.g., if formatId is 1080p, we select bestvideo[height<=1080]+bestaudio
    if (formatId.endsWith('p')) {
      const height = parseInt(formatId);
      args.push('-f', `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`);
      args.push('--merge-output-format', 'mp4'); // Force merge to mp4
    } else {
      // Fallback
      args.push('-f', formatId);
    }
  }

  const ytDlpWrap = new YTDlpWrap(binaryPath);
  const ytDlpProcess = ytDlpWrap.exec(args);

  ytDlpProcess
    .on('progress', (progress) => {
      const currentJob = downloadJobs.get(jobId);
      if (currentJob && currentJob.status !== 'completed' && currentJob.status !== 'failed') {
        currentJob.progress = progress.percent || currentJob.progress;
        if (progress.currentSpeed) {
          currentJob.speed = progress.currentSpeed;
        }
        if (progress.eta) {
          currentJob.eta = progress.eta;
        }
        if (progress.percent === 100) {
          currentJob.status = 'merging';
        }
        downloadJobs.set(jobId, currentJob);
      }
    })
    .on('ytDlpEvent', (event, data) => {
      // Detect ffmpeg merging from logs
      if (data.includes('[Merger]') || data.includes('[ExtractAudio]')) {
        const currentJob = downloadJobs.get(jobId);
        if (currentJob && currentJob.status === 'downloading') {
          currentJob.status = 'merging';
          downloadJobs.set(jobId, currentJob);
        }
      }

      // Robust progress parsing fallback for speed/eta
      if (event === 'download') {
        const robustRegex = /^\s*([0-9.]+)%\s+of\s+([~0-9.a-zA-Z]+)\s+at\s+([0-9.a-zA-Z/]+|Unknown\s+speed)\s+ETA\s+([0-9:]+)/;
        const match = data.match(robustRegex);
        if (match) {
          const currentJob = downloadJobs.get(jobId);
          if (currentJob && currentJob.status !== 'completed' && currentJob.status !== 'failed') {
            currentJob.progress = parseFloat(match[1]) || currentJob.progress;
            currentJob.speed = match[3] || currentJob.speed;
            currentJob.eta = match[4] || currentJob.eta;
            downloadJobs.set(jobId, currentJob);
          }
        }
      }
    })
    .on('error', (error) => {
      console.error(`Job ${jobId} failed:`, error);
      const currentJob = downloadJobs.get(jobId);
      if (currentJob) {
        currentJob.status = 'failed';
        currentJob.error = error.message || 'Download error occurred';
        downloadJobs.set(jobId, currentJob);
      }
    })
    .on('close', () => {
      const currentJob = downloadJobs.get(jobId);
      if (currentJob && currentJob.status !== 'failed') {
        // Find the completed file in the temp directory
        try {
          const files = fs.readdirSync(TEMP_DIR);
          const matchedFile = files.find(f => f.startsWith(jobId));
          
          if (matchedFile) {
            currentJob.status = 'completed';
            currentJob.progress = 100;
            currentJob.outputPath = path.join(TEMP_DIR, matchedFile);
            
            // Clean up title for headers (ascii safe)
            const safeTitle = title.replace(/[^\x20-\x7E]/g, '');
            const cleanTitle = safeTitle.replace(/[\/\\:\*\?"<>\|]/g, '_');
            const fileExt = path.extname(matchedFile);
            currentJob.filename = `${cleanTitle || 'video'}${fileExt}`;
            
            downloadJobs.set(jobId, currentJob);
            console.log(`Job ${jobId} finished. File: ${matchedFile}`);
          } else {
            throw new Error('Completed file not found in temp directory.');
          }
        } catch (err: any) {
          currentJob.status = 'failed';
          currentJob.error = err.message || 'Output file processing failed';
          downloadJobs.set(jobId, currentJob);
        }
      }
    });
}
