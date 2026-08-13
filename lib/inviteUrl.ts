const PRODUCTION_APP_URL = "https://nuzlocke-tracker-iota.vercel.app";

type InviteUrlEnvironment = {
  appUrl?: string;
  vercelProductionUrl?: string;
  origin?: string;
  production?: boolean;
};

function normalizeBaseUrl(value?: string) {
  return value?.trim().replace(/\/+$/, "") ?? "";
}

function normalizeVercelDomain(value?: string) {
  const domain = normalizeBaseUrl(value);
  if (!domain) return "";
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

export function getInviteUrl(inviteCode: string, environment?: InviteUrlEnvironment) {
  const configuredUrl = normalizeBaseUrl(environment ? environment.appUrl : process.env.NEXT_PUBLIC_APP_URL);
  const vercelProductionUrl = normalizeVercelDomain(environment ? environment.vercelProductionUrl : process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL);
  const production = environment?.production ?? process.env.NODE_ENV === "production";
  const browserOrigin = normalizeBaseUrl(environment ? environment.origin : typeof window !== "undefined" ? window.location.origin : "");
  const baseUrl = configuredUrl || vercelProductionUrl || (production ? PRODUCTION_APP_URL : browserOrigin);
  return `${baseUrl}/?join=${encodeURIComponent(inviteCode)}`;
}
