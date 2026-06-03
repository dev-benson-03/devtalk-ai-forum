/**
 * services/AnalysisService.ts
 * Handles frontend calls to secure OpenAI analysis API
 */

export interface MessageAnalysisResponse {
  totalMessages: number;
  uniqueAuthors: number;
  summary: string;
  actionRoadmap: string[];
}

export class AnalysisService {
  /**
   * Analyzes messages using the secure OpenAI API endpoint with forum context
   */
  async analyzeMessages(payload: {
    forumId: string;
    forumTitle: string;
    forumDescription?: string;
    forumQuestion?: string;
    category?: string;
    messages: any[];
  }): Promise<MessageAnalysisResponse> {
    const response = await fetch('/api/analyzeMessages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to analyze messages');
    }

    return await response.json();
  }
}
