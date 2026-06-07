import { NextResponse } from 'next/server';
import { downloadJobs } from '@/lib/youtube';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }
    
    const job = downloadJobs.get(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    
    return NextResponse.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      speed: job.speed,
      eta: job.eta,
      error: job.error,
      filename: job.filename
    });
  } catch (error: any) {
    console.error('API Download Status Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch status' },
      { status: 500 }
    );
  }
}
