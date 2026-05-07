import { useState, useRef, useEffect } from 'react';
import { Camera, X, RotateCcw, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CameraViewProps {
  onCapture: (base64: string) => void;
  onClose: () => void;
}

export default function CameraView({ onCapture, onClose }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function startCamera() {
      try {
        const constraints = {
          video: {
            facingMode: 'environment', // Use back camera
            width: { ideal: 4096 },
            height: { ideal: 2160 }
          }
        };
        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Camera access error:", err);
        setError("Unable to access camera. Please check permissions.");
      }
    }

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Calculate target dimensions to keep file size low while maintaining quality
      let width = video.videoWidth;
      let height = video.videoHeight;
      const MAX_DIMENSION = 1600; // Sufficient for clear document reading

      if (width > height) {
        if (width > MAX_DIMENSION) {
          height *= MAX_DIMENSION / width;
          width = MAX_DIMENSION;
        }
      } else {
        if (height > MAX_DIMENSION) {
          width *= MAX_DIMENSION / height;
          height = MAX_DIMENSION;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, width, height);
        // Using lower quality and jpeg to significantly reduce size
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        setCapturedImage(dataUrl);
      }
    }
  };

  const confirmPhoto = () => {
    if (capturedImage) {
      onCapture(capturedImage);
    }
  };

  const retakePhoto = () => {
    setCapturedImage(null);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center font-sans"
      id="camera-overlay"
    >
      <div className="relative w-full h-full flex flex-col">
        {!capturedImage ? (
          <>
            <video 
              ref={videoRef}
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
              id="camera-video"
            />
            
            {/* Viewfinder Top Bar */}
            <div className="absolute top-8 left-0 right-0 px-8 flex justify-between items-center text-white z-10">
              <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/20">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] font-mono uppercase tracking-widest">High Res Capture</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[10px] opacity-60 uppercase">Exp</p>
                  <p className="text-xs font-mono">+0.3</p>
                </div>
                <div className="text-right border-l border-white/20 pl-4">
                  <p className="text-[10px] opacity-60 uppercase">ISO</p>
                  <p className="text-xs font-mono">400</p>
                </div>
              </div>
            </div>

            {/* Viewfinder Corners */}
            <div className="absolute inset-12 md:inset-20 border border-white/10 rounded-2xl pointer-events-none">
              <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-indigo-500 rounded-tl-xl"></div>
              <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-indigo-500 rounded-tr-xl"></div>
              <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-indigo-500 rounded-bl-xl"></div>
              <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-indigo-500 rounded-br-xl"></div>
              
              <div className="absolute inset-0 flex items-center justify-center bg-white/5 backdrop-blur-[1px]">
                 <p className="text-white text-[10px] font-bold uppercase tracking-[0.2em] opacity-40">Position Document Within Frame</p>
              </div>
            </div>
            
            <div className="absolute bottom-12 left-0 right-0 flex flex-col items-center gap-6">
              <span className="text-white text-[10px] font-bold tracking-widest uppercase opacity-60">Scan Record</span>
              <div className="flex justify-center items-center gap-12">
                <button 
                  onClick={onClose}
                  className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white border border-white/20 transition-colors"
                  id="camera-close"
                >
                  <X size={20} />
                </button>
                <button 
                  onClick={takePhoto}
                  className="group flex flex-col items-center gap-4"
                  id="camera-shutter"
                >
                  <div className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center p-1.5 transition-transform group-hover:scale-105 active:scale-95">
                    <div className="w-full h-full rounded-full bg-white shadow-xl shadow-white/20"></div>
                  </div>
                </button>
                <div className="w-12" /> 
              </div>
            </div>
          </>
        ) : (
          <>
            <img 
              src={capturedImage} 
              className="w-full h-full object-contain bg-black" 
              alt="Captured"
              id="captured-preview"
            />
            <div className="absolute bottom-12 left-0 right-0 flex justify-center items-center gap-12">
              <button 
                onClick={retakePhoto}
                className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-white"
                id="camera-retake"
              >
                <RotateCcw size={28} />
              </button>
              <button 
                onClick={confirmPhoto}
                className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center text-white scale-110"
                id="camera-confirm"
              >
                <Check size={36} strokeWidth={3} />
              </button>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white text-center p-6">
          <p className="mb-4">{error}</p>
          <button onClick={onClose} className="px-6 py-2 bg-white text-black rounded-lg">Go Back</button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </motion.div>
  );
}
