export type HaomaiEnvironment = "development" | "test" | "production";
export function backendConfig() {
  const environment = import.meta.env.MODE;
  if (!["development", "test", "production"].includes(environment))
    throw new Error("Unsupported environment");
  const apiBaseUrl =
    import.meta.env.VITE_HAOMAI_API_BASE_URL ??
    (environment === "development" ? "http://127.0.0.1:8080/api/v1" : "");
  if (
    !apiBaseUrl ||
    !(
      apiBaseUrl.startsWith("https://") ||
      (environment === "development" && apiBaseUrl.startsWith("http://"))
    )
  )
    throw new Error(
      "Configure VITE_HAOMAI_API_BASE_URL before enabling backend integration",
    );
  return {
    environment: environment as HaomaiEnvironment,
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ""),
  };
}
