export async function parseSuccessfulNotificationResponse(response, serviceName) {
  if (!response.ok) {
    throw new Error(`${serviceName} notification failed with HTTP ${response.status}.`);
  }

  return response.json();
}
