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
