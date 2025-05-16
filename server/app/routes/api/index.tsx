export async function loader() {
  return new Response(JSON.stringify({ data: [], error: null }), {
    headers: { "Content-Type": "application/json" },
  });
}
