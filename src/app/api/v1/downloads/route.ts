import { randomUUID } from 'node:crypto';
import { apiError, downloadOptions, jsonObject, selectFormat } from '@/lib/api-input';
import { getVideoInfo, startDownloadJob } from '@/lib/youtube';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const options = downloadOptions(await jsonObject(request));
    const info = await getVideoInfo(options.url);
    const format = selectFormat(info.formats, options);
    const id = randomUUID();
    // Registration happens synchronously before startDownloadJob's first await.
    void startDownloadJob(id, options.url, info.title, format.formatId, format.ext)
      .catch(error => console.error(`Background job ${id} failed:`, error));
    const statusUrl = `/api/v1/downloads/${id}`;
    return Response.json({ id, status: 'downloading', title: info.title, format,
      statusUrl, fileUrl: `${statusUrl}/file` },
    { status: 202, headers: { Location: statusUrl, 'Retry-After': '2', 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
