import { NextResponse } from 'next/server';
import { downloadJobs } from '@/lib/youtube';
import fs from 'fs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }
    
    const job = downloadJobs.get(id);
    if (!job || job.status !== 'completed' || !job.outputPath) {
      return NextResponse.json({ error: 'File not ready or job not found' }, { status: 400 });
    }
    
    const filePath = job.outputPath;
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }
    
    const stat = fs.statSync(filePath);
    const fileStream = fs.createReadStream(filePath);
    
    // Create a Web ReadableStream that streams the file and cleans it up after completion/cancellation
    const readable = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => {
          controller.enqueue(chunk);
        });
        fileStream.on('end', () => {
          controller.close();
          // Keep the file on disk for 3 minutes to allow re-downloads, then delete
          setTimeout(() => {
            fs.unlink(filePath, (err) => {
              if (err && err.code !== 'ENOENT') console.error('Error deleting temp file:', err);
              else console.log('Successfully cleaned up temp file after timeout:', filePath);
            });
            downloadJobs.delete(id);
          }, 3 * 60 * 1000);
        });
        fileStream.on('error', (err) => {
          controller.error(err);
          fs.unlink(filePath, (err) => {
            if (err) console.error('Error deleting temp file on stream error:', err);
          });
          downloadJobs.delete(id);
        });
      },
      cancel() {
        fileStream.destroy();
        fs.unlink(filePath, (err) => {
          if (err) console.error('Error deleting temp file on download cancel:', err);
        });
        downloadJobs.delete(id);
      }
    });

    const headers = new Headers();
    // Use raw filename header but also attachment filename format
    headers.set('Content-Disposition', `attachment; filename="${job.filename || 'download'}"`);
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Length', stat.size.toString());

    return new Response(readable, { headers });
  } catch (error: any) {
    console.error('API Download File Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to stream file' },
      { status: 500 }
    );
  }
}
