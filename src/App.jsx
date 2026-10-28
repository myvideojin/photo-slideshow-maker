import React, { useState, useRef, useEffect } from 'react';
import ToolFAQ from './components/ToolFAQ';

import BrandedNav from './components/BrandedNav';
import BrandedFooter from './components/BrandedFooter';
import { 
  Upload, Music, Settings, Image as ImageIcon,
  Loader2, CheckCircle2, AlertCircle, AlertTriangle, Download, Plus, X
} from 'lucide-react';
import { useToolUsage } from './hooks/useToolUsage';

export default function PhotoSlideshowMaker() {
  const { checkUsage, incrementUsage } = useToolUsage();

  const faqs = [
    {
      "question": "How does the Photo Slideshow Maker work?",
      "answer": "It takes your uploaded images, resizes them to fit the selected aspect ratio, and stitches them together into an MP4 video using WebAssembly entirely in your browser."
    },
    {
      "question": "Are my images and audio uploaded to a server?",
      "answer": "No, all processing happens locally on your device. Your files never leave your browser, ensuring complete privacy and saving bandwidth."
    },
    {
      "question": "Can I add an audio track?",
      "answer": "Yes! You can optionally upload an audio file (like an MP3) and it will be merged with your slideshow."
    },
    {
      "question": "What is the maximum number of photos I can add?",
      "answer": "There is no strict limit, but adding too many high-resolution photos may slow down the processing or crash the browser. For best results, we recommend keeping it under 50 photos."
    }
  ];

  const [images, setImages] = useState([]);
  const [audioFile, setAudioFile] = useState(null);
  const [duration, setDuration] = useState(3);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [loadingMsg, setLoadingMsg] = useState('Booting Engine...');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [resultVideoUrl, setResultVideoUrl] = useState(null);
  
  const imageInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const ffmpegRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const loadStarted = useRef(false);

  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;

    const loadFFmpeg = async () => {
      try {
        setLoadingMsg("Fetching Engine...");
        const { createFFmpeg } = window.FFmpeg;
        const ffmpeg = createFFmpeg({
           log: true,
           corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
        });
        ffmpegRef.current = ffmpeg;
        await ffmpeg.load();
        setIsReady(true);
        setLoadingMsg('Engine Loaded');
        setError(null);
      } catch (err) {
        console.error("FFmpeg load error:", err);
        setError("Error: " + (err.message || "Failed to initialize WebAssembly."));
        setLoadingMsg("Failed to Load");
      }
    };
    
    setTimeout(() => {
        if (window.FFmpeg) {
            loadFFmpeg();
        } else {
            setError("Global FFmpeg library failed to inject.");
        }
    }, 500);
  }, []);

  const handleImageDrop = (e) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (droppedFiles.length > 0) {
      setImages(prev => [...prev, ...droppedFiles]);
      setError(null);
    } else {
      setError('Please upload valid image files.');
    }
  };

  const handleImageChange = (e) => {
    const selectedFiles = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    if (selectedFiles.length > 0) {
      setImages(prev => [...prev, ...selectedFiles]);
      setError(null);
    }
  };

  const handleAudioDrop = (e) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('audio/')) {
      setAudioFile(droppedFile);
      setError(null);
    } else {
      setError('Please upload a valid audio file.');
    }
  };

  const handleAudioChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type.startsWith('audio/')) {
      setAudioFile(selectedFile);
      setError(null);
    }
  };

  const removeImage = (idx) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  const handleProcess = async () => {
    if (!checkUsage()) {
      setError("Daily limit reached. Free users can process tools 3 times a day. Please upgrade for unlimited access.");
      return;
    }
    incrementUsage();

    if (images.length === 0 || !isReady) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setResultVideoUrl(null);
    setProcessProgress(0);

    try {
      const ffmpeg = ffmpegRef.current;
      const { fetchFile } = window.FFmpeg;
      
      setLoadingMsg('Uploading images to virtual filesystem...');
      
      try {
          const files = ffmpeg.FS('readdir', '/');
          files.forEach(f => {
              if (f.startsWith('img') || f === 'audio.mp3' || f === 'output.mp4') {
                  ffmpeg.FS('unlink', f);
              }
          });
      } catch (e) { /* ignore */ }

      for (let i = 0; i < images.length; i++) {
          const paddedNum = String(i + 1).padStart(3, '0');
          ffmpeg.FS('writeFile', `img${paddedNum}.jpg`, await fetchFile(images[i]));
      }

      if (audioFile) {
          ffmpeg.FS('writeFile', 'audio.mp3', await fetchFile(audioFile));
      }

      setLoadingMsg('Creating video (this may take a while)...');
      
      let progressVal = 0;
      let interval = setInterval(() => {
         progressVal = Math.min(progressVal + 2, 90);
         setProcessProgress(progressVal);
      }, 1000);

      const framerate = 1 / duration;
      
      let scaleFilter = '';
      if (aspectRatio === '9:16') {
          scaleFilter = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1';
      } else if (aspectRatio === '16:9') {
          scaleFilter = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1';
      } else {
          scaleFilter = 'scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2,setsar=1';
      }

      const args = [
          '-framerate', String(framerate),
          '-i', 'img%03d.jpg'
      ];
      
      if (audioFile) {
          args.push('-i', 'audio.mp3');
      }
      
      args.push(
          '-vf', scaleFilter,
          '-c:v', 'libx264',
          '-r', '30',
          '-pix_fmt', 'yuv420p'
      );
      
      if (audioFile) {
          args.push('-c:a', 'aac', '-shortest');
      }
      
      args.push('output.mp4');

      await ffmpeg.run(...args);

      clearInterval(interval);
      setProcessProgress(100);
      setLoadingMsg("Finalizing download...");

      const data = ffmpeg.FS('readFile', 'output.mp4');
      const url = window.URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
      
      setResultVideoUrl(url);
      setResult({ message: 'Success! Video has been generated.' });

      for (let i = 0; i < images.length; i++) {
          const paddedNum = String(i + 1).padStart(3, '0');
          try { ffmpeg.FS('unlink', `img${paddedNum}.jpg`); } catch (e) {}
      }
      if (audioFile) {
          try { ffmpeg.FS('unlink', 'audio.mp3'); } catch (e) {}
      }
      try { ffmpeg.FS('unlink', 'output.mp4'); } catch (e) {}

    } catch (err) {
      console.error(err);
      setError(err.message || 'An error occurred during video creation.');
    } finally {
      setIsProcessing(false);
      setProcessProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-[#020617] text-white p-6 md:p-12">
      
      <BrandedNav />
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter flex items-center gap-3">
              <ImageIcon className="text-fuchsia-500" /> Slideshow Maker
            </h1>
            <p className="text-gray-400 font-medium">Turn photos into a video instantly</p>
          </div>
          {images.length > 0 && !isProcessing && (
            <button 
              onClick={() => { setImages([]); setAudioFile(null); setResult(null); setError(null); }}
              className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full font-bold text-sm transition-colors border border-white/10"
            >
              Start Fresh
            </button>
          )}
        </div>

        {images.length === 0 ? (
          <div 
            className="w-full max-w-3xl mx-auto h-[60vh] border-2 border-dashed border-white/10 rounded-[2rem] flex flex-col items-center justify-center p-8 text-center hover:bg-white/5 hover:border-fuchsia-500/50 transition-all cursor-pointer group"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleImageDrop}
          >
            <input 
              type="file" 
              multiple
              id="image-input" 
              accept="image/*" 
              className="hidden" 
              onChange={handleImageChange}
            />
            <label htmlFor="image-input" className="cursor-pointer flex flex-col items-center w-full h-full justify-center">
              <div className="w-20 h-20 bg-fuchsia-500/10 text-fuchsia-500 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Upload size={32} />
              </div>
              <h2 className="text-2xl font-black mb-2">Select Photos</h2>
              <p className="text-gray-400 max-w-sm">Drag and drop your images here to start building your slideshow.</p>
              <div className="mt-8 px-4 py-2 bg-white/5 rounded-full text-xs font-bold text-gray-500 uppercase tracking-widest">
                Local Processing • Zero Uploads
              </div>
            </label>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Main Preview Area */}
            <div className="flex-1 flex flex-col items-center">
              <div className="w-full bg-black rounded-3xl border border-white/10 shadow-2xl overflow-hidden shrink-0 aspect-video flex items-center justify-center relative p-4">
                {resultVideoUrl ? (
                  <video 
                    src={resultVideoUrl}
                    className="absolute inset-0 w-full h-full object-contain bg-zinc-900"
                    controls
                    playsInline
                  />
                ) : (
                  <div className="w-full h-full grid grid-cols-3 sm:grid-cols-4 gap-2 overflow-y-auto content-start">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-white/10 group">
                        <img src={URL.createObjectURL(img)} alt={`Upload ${idx}`} className="w-full h-full object-cover" />
                        <button 
                          onClick={() => removeImage(idx)}
                          className="absolute top-1 right-1 p-1 bg-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <label className="aspect-square rounded-lg border-2 border-dashed border-white/20 flex flex-col items-center justify-center hover:bg-white/5 cursor-pointer text-gray-400 hover:text-white transition-colors">
                      <Plus size={24} />
                      <span className="text-xs mt-1">Add More</span>
                      <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageChange} />
                    </label>
                  </div>
                )}
              </div>

              {/* Status Indicator */}
              {!resultVideoUrl && (
                <div className="w-full mt-6 bg-white/5 rounded-2xl p-4 border border-white/10 flex justify-between items-center text-sm font-medium">
                  <span className="text-gray-400">{images.length} Photos Selected</span>
                  <span className="text-gray-400">Total Est: ~{(images.length * duration).toFixed(1)}s</span>
                </div>
              )}
            </div>

            {/* Sidebar Settings */}
            <div className="w-full lg:w-[350px] space-y-6">
              
              <div className="bg-fuchsia-500/10 border border-fuchsia-500/20 rounded-xl p-4 flex items-start gap-3">
                 <AlertTriangle className="w-5 h-5 text-fuchsia-400 shrink-0 mt-0.5" />
                 <div className="text-fuchsia-200 text-xs">
                   <span className="font-bold text-fuchsia-400">Note:</span> 
                   High-resolution photos will take longer to stitch.
                </div>
              </div>

              {/* Settings */}
              {!result && !isProcessing && (
                <div className="glass-card p-6 rounded-3xl border border-white/10 bg-white/5 space-y-6">
                  
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                      <Settings size={16} /> Aspect Ratio
                    </h3>
                    <select 
                      value={aspectRatio} 
                      onChange={(e) => setAspectRatio(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-fuchsia-500 font-bold"
                    >
                      <option value="9:16">9:16 (Reels, TikTok)</option>
                      <option value="16:9">16:9 (YouTube)</option>
                      <option value="1:1">1:1 (Square Post)</option>
                    </select>
                  </div>

                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                       Duration per photo
                    </h3>
                    <input 
                      type="range" 
                      min="1" max="10" step="0.5" 
                      value={duration} 
                      onChange={(e) => setDuration(Number(e.target.value))} 
                      className="w-full accent-fuchsia-500" 
                    />
                    <p className="text-xs text-right mt-1 text-gray-400 font-bold">{duration} seconds</p>
                  </div>

                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                      <Music size={16} /> Audio Track
                    </h3>
                    <label 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleAudioDrop}
                      className={`block w-full border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${audioFile ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'border-white/20 hover:border-fuchsia-400/50 hover:bg-white/5'}`}
                    >
                      <input type="file" accept="audio/*" className="hidden" onChange={handleAudioChange} />
                      {audioFile ? (
                        <div className="text-sm text-fuchsia-300 font-medium truncate px-2">{audioFile.name}</div>
                      ) : (
                        <div className="text-xs text-gray-400">Click or drop MP3 file (optional)</div>
                      )}
                    </label>
                    {audioFile && (
                      <button onClick={() => setAudioFile(null)} className="w-full text-xs text-red-400 mt-2 hover:underline">Remove Audio</button>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-200 text-sm">{error}</p>
                </div>
              )}

              {result && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-6 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-emerald-300 mb-4">{result.message}</p>
                  <div className="flex flex-col gap-3">
                    {resultVideoUrl && (
                      <a 
                        href={resultVideoUrl} 
                        download="slideshow.mp4"
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all text-sm"
                      >
                        <Download size={16} />
                        Download MP4
                      </a>
                    )}
                  </div>
                </div>
              )}

              {!result && (
                <button 
                  onClick={handleProcess}
                  disabled={isProcessing || !isReady}
                  className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl transition-all flex flex-col items-center justify-center gap-2 transform relative overflow-hidden ${
                    isProcessing || !isReady
                      ? 'bg-white/10 text-white/50 cursor-not-allowed'
                      : 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white shadow-fuchsia-600/20 hover:-translate-y-1'
                  }`}
                >
                  {isProcessing && (
                    <div 
                      className="absolute left-0 top-0 bottom-0 bg-white/20 transition-all duration-300"
                      style={{ width: `${processProgress}%` }}
                    ></div>
                  )}
                  
                  <div className="relative flex items-center gap-2">
                    {(isProcessing || !isReady) ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
                    {isProcessing || !isReady ? loadingMsg : 'Generate Video'}
                  </div>
                </button>
              )}

            </div>
          </div>
        )}
      </div>

      {/* SEO Sections */}
      <div className="mt-24 space-y-24 max-w-4xl mx-auto px-4">
        {/* How It Works */}
        <section>
          <h2 className="text-3xl font-bold mb-8 text-center">How to Create a Slideshow using AI</h2>
          <div className="grid md:grid-cols-4 gap-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-fuchsia-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-fuchsia-500/20">1</div>
              <h3 className="text-xl font-bold mb-3 text-fuchsia-400 mt-2">Upload Photos</h3>
              <p className="text-gray-400">Drag and drop your images. You can arrange them easily directly in the browser.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-blue-500/20">2</div>
              <h3 className="text-xl font-bold mb-3 text-blue-400 mt-2">Set Format</h3>
              <p className="text-gray-400">Select 9:16 for Reels, 16:9 for YouTube, or 1:1 for basic feeds.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-500/20">3</div>
              <h3 className="text-xl font-bold mb-3 text-indigo-400 mt-2">Add Audio</h3>
              <p className="text-gray-400">Include an MP3 file to set the vibe of your slideshow instantly.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative">
              <div className="absolute -top-4 -left-4 w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-xl shadow-lg shadow-purple-500/20">4</div>
              <h3 className="text-xl font-bold mb-3 text-purple-400 mt-2">Export</h3>
              <p className="text-gray-400">Our engine automatically stitches them together into a high quality MP4.</p>
            </div>
          </div>
        </section>

        {/* Feature Breakdown */}
        <section>
          <h2 className="text-3xl font-bold mb-8 text-center">Why Use Our Slideshow Maker?</h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">No Watermarks</h3>
              <p className="text-gray-400">Export clean, professional videos completely free of annoying branding or logos.</p>
            </div>
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">Fast Encoding</h3>
              <p className="text-gray-400">WebAssembly technology stitches your frames together rapidly, using your hardware.</p>
            </div>
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">Total Privacy</h3>
              <p className="text-gray-400">Since photos aren't uploaded, your personal memories stay safe and secure on your device.</p>
            </div>
            <div className="bg-[#0f172a] rounded-2xl p-8 border border-white/5">
              <h3 className="text-2xl font-bold mb-4">Social Ready</h3>
              <p className="text-gray-400">With built in aspect ratios, your video is instantly formatted perfectly for TikTok and IG.</p>
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section>
          <h2 className="text-3xl font-bold mb-8 text-center">Built for Content Creators & Professionals</h2>
          <div className="space-y-6">
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row gap-6 items-center">
              <div className="md:w-1/3">
                <h3 className="text-xl font-bold mb-2">Social Media Managers</h3>
              </div>
              <div className="md:w-2/3">
                <p className="text-gray-400">Quickly repurpose photo galleries into engaging short-form video reels that algorithms favor over static images.</p>
              </div>
            </div>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row gap-6 items-center">
              <div className="md:w-1/3">
                <h3 className="text-xl font-bold mb-2">Real Estate Agents</h3>
              </div>
              <div className="md:w-2/3">
                <p className="text-gray-400">Convert property photos into smooth video tours to post on listings and social feeds instantly.</p>
              </div>
            </div>
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row gap-6 items-center">
              <div className="md:w-1/3">
                <h3 className="text-xl font-bold mb-2">Event Photographers</h3>
              </div>
              <div className="md:w-2/3">
                <p className="text-gray-400">Deliver quick, music-backed summary reels to clients hours after a wedding or corporate event finishes.</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <ToolFAQ faqs={faqs} />
      <BrandedFooter />
    </div>
  );
}
