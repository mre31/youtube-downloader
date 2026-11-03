import { apiError } from '@/lib/api-input';
import { downloadFile } from '@/lib/download-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return await downloadFile(id);
  } catch (error) { return apiError(error); }
}
