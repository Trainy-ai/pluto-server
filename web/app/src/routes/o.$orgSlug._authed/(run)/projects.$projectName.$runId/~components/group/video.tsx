import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type { LogGroup } from "../../~hooks/use-filtered-logs";
import { useGetVideos, type Video } from "../../~queries/get-videos";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Download,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  Settings,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const VIDEOS_PER_PAGE = 2;

interface VideoViewProps {
  log: LogGroup["logs"][number];
  tenantId: string;
  projectName: string;
  runId: string;
}

interface VideoPlayerProps {
  url: string;
  fileName: string;
  autoHideDelay?: number;
}

interface StepSliderProps {
  currentStep: number;
  totalSteps: number;
  onStepChange: (value: number[]) => void;
  currentStepValue: number;
  totalStepValue: number;
}

const StepSlider: React.FC<StepSliderProps> = ({
  currentStep,
  totalSteps,
  onStepChange,
  currentStepValue,
  totalStepValue,
}) => {
  return (
    <div className="mx-auto max-w-2xl px-4">
      <div className="flex items-center gap-4">
        <span className="font-mono text-sm font-medium">Step:</span>
        <Slider
          value={[currentStep]}
          onValueChange={onStepChange}
          max={totalSteps - 1}
          step={1}
          className="flex-1"
        />
        <div className="flex min-w-[100px] items-center justify-center">
          <div className="rounded-mdpx-2 flex items-center gap-1.5 py-1">
            <span className="font-mono text-sm font-medium">
              {currentStepValue}/{totalStepValue}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const isGif = (fileName: string) => {
  return fileName.toLowerCase().endsWith(".gif");
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  url,
  fileName,
  autoHideDelay = 3000,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const isGifFile = useMemo(() => isGif(fileName), [fileName]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(
    () => Number(localStorage.getItem("videoVolume")) || 1,
  );
  const [isMuted, setIsMuted] = useState(
    () => localStorage.getItem("videoMuted") === "true",
  );
  const [showControls, setShowControls] = useState(!isGifFile);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);

  // Handle GIF aspect ratio
  useEffect(() => {
    if (!isGifFile) return;

    const img = new Image();
    img.onload = () => {
      setAspectRatio(img.width / img.height);
    };
    img.src = url;
  }, [isGifFile, url]);

  // Video event handlers (only for non-GIF files)
  useEffect(() => {
    if (isGifFile) return;

    const video = videoRef.current;
    if (!video) return;

    const onLoadedMeta = () => {
      setDuration(video.duration);
      video.volume = volume;
      video.muted = isMuted;
      setAspectRatio(video.videoWidth / video.videoHeight);
    };

    const onTimeUpdate = () => {
      if (!isDraggingRef.current) {
        setCurrentTime(video.currentTime);
      }
    };

    const onEnded = () => {
      setIsPlaying(false);
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    video.addEventListener("loadedmetadata", onLoadedMeta);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMeta);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [isGifFile, volume, isMuted]);

  // Auto-hide controls (only for non-GIF files)
  const resetHide = useCallback(() => {
    if (isGifFile) return;

    setShowControls(true);
    if (hideTimeout.current) window.clearTimeout(hideTimeout.current);
    hideTimeout.current = window.setTimeout(
      () => setShowControls(false),
      autoHideDelay,
    );
  }, [autoHideDelay, isGifFile]);

  useEffect(() => {
    if (isGifFile) return;

    document.addEventListener("mousemove", resetHide);
    document.addEventListener("keydown", resetHide);
    resetHide();
    return () => {
      document.removeEventListener("mousemove", resetHide);
      document.removeEventListener("keydown", resetHide);
      if (hideTimeout.current) window.clearTimeout(hideTimeout.current);
    };
  }, [resetHide, isGifFile]);

  // Keyboard shortcuts (only for non-GIF files)
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (isGifFile) return;
      if (!videoRef.current) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          isPlaying ? videoRef.current.pause() : videoRef.current.play();
          setIsPlaying(!isPlaying);
          break;
        case "ArrowRight":
          videoRef.current.currentTime = Math.min(
            videoRef.current.currentTime + 5,
            duration,
          );
          break;
        case "ArrowLeft":
          videoRef.current.currentTime = Math.max(
            videoRef.current.currentTime - 5,
            0,
          );
          break;
        case "KeyM":
          videoRef.current.muted = !isMuted;
          setIsMuted(!isMuted);
          break;
        case "KeyF":
          toggleFullscreen();
          break;
        default:
          break;
      }
    },
    [isPlaying, duration, isMuted, isGifFile],
  );

  useEffect(() => {
    if (isGifFile) return;
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onKey, isGifFile]);

  // -- FULLSCREEN
  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    const elem = videoRef.current.parentElement;
    if (!elem) return;

    if (!isFullscreen) {
      elem.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
    setIsFullscreen(!isFullscreen);
  };

  // -- UTILS
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-1 flex-col bg-black"
    >
      <div
        className="relative aspect-video w-full flex-1"
        style={{
          maxHeight: "100%",
        }}
      >
        {isGifFile ? (
          <img
            src={url}
            alt={fileName}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <>
            <video
              ref={videoRef}
              src={url}
              className="absolute inset-0 h-full w-full object-contain"
              muted={isMuted}
              controls={false}
              disablePictureInPicture
              controlsList="nodownload noremoteplayback"
            />

            <AnimatePresence>
              {showControls && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col justify-between p-3"
                >
                  {/* Top Bar */}
                  <div className="flex justify-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => window.open(url, "_blank")}
                      className="bg-black/50 p-1"
                    >
                      <Download className="h-5 w-5 text-white" />
                    </Button>
                  </div>

                  {/* Middle Play Overlay */}
                  <div className="flex flex-1 items-center justify-center">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (videoRef.current) {
                          if (isPlaying) {
                            videoRef.current.pause();
                          } else {
                            videoRef.current.play();
                          }
                        }
                      }}
                      className="rounded-full bg-black/50 p-3 transition-transform hover:scale-110"
                    >
                      {isPlaying ? (
                        <Pause className="h-8 w-8 text-white" />
                      ) : (
                        <Play className="h-8 w-8 text-white" />
                      )}
                    </Button>
                  </div>

                  {/* Bottom Controls */}
                  <div className="flex flex-col gap-1 rounded-md bg-black/50 p-2">
                    {/* Progress Bar */}
                    <div className="flex w-full items-center gap-2">
                      <span className="min-w-[60px] font-mono text-xs text-white">
                        {formatTime(currentTime)}
                      </span>
                      <Slider
                        value={[currentTime]}
                        max={duration}
                        step={0.1}
                        onValueChange={(vals) => {
                          isDraggingRef.current = true;
                          const newTime = vals[0];
                          if (videoRef.current) {
                            videoRef.current.currentTime = newTime;
                          }
                          setCurrentTime(newTime);
                        }}
                        onValueCommit={() => {
                          isDraggingRef.current = false;
                        }}
                        className="flex-1"
                      />
                      <span className="min-w-[60px] text-right font-mono text-xs text-white">
                        {formatTime(duration)}
                      </span>
                    </div>

                    {/* Controls Bar */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => {
                            if (videoRef.current) {
                              if (isPlaying) {
                                videoRef.current.pause();
                              } else {
                                videoRef.current.play();
                              }
                            }
                          }}
                        >
                          {isPlaying ? (
                            <Pause className="h-4 w-4 text-white" />
                          ) : (
                            <Play className="h-4 w-4 text-white" />
                          )}
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                            >
                              {isMuted ? (
                                <VolumeX className="h-4 w-4 text-white" />
                              ) : (
                                <Volume2 className="h-4 w-4 text-white" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            side="top"
                            className="w-28 bg-black/90 p-2"
                          >
                            <Slider
                              orientation="vertical"
                              value={[isMuted ? 0 : volume]}
                              max={1}
                              step={0.01}
                              className="h-24"
                              onValueChange={(vals) => {
                                const newVolume = vals[0];
                                if (videoRef.current) {
                                  videoRef.current.volume = newVolume;
                                  videoRef.current.muted = newVolume === 0;
                                }
                                setVolume(newVolume);
                                setIsMuted(newVolume === 0);
                              }}
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={toggleFullscreen}
                      >
                        {isFullscreen ? (
                          <Minimize2 className="h-4 w-4 text-white" />
                        ) : (
                          <Maximize2 className="h-4 w-4 text-white" />
                        )}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
};

export const VideoView: React.FC<VideoViewProps> = ({
  log,
  tenantId,
  projectName,
  runId,
}) => {
  const { data, isLoading } = useGetVideos(
    tenantId,
    projectName,
    runId,
    log.logName,
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [page, setPage] = useState(0);

  // Memoize the steps array and current step value
  const { steps, currentStepValue, totalStepValue, currentStepVideos } =
    useMemo(() => {
      if (!data || !Array.isArray(data))
        return {
          steps: [],
          currentStepValue: 0,
          totalStepValue: 0,
          currentStepVideos: [],
        };

      const videosByStep = (data as Video[]).reduce(
        (acc: Record<number, Video[]>, video: Video) => {
          const step = video.step || 0;
          if (!acc[step]) {
            acc[step] = [];
          }
          acc[step].push(video);
          return acc;
        },
        {} as Record<number, Video[]>,
      );

      const sortedSteps = Object.keys(videosByStep)
        .map(Number)
        .sort((a, b) => a - b);

      return {
        steps: sortedSteps,
        currentStepValue: sortedSteps[currentStep] || 0,
        totalStepValue: sortedSteps[sortedSteps.length - 1] || 0,
        currentStepVideos: videosByStep[sortedSteps[currentStep] || 0] || [],
      };
    }, [data, currentStep]);

  const handleStepChange = (value: number[]) => {
    setCurrentStep(value[0]);
    setPage(0);
  };

  // Additional tailwind classes for videos
  const videoContainerClass = useMemo(() => {
    if (!currentStepVideos.length) return "";
    return "flex flex-col flex-1";
  }, [currentStepVideos.length]);

  if (isLoading || !data) {
    return (
      <div className="flex flex-col space-y-4">
        <h2 className="text-center font-mono text-lg">{log.logName}</h2>
        <div className="w-full animate-pulse">
          <div className="relative h-64 w-full bg-muted" />
        </div>
      </div>
    );
  }

  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-center font-mono text-lg">{log.logName}</h2>
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          No videos available
        </div>
      </div>
    );
  }

  // Total pages and current page slice
  const total = Math.ceil(currentStepVideos.length / VIDEOS_PER_PAGE);
  const slice = currentStepVideos.slice(
    page * VIDEOS_PER_PAGE,
    (page + 1) * VIDEOS_PER_PAGE,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4">
      <h2 className="text-center font-mono text-lg">{log.logName}</h2>

      {currentStepVideos.length === 1 ? (
        <div className="flex h-full min-h-0 w-full flex-1">
          <div className="flex flex-1 flex-col overflow-hidden rounded-md shadow-lg">
            <div className="flex flex-1 flex-col">
              <VideoPlayer
                url={currentStepVideos[0].url}
                fileName={currentStepVideos[0].fileName}
              />
              <p className="truncate border-t p-2 font-mono text-xs">
                {currentStepVideos[0].fileName}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
            {slice.map((video: Video) => (
              <div
                key={video.fileName}
                className="flex aspect-video flex-col overflow-hidden rounded-md shadow-lg"
              >
                <div className="flex flex-1 flex-col">
                  <VideoPlayer url={video.url} fileName={video.fileName} />
                  <p className="truncate border-t p-2 font-mono text-xs">
                    {video.fileName}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {total > 1 && (
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(p - 1, 0))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex min-w-[100px] items-center justify-center">
                  <span className="font-mono text-sm">
                    Page {page + 1} of {total}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setPage((p) => Math.min(p + 1, total - 1))}
                  disabled={page === total - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {steps.length > 1 && (
        <div className="border-t pt-4">
          <StepSlider
            currentStep={currentStep}
            totalSteps={steps.length}
            onStepChange={handleStepChange}
            currentStepValue={currentStepValue}
            totalStepValue={totalStepValue}
          />
        </div>
      )}
    </div>
  );
};
