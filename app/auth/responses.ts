/** Small JSON error Response, built without Response.json for older runtimes. */
export function jsonError(status: number, error: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
