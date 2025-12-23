import type { LogGroup } from "@/lib/grouping/types";
import { trpc } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Download,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Volume2,
  VolumeX,
  BarChart3,
  X,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AudioViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
}

interface StepSliderProps {
  currentStep: number;
  totalSteps: number;
  onStepChange: (value: number[]) => void;
}

const StepSlider = ({
  currentStep,
  totalSteps,
  onStepChange,
}: StepSliderProps) => {
  // Ensure currentStep is within valid bounds
  const safeCurrentStep = Math.min(Math.max(0, currentStep), totalSteps);

  return (
    <div className="mx-auto max-w-2xl px-4">
      <div className="flex items-center gap-4">
        <span className="font-mono text-sm font-medium">Step:</span>
        <Slider
          value={[safeCurrentStep]}
          onValueChange={onStepChange}
          max={totalSteps}
          step={1}
          className="flex-1"
        />
        <div className="flex min-w-[100px] items-center justify-center">
          <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
            <span className="font-mono text-sm font-medium">
              {safeCurrentStep}/{totalSteps}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const PaginationControls = ({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationControlsProps) => {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-4 py-4">
      <Button
        variant="outline"
        size="icon"
        onClick={() => onPageChange(Math.max(0, currentPage - 1))}
        disabled={currentPage === 0}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
        <span className="font-mono text-sm font-medium">
          Page {currentPage + 1}/{totalPages}
        </span>
      </div>
      <Button
        variant="outline"
        size="icon"
        onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
        disabled={currentPage === totalPages - 1}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
};

interface AudioPlayerProps {
  url: string;
  fileName: string;
}

interface AudioAnalysisProps {
  url: string;
  isOpen: boolean;
  onClose: () => void;
}

const AudioAnalysis = ({ url, isOpen, onClose }: AudioAnalysisProps) => {
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const [audioData, setAudioData] = useState<Float32Array | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    const initAudioContext = async () => {
      try {
        setIsLoading(true);
        // Create new audio context
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        // Create analyzer
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        // Fetch and decode audio data
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await audioContext.decodeAudioData(arrayBuffer);
        setAudioBuffer(buffer);

        // Create source
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        sourceRef.current = source;

        // Connect nodes
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        // Get initial frequency data
        const frequencyData = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(frequencyData);
        setAudioData(frequencyData);

        setIsAnalyzing(true);
      } catch (error) {
        console.error("Error initializing audio analysis:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initAudioContext();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (sourceRef.current) {
        sourceRef.current.stop();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [url, isOpen]);

  const togglePlayback = () => {
    if (!audioContextRef.current || !audioBuffer || !analyserRef.current)
      return;

    if (isPlaying) {
      if (sourceRef.current) {
        sourceRef.current.stop();
      }
    } else {
      // Create new source for playback
      const newSource = audioContextRef.current.createBufferSource();
      newSource.buffer = audioBuffer;
      newSource.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
      newSource.start(0);
      sourceRef.current = newSource;
    }
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    if (!isAnalyzing || !spectrumCanvasRef.current || !analyserRef.current)
      return;

    const canvas = spectrumCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getFloatFrequencyData(dataArray);

      ctx.fillStyle = "rgb(0, 0, 0)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] + 140) * 1.5;
        const hue = (i / bufferLength) * 240;
        ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };

    draw();
  }, [isAnalyzing]);

  useEffect(() => {
    if (!audioBuffer || !waveformCanvasRef.current) return;

    const canvas = waveformCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const channelData = audioBuffer.getChannelData(0);
    const step = Math.ceil(channelData.length / canvas.width);
    const amp = canvas.height / 2;

    ctx.fillStyle = "rgb(0, 0, 0)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.moveTo(0, amp);

    for (let i = 0; i < canvas.width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = channelData[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.lineTo(i, (1 + min) * amp);
      ctx.lineTo(i, (1 + max) * amp);
    }

    ctx.strokeStyle = "rgb(255, 255, 255)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [audioBuffer]);

  const getAudioStats = () => {
    if (!audioData) return null;

    const min = Math.min(...audioData);
    const max = Math.max(...audioData);
    const avg = audioData.reduce((a, b) => a + b, 0) / audioData.length;
    const rms = Math.sqrt(
      audioData.reduce((a, b) => a + b * b, 0) / audioData.length,
    );

    return {
      min,
      max,
      avg,
      rms,
      dynamicRange: max - min,
    };
  };

  const stats = getAudioStats();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Audio Analysis</span>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="spectrum" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="spectrum">Spectrum</TabsTrigger>
            <TabsTrigger value="waveform">Waveform</TabsTrigger>
            <TabsTrigger value="stats">Statistics</TabsTrigger>
          </TabsList>

          <TabsContent value="spectrum" className="mt-4">
            <div className="space-y-4">
              <div className="relative">
                {isLoading ? (
                  <Skeleton className="h-[400px] w-full rounded-lg" />
                ) : (
                  <canvas
                    ref={spectrumCanvasRef}
                    width={800}
                    height={400}
                    className="w-full rounded-lg bg-black"
                  />
                )}
                {!isLoading && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute right-4 bottom-4"
                    onClick={togglePlayback}
                  >
                    {isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <h4 className="font-medium">Frequency Range</h4>
                  {isLoading ? (
                    <Skeleton className="h-4 w-24" />
                  ) : (
                    <p className="text-muted-foreground">
                      {analyserRef.current
                        ? `${(analyserRef.current.frequencyBinCount * 2).toFixed(0)} Hz`
                        : "N/A"}
                    </p>
                  )}
                </div>
                <div>
                  <h4 className="font-medium">FFT Size</h4>
                  {isLoading ? (
                    <Skeleton className="h-4 w-24" />
                  ) : (
                    <p className="text-muted-foreground">
                      {analyserRef.current
                        ? analyserRef.current.fftSize
                        : "N/A"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="waveform" className="mt-4">
            <div className="space-y-4">
              <div className="relative">
                {isLoading ? (
                  <Skeleton className="h-[400px] w-full rounded-lg" />
                ) : (
                  <canvas
                    ref={waveformCanvasRef}
                    width={800}
                    height={400}
                    className="w-full rounded-lg bg-black"
                  />
                )}
                {!isLoading && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute right-4 bottom-4"
                    onClick={togglePlayback}
                  >
                    {isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <h4 className="font-medium">Duration</h4>
                  {isLoading ? (
                    <Skeleton className="h-4 w-24" />
                  ) : (
                    <p className="text-muted-foreground">
                      {audioBuffer
                        ? `${audioBuffer.duration.toFixed(2)}s`
                        : "N/A"}
                    </p>
                  )}
                </div>
                <div>
                  <h4 className="font-medium">Sample Rate</h4>
                  {isLoading ? (
                    <Skeleton className="h-4 w-24" />
                  ) : (
                    <p className="text-muted-foreground">
                      {audioBuffer ? `${audioBuffer.sampleRate} Hz` : "N/A"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="stats" className="mt-4">
            {isLoading ? (
              <div className="grid grid-cols-2 gap-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="rounded-lg bg-muted p-4">
                    <h4 className="font-medium">
                      <Skeleton className="h-4 w-32" />
                    </h4>
                    <Skeleton className="mt-2 h-8 w-24" />
                  </div>
                ))}
              </div>
            ) : stats ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium">Minimum Amplitude</h4>
                  <p className="font-mono text-2xl">
                    {stats.min.toFixed(2)} dB
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium">Maximum Amplitude</h4>
                  <p className="font-mono text-2xl">
                    {stats.max.toFixed(2)} dB
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium">Average Amplitude</h4>
                  <p className="font-mono text-2xl">
                    {stats.avg.toFixed(2)} dB
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium">RMS Level</h4>
                  <p className="font-mono text-2xl">
                    {stats.rms.toFixed(2)} dB
                  </p>
                </div>
                <div className="col-span-2 rounded-lg bg-muted p-4">
                  <h4 className="font-medium">Dynamic Range</h4>
                  <p className="font-mono text-2xl">
                    {stats.dynamicRange.toFixed(2)} dB
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground">
                Loading audio statistics...
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

const AudioPlayer = ({ url, fileName }: AudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);
  const [showAnalysis, setShowAnalysis] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleTimeUpdate = () => {
      if (!isDragging) {
        setCurrentTime(audio.currentTime);
        setDisplayTime(audio.currentTime);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      setDisplayTime(0);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [isDragging]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeChange = (value: number[]) => {
    const newTime = value[0];
    setDisplayTime(newTime);
  };

  const handleTimeChangeEnd = (value: number[]) => {
    if (audioRef.current) {
      const newTime = value[0];
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      setDisplayTime(newTime);
    }
    setIsDragging(false);
  };

  const handleTimeChangeStart = () => {
    setIsDragging(true);
  };

  const handleVolumeChange = (value: number[]) => {
    if (audioRef.current) {
      const newVolume = value[0];
      audioRef.current.volume = newVolume;
      setVolume(newVolume);
      setIsMuted(newVolume === 0);
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch audio");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Failed to download file:", error);
      window.open(url, "_blank");
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-muted/15 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-sm break-all text-muted-foreground">
          {fileName}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setShowAnalysis(true)}
          >
            <BarChart3 className="h-4 w-4" />
            Analyze
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleDownload}
          >
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.currentTime = Math.max(0, currentTime - 5);
              }
            }}
          >
            <SkipBack className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            onClick={togglePlay}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.currentTime = Math.min(
                  duration,
                  currentTime + 5,
                );
              }
            }}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex w-full flex-1 items-center gap-2">
          <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
            {formatTime(displayTime)}
          </span>
          <Slider
            value={[displayTime]}
            onValueChange={handleTimeChange}
            onValueCommit={handleTimeChangeEnd}
            onPointerDown={handleTimeChangeStart}
            max={duration}
            step={0.5}
            className="flex-1"
          />
          <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
            {formatTime(duration)}
          </span>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button variant="outline" size="icon" onClick={toggleMute}>
            {isMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
          <Slider
            value={[isMuted ? 0 : volume]}
            onValueChange={handleVolumeChange}
            max={1}
            step={0.01}
            className="flex-1 sm:w-24"
          />
        </div>
      </div>

      <audio ref={audioRef} src={url} />

      <AudioAnalysis
        url={url}
        isOpen={showAnalysis}
        onClose={() => setShowAnalysis(false)}
      />
    </div>
  );
};

export const AudioView = ({
  log,
  tenantId,
  projectName,
  runId,
}: AudioViewProps) => {
  const { data, isLoading } = useQuery(
    trpc.runs.data.files.queryOptions({
      organizationId: tenantId,
      runId,
      projectName,
      logName: log.logName,
    }),
  );

  const [currentStep, setCurrentStep] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const audiosPerPage = 4;

  if (isLoading || !data) {
    return (
      <div className="space-y-6 p-4">
        <h3 className="text-center font-mono text-lg font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="flex flex-col items-center gap-3">
          <div className="w-full max-w-3xl">
            <div className="rounded-lg bg-muted/15 p-4">
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-center font-mono text-lg font-medium text-muted-foreground">
          {log.logName}
        </h3>
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          No audio files found
        </div>
      </div>
    );
  }

  if (data.length === 1) {
    const audio = data[0];
    return (
      <div className="space-y-6 p-4">
        <h3 className="text-center font-mono text-lg font-medium">
          {log.logName}
        </h3>
        <div className="flex flex-col items-center gap-3">
          <div className="w-full max-w-3xl">
            <AudioPlayer url={audio.url} fileName={audio.fileName} />
          </div>
        </div>
      </div>
    );
  }

  // Group audio files by step
  const audioByStep = data.reduce(
    (acc, audio) => {
      const step = audio.step || 0;
      if (!acc[step]) {
        acc[step] = [];
      }
      acc[step].push(audio);
      return acc;
    },
    {} as Record<number, typeof data>,
  );

  const steps = Object.keys(audioByStep)
    .map(Number)
    .sort((a, b) => a - b);

  // Ensure currentStep is within valid bounds
  const safeCurrentStep = Math.min(Math.max(0, currentStep), steps.length - 1);
  const currentStepAudios = audioByStep[steps[safeCurrentStep]] || [];
  const totalPages = Math.max(
    1,
    Math.ceil(currentStepAudios.length / audiosPerPage),
  );

  // Ensure currentPage is within valid bounds
  const safeCurrentPage = Math.min(Math.max(0, currentPage), totalPages - 1);

  const paginatedAudios = currentStepAudios.slice(
    safeCurrentPage * audiosPerPage,
    (safeCurrentPage + 1) * audiosPerPage,
  );

  const handleStepChange = (value: number[]) => {
    const newStep = value[0];
    setCurrentStep(newStep);
    setCurrentPage(0);
  };

  return (
    <div className="space-y-6 p-4">
      <h3 className="text-center font-mono text-lg font-medium">
        {log.logName}
      </h3>

      {steps.length > 1 && (
        <StepSlider
          currentStep={safeCurrentStep}
          totalSteps={steps.length - 1}
          onStepChange={handleStepChange}
        />
      )}

      <div className="space-y-4">
        {paginatedAudios.map((audio) => (
          <AudioPlayer
            key={audio.fileName}
            url={audio.url}
            fileName={audio.fileName}
          />
        ))}

        {totalPages > 1 && (
          <PaginationControls
            currentPage={safeCurrentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
    </div>
  );
};
