import fs from 'node:fs';
import { ApiError, apiError } from '@/lib/api-input';
import { downloadJobs } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const job = downloadJobs.get(id);
    if (!job) throw new ApiError(404, 'JOB_NOT_FOUND', 'Job not found or expired.');
    if (job.status === 'completed' && (!job.outputPath || !fs.existsSync(job.outputPath))) {
      throw new ApiError(410, 'FILE_EXPIRED', 'Download has expired. Start a new job.');
    }
    return Response.json({ id, status: job.status, progress: job.progress, speed: job.speed,
      eta: job.eta, filename: job.filename,
      error: job.status === 'failed' ? { code: 'DOWNLOAD_FAILED', message: 'Download failed. Check server logs and start a new job.' } : null,
      fileUrl: job.status === 'completed' ? `/api/v1/downloads/${id}/file` : null },
    { headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } });
  } catch (error) { return apiError(error); }
}
