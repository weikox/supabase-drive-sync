type SecretReader = {
  from: (table: "app_secrets") => {
    select: (columns: string) => PromiseLike<{
      data: { key: string; value: string }[] | null;
      error: unknown;
    }>;
  };
};

/** Keep credentials request-scoped: never copy a user's secret into process.env. */
export async function getCurenergiaScrapflyKey(reader: SecretReader, runtimeKey?: string) {
  if (runtimeKey?.trim()) return runtimeKey.trim();
  const { data, error } = await reader.from("app_secrets").select("key, value");
  if (error) throw new Error("No se pudo leer la clave de Scrapfly guardada en app_secrets. Revisa el permiso de lectura.");
  return data?.find((row) => row.key.trim().toUpperCase() === "SCRAPFLY_API_KEY")?.value.trim() || undefined;
}