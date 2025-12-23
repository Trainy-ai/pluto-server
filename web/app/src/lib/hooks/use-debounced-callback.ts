import { useEffect, useMemo, useRef } from "react";

/** Options for configuring the debounce behavior */
interface DebounceOptions {
  /** Maximum time to wait before executing the callback, if specified */
  maxWait?: number;
}

/** Type definition for the debounced function, which includes a cancel method */
type DebouncedFunction<T extends (...args: any[]) => any> = ((
  ...args: Parameters<T>
) => void) & { cancel: () => void };

/**
 * Creates a debounced version of a callback function with a cancel method.
 * @param callback - The function to debounce
 * @param delay - The debounce delay in milliseconds
 * @param options - Optional configuration including maxWait
 * @returns A debounced function with a cancel method
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
  options: DebounceOptions = {},
): DebouncedFunction<T> {
  const { maxWait } = options;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const maxWaitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCallRef = useRef<{ args: Parameters<T>; time: number } | null>(
    null,
  );

  // Cleanup timeouts on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (maxWaitTimeoutRef.current) {
        clearTimeout(maxWaitTimeoutRef.current);
      }
    };
  }, []);

  // Memoize the debounced function to prevent unnecessary recreation
  const debouncedFunction = useMemo(() => {
    const fn = (...args: Parameters<T>) => {
      const now = Date.now();
      lastCallRef.current = { args, time: now };

      // Clear any existing debounce timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set a new debounce timeout
      timeoutRef.current = setTimeout(() => {
        if (lastCallRef.current) {
          callback(...lastCallRef.current.args);
          lastCallRef.current = null;
        }
      }, delay);

      // Handle maxWait if specified and no maxWait timeout exists
      if (maxWait && !maxWaitTimeoutRef.current) {
        maxWaitTimeoutRef.current = setTimeout(() => {
          if (lastCallRef.current) {
            callback(...lastCallRef.current.args);
            lastCallRef.current = null;
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }
          }
          maxWaitTimeoutRef.current = null;
        }, maxWait);
      }
    };

    // Attach the cancel method to the function
    fn.cancel = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (maxWaitTimeoutRef.current) {
        clearTimeout(maxWaitTimeoutRef.current);
        maxWaitTimeoutRef.current = null;
      }
      lastCallRef.current = null;
    };

    return fn;
  }, [callback, delay, maxWait]) as DebouncedFunction<T>;

  return debouncedFunction;
}
