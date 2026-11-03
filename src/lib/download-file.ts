import fs from 'node:fs';
import { Readable } from 'node:stream';
import { ApiError } from './api-input';
import { downloadJobs } from './youtube';

export async function downloadFile(id: string): Promise<Response> {
  const job = downloadJobs.get(id);
  if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found or expired.');
  if (job.status !== 'completed' || !job.outputPath) {
    throw new ApiError(409, 'FILE_NOT_READY', 'The download has not completed successfully.');
  }
  // Open first so deletion between stat and stream creation cannot crash the response.
  const handle = await fs.promises.open(job.outputPath, 'r').catch(error => {
    if (error.code === 'ENOENT') throw new ApiError(410, 'FILE_EXPIRED', 'Download has expired. Start a new job.');
    throw error;
  });
  try {
    const stat = await handle.stat();
    const filename = (job.filename || 'download').replace(/["\\\r\n]/g, '_');
    const stream = handle.createReadStream();
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    await handle.close();
    throw error;
  }
}
