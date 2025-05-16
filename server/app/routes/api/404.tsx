export async function loader() {
  return new Response(JSON.stringify({ data: null, error: "404 Not Found." }), {
    headers: { "Content-Type": "application/json" },
  });
}
