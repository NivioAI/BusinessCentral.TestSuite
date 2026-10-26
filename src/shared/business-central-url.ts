const DEFAULT_BUSINESS_CENTRAL_HOST = "businesscentral.dynamics.com";

export function isAllowedBusinessCentralUrl(
  value: string,
  configuredHosts = process.env.BCFT_ALLOWED_BC_HOSTS,
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")
  ) {
    return true;
  }
  if (url.protocol !== "https:") return false;
  const allowedHosts = new Set([
    DEFAULT_BUSINESS_CENTRAL_HOST,
    ...(configuredHosts ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  ]);
  return allowedHosts.has(hostname);
}
