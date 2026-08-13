export type CloudErrorDetails = { code?: string; message?: string; details?: string; hint?: string };

export function getCloudErrorDetails(error: unknown): CloudErrorDetails {
  if (!error || typeof error !== "object") return {};
  const value = error as Record<string, unknown>;
  return {
    code: typeof value.code === "string" ? value.code : undefined,
    message: typeof value.message === "string" ? value.message : undefined,
    details: typeof value.details === "string" ? value.details : undefined,
    hint: typeof value.hint === "string" ? value.hint : undefined,
  };
}

export function getDeleteRunErrorMessage(error: unknown, development = false) {
  const details = getCloudErrorDetails(error);
  const raw = details.message ?? (error instanceof Error ? error.message : "");
  if (details.code === "PGRST202" || /delete_run|function.*not found|schema cache/i.test(raw)) return "delete_run RPC wurde nicht gefunden. Führe die aktuelle Supabase-Migration aus.";
  if (details.code === "42501" || /host permission|required|permission denied/i.test(raw)) return "Nur der aktuelle Host darf diesen Run löschen.";
  if (details.code === "28000" || /authentication required/i.test(raw)) return "Die Supabase-Anmeldung ist nicht mehr gültig. Bitte lade die Seite neu.";
  if (development && raw) return `Der Online-Run konnte nicht gelöscht werden: ${raw}`;
  return "Der Online-Run konnte nicht gelöscht werden. Bitte versuche es erneut.";
}

export function isAlreadyDeletedError(error: unknown) {
  const details = getCloudErrorDetails(error);
  const text = `${details.message ?? ""} ${details.details ?? ""}`;
  return details.code === "PGRST116" || details.code === "404" || /run not found|no rows|already deleted/i.test(text);
}
