import React from "react";
import { trpc } from "@/utils/trpc";
import { useQueries } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Download,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Slider } from "@/components/ui/slider";

interface MultiGroupAudioProps {
  logName: string;
  organizationId: string;
  projectName: string;
  runs: {
    runId: string;
    runName: string;
    color: string;
  }[];
  className?: string;
}

export const MultiGroupAudio = ({
  logName,
  organizationId,
  projectName,
  runs,
  className,
}: MultiGroupAudioProps) => {
  // Use useQueries for multiple runs
  const audioQueries = useQueries({
    queries: runs.map((run) => ({
      ...trpc.runs.data.files.queryOptions({
        organizationId,
        runId: run.runId,
        projectName,
        logName,
      }),
    })),
  });

  // Combine queries with run data
  const queriesWithRuns = audioQueries.map((query, index) => ({
    ...query,
    run: runs[index],
  }));

  const isLoading = queriesWithRuns.some((query) => query.isLoading);

  if (isLoading) {
    return (
      <div className={cn("space-y-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="grid grid-cols-1 gap-4">
          {runs.map((run) => (
            <div key={run.runId} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-center gap-1.5">
                <Skeleton className="h-2 w-2 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="rounded-lg bg-muted/15 p-4">
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Filter out runs with no audio data
  const runsWithAudio = queriesWithRuns.filter((query) => query.data?.[0]);

  if (runsWithAudio.length === 0) {
    return (
      <div className={cn("space-y-4", className)}>
        <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
          {logName}
        </h3>
        <div className="flex h-20 items-center justify-center text-muted-foreground">
          No audio files found
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <h3 className="text-center font-mono text-sm font-medium text-muted-foreground">
        {logName}
      </h3>
      <div className="grid grid-cols-1 gap-4">
        {runsWithAudio.map(({ data, run }) => (
          <AudioPlayer key={run.runId} audio={data![0]} run={run} />
        ))}
      </div>
    </div>
  );
};

interface AudioPlayerProps {
  audio: { url: string; fileName: string };
  run: { runName: string; color: string };
}

const AudioPlayer = ({ audio, run }: AudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);

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
      const response = await fetch(audio.url);
      if (!response.ok) throw new Error("Failed to fetch audio");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = audio.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Failed to download file:", error);
      window.open(audio.url, "_blank");
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-center gap-1.5">
        <div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: run.color }}
        />
        <span className="text-sm font-medium" style={{ color: run.color }}>
          {run.runName}
        </span>
      </div>
      <div className="flex flex-col gap-3 rounded-lg bg-muted/15 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-mono text-xs text-muted-foreground">
            {audio.fileName}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2"
            onClick={handleDownload}
          >
            <Download className="h-3 w-3" />
            <span className="text-xs">Download</span>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.currentTime = Math.max(0, currentTime - 5);
                }
              }}
            >
              <SkipBack className="h-3 w-3" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={togglePlay}
            >
              {isPlaying ? (
                <Pause className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.currentTime = Math.min(
                    duration,
                    currentTime + 5,
                  );
                }
              }}
            >
              <SkipForward className="h-3 w-3" />
            </Button>
          </div>

          <div className="flex flex-1 items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">
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
            <span className="font-mono text-xs text-muted-foreground">
              {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={toggleMute}
            >
              {isMuted ? (
                <VolumeX className="h-3 w-3" />
              ) : (
                <Volume2 className="h-3 w-3" />
              )}
            </Button>
            <Slider
              value={[isMuted ? 0 : volume]}
              onValueChange={handleVolumeChange}
              max={1}
              step={0.01}
              className="w-20"
            />
          </div>
        </div>

        <audio ref={audioRef} src={audio.url} />
      </div>
    </div>
  );
};
