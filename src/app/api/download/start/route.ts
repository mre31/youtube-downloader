import { ApiError, jsonObject, youtubeUrl } from '@/lib/api-input';
import { NextResponse } from 'next/server';
import { startDownloadJob } from '@/lib/youtube';
import { getFormatArgs } from '@/lib/download-options';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request) {
  try {
    const { url, title, formatId, ext } = await jsonObject(request);
    if (![url, title, formatId, ext].every(value => typeof value === 'string' && value.length > 0)) {
      return NextResponse.json(
        { error: 'url, title, formatId, and ext are required' },
        { status: 400 }
      );
    }

    try {
      getFormatArgs(formatId as string, ext as string);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid original format' },
        { status: 400 }
      );
    }
    
    const validatedUrl = youtubeUrl(url);
    const jobId = uuidv4();
    
    // Start background download job asynchronously
    startDownloadJob(jobId, validatedUrl, title as string, formatId as string, ext as string).catch((err) => {
      console.error(`Background job ${jobId} failed:`, err);
    });
    
    return NextResponse.json({ jobId });
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('API Download Start Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start download' },
      { status: 500 }
    );
  }
}
