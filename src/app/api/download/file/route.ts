import { ApiError, apiError } from '@/lib/api-input';
import { downloadFile } from '@/lib/download-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw new ApiError(400, 'INVALID_ID', 'Job ID is required.');
    return await downloadFile(id);
  } catch (error) { return apiError(error); }
}
