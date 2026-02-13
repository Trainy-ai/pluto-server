/**
 * Check if an email address belongs to a top-level .edu domain.
 * Only matches emails where the domain TLD is exactly ".edu"
 * (e.g., user@stanford.edu), not subdomains like .edu.au.
 */
export function isEduEmail(email: string): boolean {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2 || parts[0].length === 0) {
    return false;
  }
  const domain = parts[1];
  return domain.endsWith(".edu");
}
