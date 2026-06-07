'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { 
  ArrowLeft, 
  RefreshCw, 
  Loader2,
  Video,
  Music,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface VideoFormat {
  formatId: string;
  ext: string;
  resolution: string;
  qualityLabel: string;
  filesize: number | null;
  vcodec: string;
  acodec: string;
}

interface VideoInfo {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  duration: number;
  author: string;
  formats: VideoFormat[];
}

interface DownloadJob {
  id: string;
  status: 'downloading' | 'merging' | 'completed' | 'failed';
  progress: number;
  speed: string;
  eta: string;
  error?: string;
  filename?: string;
}

export default function Home() {
  const [step, setStep] = useState<'input' | 'select' | 'download' | 'ready'>('input');
  
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<DownloadJob | null>(null);
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Automatically trigger download when ready
  useEffect(() => {
    if (step === 'ready' && jobStatus?.id) {
      const downloadUrl = `/api/download/file?id=${jobStatus.id}`;
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = jobStatus.filename || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, [step, jobStatus]);

  const formatBytes = (bytes: number | null | undefined): string => {
    if (bytes === null || bytes === undefined || bytes === 0) return 'Unknown size';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze video');
      }

      setVideoInfo(data);
      setStep('select');
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching video details.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartDownload = async (format: VideoFormat) => {
    if (!videoInfo) return;

    setSelectedFormat(format);
    setLoading(true);
    setError(null);
    setStep('download');

    try {
      const res = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: videoInfo.url,
          title: videoInfo.title,
          formatId: format.formatId,
          ext: format.ext,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start download');
      }

      setJobId(data.jobId);
      setJobStatus({
        id: data.jobId,
        status: 'downloading',
        progress: 0,
        speed: '0 KB/s',
        eta: '--:--',
      });

      startPolling(data.jobId);
    } catch (err: any) {
      setError(err.message || 'Failed to start download job.');
      setStep('select');
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (id: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/download/status?id=${id}`);
        if (!res.ok) {
          throw new Error('Failed to fetch download status');
        }

        const data: DownloadJob = await res.json();
        setJobStatus(data);

        if (data.status === 'completed') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setStep('ready');
        } else if (data.status === 'failed') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setError(data.error || 'Download processing failed on backend.');
          setStep('select');
        }
      } catch (err: any) {
        console.error('Polling error:', err);
      }
    }, 1000);
  };

  const handleReset = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setStep('input');
    setUrl('');
    setVideoInfo(null);
    setSelectedFormat(null);
    setJobId(null);
    setJobStatus(null);
    setError(null);
  };

  const handleBackToSelect = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setStep('select');
    setJobId(null);
    setJobStatus(null);
    setError(null);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#1e1e21] text-zinc-100 font-sans p-6">
      <div className="w-full max-w-xl flex flex-col gap-6 items-center">
        
        {/* Title */}
        <h1 className="text-3xl md:text-4xl font-semibold tracking-normal text-white text-center">
          YouTube Video Downloader
        </h1>

        {/* Step 1: Flat Input Box */}
        {step === 'input' && (
          <div className="w-full flex flex-col gap-4">
            <form onSubmit={handleAnalyze} className="w-full bg-[#2a2a2e] border border-zinc-800 p-2 rounded-xl flex items-center">
              <input
                type="url"
                placeholder="Enter YouTube video URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                className="flex-1 bg-transparent border-none outline-none text-white text-sm placeholder:text-zinc-500 pr-4 pl-2"
              />
              <button 
                type="submit" 
                disabled={loading || !url.trim()}
                className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-5 rounded-lg text-sm font-medium transition-colors shrink-0 disabled:opacity-50 flex items-center justify-center h-9 w-28"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Get Video'
                )}
              </button>
            </form>

            {error && (
              <div className="flex items-start gap-2 bg-red-950/20 border border-red-900/40 text-red-400 px-4 py-3 rounded-xl text-sm w-full">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <p className="text-zinc-500 text-xs text-center mt-2">
              Please respect Youtube ToS and dont use this tool for any copyrighted content.
            </p>
          </div>
        )}

        {/* Step 2: Format Picker */}
        {step === 'select' && videoInfo && (
          <div className="w-full bg-[#2a2a2e] border border-zinc-800 rounded-xl p-6 flex flex-col gap-5">
            {/* Video Details Row */}
            <div className="flex gap-4 items-start border-b border-zinc-800 pb-4">
              <div className="relative w-32 aspect-video rounded overflow-hidden bg-black shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={videoInfo.thumbnail} 
                  alt={videoInfo.title}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[9px] font-bold px-1 py-0.5 rounded">
                  {formatDuration(videoInfo.duration)}
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <h3 className="text-white font-medium text-sm leading-snug line-clamp-2" title={videoInfo.title}>
                  {videoInfo.title}
                </h3>
                <p className="text-zinc-400 text-xs mt-1">{videoInfo.author}</p>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-950/20 border border-red-900/40 text-red-400 px-3 py-2.5 rounded-lg text-xs">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Formats Tabs */}
            <Tabs defaultValue="video" className="w-full">
              <TabsList className="flex w-full bg-[#1d1d20] border border-zinc-800 p-1 rounded-lg">
                <TabsTrigger 
                  value="video"
                  className="flex-1 data-active:bg-[#2a2a2e] data-active:text-white text-zinc-400 rounded-md py-1.5 text-xs font-medium transition-colors"
                >
                  <Video className="w-3.5 h-3.5 mr-1.5 inline" />
                  Video + Audio
                </TabsTrigger>
                <TabsTrigger 
                  value="audio"
                  className="flex-1 data-active:bg-[#2a2a2e] data-active:text-white text-zinc-400 rounded-md py-1.5 text-xs font-medium transition-colors"
                >
                  <Music className="w-3.5 h-3.5 mr-1.5 inline" />
                  Audio Only
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="video" className="mt-3 flex flex-col gap-2 max-h-[240px] overflow-y-auto pr-1">
                {videoInfo.formats.filter(f => f.resolution !== 'Audio').map((format) => (
                  <div 
                    key={format.formatId} 
                    className="flex items-center justify-between p-3 bg-[#1d1d20]/50 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                        {format.resolution}
                        <span className="text-[9px] font-normal px-1 py-0.2 bg-zinc-800 text-zinc-400 rounded">
                          {format.ext.toUpperCase()}
                        </span>
                      </span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">
                        Est. Size: {formatBytes(format.filesize)}
                      </span>
                    </div>
                    <button 
                      onClick={() => handleStartDownload(format)}
                      className="bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs font-medium px-4 py-1.5 rounded-md transition-colors"
                    >
                      Download
                    </button>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="audio" className="mt-3 flex flex-col gap-2">
                {videoInfo.formats.filter(f => f.resolution === 'Audio').map((format) => (
                  <div 
                    key={format.formatId} 
                    className="flex items-center justify-between p-3 bg-[#1d1d20]/50 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-white">
                        {format.qualityLabel}
                      </span>
                      <span className="text-[10px] text-zinc-500 mt-0.5">
                        Format: {format.ext.toUpperCase()} • Est. Size: {formatBytes(format.filesize)}
                      </span>
                    </div>
                    <button 
                      onClick={() => handleStartDownload(format)}
                      className="bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs font-medium px-4 py-1.5 rounded-md transition-colors"
                    >
                      Download
                    </button>
                  </div>
                ))}
              </TabsContent>
            </Tabs>

            <button 
              onClick={handleReset}
              className="text-zinc-500 hover:text-zinc-300 text-xs flex items-center gap-1.5 border border-zinc-800 hover:border-zinc-700 bg-transparent rounded-lg py-2 justify-center transition-colors mt-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Change Link
            </button>
          </div>
        )}

        {/* Step 3: Downloading Progress */}
        {step === 'download' && jobStatus && selectedFormat && (
          <div className="w-full bg-[#2a2a2e] border border-zinc-800 rounded-xl p-6 flex flex-col gap-5 text-center">
            <h3 className="text-white text-sm font-semibold flex items-center justify-center gap-2">
              {jobStatus.status === 'merging' ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-zinc-400" />
                  Merging video and audio streams...
                </>
              ) : (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                  Downloading...
                </>
              )}
            </h3>
            {/* Video Details Row */}
            {videoInfo && (
              <div className="flex gap-4 items-center border-b border-zinc-800 pb-4 text-left">
                <div className="relative w-24 aspect-video rounded overflow-hidden bg-black shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src={videoInfo.thumbnail} 
                    alt={videoInfo.title}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[9px] font-bold px-1 py-0.5 rounded">
                    {formatDuration(videoInfo.duration)}
                  </span>
                </div>
                <div className="flex flex-col min-w-0">
                  <h4 className="text-white font-medium text-xs leading-snug line-clamp-2" title={videoInfo.title}>
                    {videoInfo.title}
                  </h4>
                  <p className="text-zinc-400 text-[10px] mt-1">{videoInfo.author}</p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 mt-2">
              <Progress 
                value={jobStatus.progress} 
                className="h-1.5 bg-zinc-800 w-full [&_[data-slot=progress-indicator]]:bg-[#3b82f6]"
              />
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>Progress: {Math.round(jobStatus.progress)}%</span>
                {jobStatus.status === 'downloading' && (
                  <span>Speed: {jobStatus.speed}</span>
                )}
              </div>
            </div>

            <p className="text-[10px] text-red-400/80 bg-red-950/10 border border-red-900/20 py-2 rounded text-center">
              Please do not close this tab or leave the page while downloading.
            </p>

            {jobStatus.status === 'merging' && (
              <p className="text-[11px] text-zinc-400 bg-zinc-850 p-2.5 rounded border border-zinc-800/80 leading-normal text-left">
                Merging video and audio streams using FFmpeg backend. This can take a moment for large/long videos.
              </p>
            )}

            <button 
              onClick={handleBackToSelect}
              className="text-zinc-500 hover:text-zinc-300 text-xs border border-zinc-800 hover:border-zinc-700 bg-transparent py-2 rounded-lg transition-colors mt-2"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Step 4: Success / Ready to Save */}
        {step === 'ready' && jobStatus && (
          <div className="w-full bg-[#2a2a2e] border border-zinc-800 rounded-xl p-6 flex flex-col gap-5 items-center text-center">
            <div className="h-12 w-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.05)]">
              <CheckCircle2 className="h-6 w-6" />
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-white text-base font-semibold">Download Complete!</h3>
              <p className="text-zinc-400 text-xs line-clamp-1 max-w-[280px] mt-1 mx-auto">
                {videoInfo?.title}
              </p>
            </div>

            <div className="w-full flex flex-col gap-2 mt-2">
              <a 
                href={`/api/download/file?id=${jobStatus.id}`} 
                className="w-full bg-[#3b82f6] hover:bg-[#2563eb] text-white py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center"
              >
                Re-download
              </a>
              
              <button 
                onClick={handleReset}
                className="w-full border border-zinc-800 hover:border-zinc-700 bg-transparent text-zinc-400 hover:text-zinc-200 py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                Download Another Video
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
