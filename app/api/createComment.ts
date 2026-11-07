/**
 * POST /api/comments: publishes a comment after authentication, validation,
 * forum checks and Safe-for-Work moderation (see publish.server.ts).
 * Body: { forumId, content, anonymous, requestId }
 */
import { handlePublish } from "./publish-route.server";

export async function action({ request }: { request: Request }): Promise<Response> {
  return handlePublish("comment", request);
}
