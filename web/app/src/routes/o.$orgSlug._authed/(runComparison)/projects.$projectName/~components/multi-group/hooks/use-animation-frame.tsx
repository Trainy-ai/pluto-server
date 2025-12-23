import { useRef, useEffect } from "react";

export function useAnimationFrame(
  callback: (deltaTime: number) => void,
  isActive: boolean,
  animationSpeed: number,
  currentStep: number,
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>,
  maxStep: number,
  stopAnimation: () => void,
) {
  const lastTimeRef = useRef<number>(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const animate = (timestamp: number) => {
      if (!lastTimeRef.current) {
        lastTimeRef.current = timestamp;
      }
      const elapsed = timestamp - lastTimeRef.current;
      if (elapsed >= animationSpeed) {
        setCurrentStep((prev: number) => {
          if (prev >= maxStep) {
            stopAnimation();
            return 0;
          }
          return prev + 1;
        });
        lastTimeRef.current = timestamp;
      }
      if (isActive) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    if (isActive) {
      frameRef.current = requestAnimationFrame(animate);
    }

    return () => cancelAnimationFrame(frameRef.current);
  }, [
    isActive,
    animationSpeed,
    currentStep,
    maxStep,
    setCurrentStep,
    stopAnimation,
    callback,
  ]);
}
