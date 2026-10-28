import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Loads provider credentials from the app_secrets table into process.env
// (case-insensitive keys) so existing provider code keeps reading process.env.
export const withAppSecrets = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    try {
      const { data } = await (context.supabase as any).from("app_secrets").select("key, value");
      for (const row of (data ?? []) as { key: string; value: string }[]) {
        if (!row?.key || row.value == null) continue;
        const k = String(row.key).trim().toUpperCase();
        if (!process.env[k]) process.env[k] = String(row.value);
      }
    } catch (e) {
      console.error("app_secrets load failed", e);
    }
    return next();
  });

type SecretReader = {
  from: (table: "app_secrets") => {
    select: (columns: string) => PromiseLike<{
      data: { key: string; value: string }[] | null;
      error: unknown;
    }>;
  };
};

/**
 * Reads a single app_secrets value for the current request (case-insensitive key).
 * Keeps credentials request-scoped instead of copying them into process.env.
 */
export async function getAppSecret(
  reader: SecretReader,
  key: string,
  runtimeValue?: string,
): Promise<string | undefined> {
  if (runtimeValue?.trim()) return runtimeValue.trim();
  const { data, error } = await reader.from("app_secrets").select("key, value");
  if (error) throw new Error("No se pudo leer app_secrets. Revisa el permiso de lectura.");
  const want = key.trim().toUpperCase();
  return data?.find((row) => row.key.trim().toUpperCase() === want)?.value.trim() || undefined;
}
