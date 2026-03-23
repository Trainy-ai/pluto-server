import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, Pause } from "lucide-react";

interface AudioAnalysisProps {
  url: string;
  isOpen: boolean;
  onClose: () => void;
}

export function AudioAnalysis({ url, isOpen, onClose }: AudioAnalysisProps) {
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("spectrum");

  useEffect(() => {
    if (!isOpen) return;

    const initAudioContext = async () => {
      try {
        setIsLoading(true);
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await audioContext.decodeAudioData(arrayBuffer);
        setAudioBuffer(buffer);

        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        sourceRef.current = source;

        source.connect(analyser);
        analyser.connect(audioContext.destination);

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
      try {
        sourceRef.current?.stop();
      } catch {
        // Source may not have been started
      }
      audioContextRef.current?.close();
    };
  }, [url, isOpen]);

  const togglePlayback = () => {
    if (!audioContextRef.current || !audioBuffer || !analyserRef.current)
      return;

    if (isPlaying) {
      try {
        sourceRef.current?.stop();
      } catch {
        // Source may not have been started
      }
    } else {
      const newSource = audioContextRef.current.createBufferSource();
      newSource.buffer = audioBuffer;
      newSource.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
      newSource.onended = () => setIsPlaying(false);
      newSource.start(0);
      sourceRef.current = newSource;
    }
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    if (!isAnalyzing || !spectrumCanvasRef.current || !analyserRef.current || activeTab !== "spectrum")
      return;

    const canvas = spectrumCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    let frameId: number;

    const draw = () => {
      frameId = requestAnimationFrame(draw);
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

    return () => cancelAnimationFrame(frameId);
  }, [isAnalyzing, activeTab]);

  useEffect(() => {
    if (!audioBuffer || !waveformCanvasRef.current || activeTab !== "waveform") return;

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
  }, [audioBuffer, activeTab]);

  const getAudioStats = () => {
    if (!audioBuffer) return null;

    const channelData = audioBuffer.getChannelData(0);
    const length = channelData.length;

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let sumSq = 0;

    for (let i = 0; i < length; i++) {
      const val = channelData[i];
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
      sumSq += val * val;
    }

    const avg = sum / length;
    const rms = Math.sqrt(sumSq / length);

    // Convert to dB (relative to full scale)
    const toDb = (val: number) => 20 * Math.log10(Math.abs(val) || 1e-10);

    return {
      minDb: toDb(min),
      maxDb: toDb(max),
      avgDb: toDb(avg),
      rmsDb: toDb(rms),
      dynamicRangeDb: toDb(max) - toDb(min),
      peakAmplitude: Math.max(Math.abs(min), Math.abs(max)),
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
    };
  };

  const stats = getAudioStats();

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Audio Analysis</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="spectrum" value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="spectrum">Spectrum</TabsTrigger>
            <TabsTrigger value="waveform">Waveform</TabsTrigger>
            <TabsTrigger value="stats">Statistics</TabsTrigger>
          </TabsList>

          <TabsContent value="spectrum" className="mt-4" forceMount hidden={activeTab !== "spectrum"}>
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

          <TabsContent value="waveform" className="mt-4" forceMount hidden={activeTab !== "waveform"}>
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
                {[...Array(6)].map((_, i) => (
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
                  <h4 className="font-medium">Peak Amplitude</h4>
                  <p className="font-mono text-2xl">
                    {stats.peakAmplitude.toFixed(4)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {stats.maxDb.toFixed(2)} dBFS
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium">RMS Level</h4>
                  <p className="font-mono text-2xl">
                    {stats.rmsDb.toFixed(2)} dBFS
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium">Duration</h4>
                  <p className="font-mono text-2xl">
                    {stats.duration.toFixed(2)}s
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium">Sample Rate</h4>
                  <p className="font-mono text-2xl">
                    {stats.sampleRate} Hz
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium">Channels</h4>
                  <p className="font-mono text-2xl">
                    {stats.channels}
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="font-medium">Dynamic Range</h4>
                  <p className="font-mono text-2xl">
                    {stats.dynamicRangeDb.toFixed(2)} dB
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
}
