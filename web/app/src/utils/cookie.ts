export function parseCookies(): { [key: string]: string } {
  const cookies: { [key: string]: string } = {};

  if (!document.cookie) return cookies;

  document.cookie.split(";").forEach((cookie) => {
    const [key, value] = cookie.split("=").map((part) => part.trim());
    if (key && value) {
      cookies[key] = decodeURIComponent(value);
    }
  });

  return cookies;
}
