import { useEffect, useState } from "react";

const getStorageKey = (orgSlug: string) => `getting-started-hidden`;

interface UseGettingStartedVisibilityProps {
  orgSlug: string;
}

export const useGettingStartedVisibility = ({
  orgSlug,
}: UseGettingStartedVisibilityProps) => {
  const [isGettingStartedHidden, setIsGettingStartedHidden] = useState(true);
  const storageKey = getStorageKey(orgSlug);

  useEffect(() => {
    const hidden = localStorage.getItem(storageKey);
    setIsGettingStartedHidden(hidden === "true");
  }, [storageKey]);

  const setVisibility = (hidden: boolean) => {
    setIsGettingStartedHidden(hidden);
    localStorage.setItem(storageKey, String(hidden));
  };

  return {
    visibility: isGettingStartedHidden
      ? ("hidden" as const)
      : ("visible" as const),
    setVisibility,
  };
};
