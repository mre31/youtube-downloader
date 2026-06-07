import { NextResponse } from 'next/server';
import { startDownloadJob } from '@/lib/youtube';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request) {
  try {
    const { url, title, formatId, ext } = await request.json();
    if (!url || !title || !formatId || !ext) {
      return NextResponse.json(
        { error: 'url, title, formatId, and ext are required' },
        { status: 400 }
      );
    }
    
    const jobId = uuidv4();
    
    // Start background download job asynchronously
    startDownloadJob(jobId, url, title, formatId, ext).catch((err) => {
      console.error(`Background job ${jobId} failed:`, err);
    });
    
    return NextResponse.json({ jobId });
  } catch (error: any) {
    console.error('API Download Start Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to start download' },
      { status: 500 }
    );
  }
}
