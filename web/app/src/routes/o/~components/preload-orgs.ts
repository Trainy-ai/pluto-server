import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

const LIMIT = 3;

export const usePreloadOrgs = (orgSlugs: string[]) => {
  const router = useRouter();

  useEffect(() => {
    Promise.all(
      orgSlugs.slice(0, LIMIT).map((slug) =>
        router.preloadRoute({
          to: "/o/$orgSlug",
          params: {
            orgSlug: slug,
          },
        }),
      ),
    );
  }, [router, orgSlugs]);
};
