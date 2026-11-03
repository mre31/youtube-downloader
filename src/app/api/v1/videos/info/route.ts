import { apiError, jsonObject, youtubeUrl } from '@/lib/api-input';
import { getVideoInfo } from '@/lib/youtube';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await jsonObject(request);
    const info = await getVideoInfo(youtubeUrl(body.url));
    return Response.json(info, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
