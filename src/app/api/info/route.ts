import { NextResponse } from 'next/server';
import { getVideoInfo } from '@/lib/youtube';

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }
    
    const isYoutube = /youtube\.com|youtu\.be/i.test(url);
    if (!isYoutube) {
      return NextResponse.json({ error: 'Only YouTube URLs are supported' }, { status: 400 });
    }
    
    const info = await getVideoInfo(url);
    return NextResponse.json(info);
  } catch (error: any) {
    console.error('API Info Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch video details' },
      { status: 500 }
    );
  }
}
