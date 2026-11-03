import { NextResponse } from 'next/server';
import { ApiError, jsonObject, youtubeUrl } from '@/lib/api-input';
import { getVideoInfo } from '@/lib/youtube';

export async function POST(request: Request) {
  try {
    const { url } = await jsonObject(request);
    const validatedUrl = youtubeUrl(url);
    const info = await getVideoInfo(validatedUrl);
    return NextResponse.json(info);
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('API Info Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch video details' },
      { status: 500 }
    );
  }
}
