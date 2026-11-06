/**
 * services/AnalysisService.ts
 * Handles frontend calls to secure OpenAI analysis API
 */

import type { User } from 'firebase/auth';
import { firebaseAuth } from '../../firebase/config';

export interface MessageAnalysisResponse {
  totalMessages: number;
  uniqueAuthors: number;
  summary: string;
  actionRoadmap: string[];
}

export type AnalysisAuthReason = 'signed_out' | 'token_unavailable' | 'unauthorized';

/** The analysis call failed for an authentication reason. Never carries a token. */
export class AnalysisAuthError extends Error {
  constructor(readonly reason: AnalysisAuthReason) {
    super(`Analysis authentication failed: ${reason}`);
    this.name = 'AnalysisAuthError';
  }
}

/** Resolves the signed-in user once Firebase has restored the session. */
async function currentFirebaseUser(): Promise<User | null> {
  await firebaseAuth.authStateReady();
  return firebaseAuth.currentUser;
}

export class AnalysisService {
  constructor(private readonly getUser: () => Promise<User | null> = currentFirebaseUser) {}

  /** Returns a Bearer header value; the token itself is never logged or stored. */
  private async bearer(forceRefresh: boolean): Promise<string> {
    const user = await this.getUser();
    if (!user) throw new AnalysisAuthError('signed_out');
    try {
      return `Bearer ${await user.getIdToken(forceRefresh)}`;
    } catch {
      throw new AnalysisAuthError('token_unavailable');
    }
  }

  /**
   * Asks the server to analyze a forum. The server loads the forum and its
   * comments itself, so only the forum ID is sent.
   * Sends the user's Firebase ID token. On a 401 it retries once with a
   * freshly minted token, then throws AnalysisAuthError('unauthorized').
   */
  async analyzeMessages(payload: {
    forumId: string;
    /** Skip the cache; the server allows this for the forum creator or an admin only. */
    forceRegenerate?: boolean;
  }): Promise<MessageAnalysisResponse> {
    const send = async (forceRefresh: boolean) =>
      fetch('/api/analyzeMessages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await this.bearer(forceRefresh),
        },
        body: JSON.stringify(payload),
      });

    let response = await send(false);
    if (response.status === 401) response = await send(true);
    if (response.status === 401) throw new AnalysisAuthError('unauthorized');

    if (!response.ok) {
      // Status only (e.g. 403, 404, 422, 503) for diagnostics; no response body
      throw Object.assign(new Error('Failed to analyze messages'), { status: response.status });
    }

    return await response.json();
  }
}
