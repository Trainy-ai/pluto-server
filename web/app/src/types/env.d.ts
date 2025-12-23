export {};

declare global {
  interface Window {
    __APP_ENV__?: Record<string, string | undefined>;
  }
}
