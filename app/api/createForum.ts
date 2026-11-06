/**
 * POST /api/forums: publishes a new forum after authentication, validation
 * and Safe-for-Work moderation (see publish.server.ts).
 * Body: { title, description, question, category, timeLimitHours, anonymous, requestId }
 */
import { handlePublish } from "./publish-route.server";

export async function action({ request }: { request: Request }): Promise<Response> {
  return handlePublish("forum", request);
}
