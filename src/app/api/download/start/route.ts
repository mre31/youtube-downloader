import { NextResponse } from 'next/server';
import { startDownloadJob } from '@/lib/youtube';
import { getFormatArgs } from '@/lib/download-options';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request) {
  try {
    const { url, title, formatId, ext } = await request.json();
    if (![url, title, formatId, ext].every(value => typeof value === 'string' && value.length > 0)) {
      return NextResponse.json(
        { error: 'url, title, formatId, and ext are required' },
        { status: 400 }
      );
    }

    try {
      getFormatArgs(formatId, ext);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid original format' },
        { status: 400 }
      );
    }
    
    const jobId = uuidv4();
    
    // Start background download job asynchronously
    startDownloadJob(jobId, url, title, formatId, ext).catch((err) => {
      console.error(`Background job ${jobId} failed:`, err);
    });
    
    return NextResponse.json({ jobId });
  } catch (error) {
    console.error('API Download Start Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start download' },
      { status: 500 }
    );
  }
}
