export async function loader() {
  return new Response(JSON.stringify({ data: null, error: "404 Not Found." }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
