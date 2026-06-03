/**
 * services/ModerationService.ts
 * Handles content moderation and filtering for the messaging system.
 */

export interface ModerationResult {
  isApproved: boolean;
  flaggedWords: string[];
  severity: 'low' | 'medium' | 'high';
  suggestedAction: 'approve' | 'review' | 'reject';
}

export class ModerationService {
  /**
   * Provides content moderation functionality for messages.
   */
  private baseUrl: string;
  private bannedWords: string[];

  constructor(baseUrl: string = '/api/moderation') {
    this.baseUrl = baseUrl;
    this.bannedWords = []; // Will be loaded from API or config
  }

  /**
   * Check if message content passes moderation rules.
   */
  async checkContent(content: string): Promise<ModerationResult> {
    // Placeholder for API call to moderation service
    const response = await fetch(`${this.baseUrl}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      throw new Error('Failed to check content moderation');
    }

    return await response.json();
  }

  /**
   * Apply content filtering to a message (client-side preview).
   */
  filterMessage(message: string): string {
    let filteredMessage = message;
    
    // Simple client-side filtering (replace with actual moderation logic)
    this.bannedWords.forEach(word => {
      const regex = new RegExp(word, 'gi');
      filteredMessage = filteredMessage.replace(regex, '*'.repeat(word.length));
    });

    return filteredMessage;
  }

  /**
   * Load banned words list from server.
   */
  async loadBannedWords(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/banned-words`);
      if (response.ok) {
        this.bannedWords = await response.json();
      }
    } catch (error) {
      console.warn('Failed to load banned words list:', error);
    }
  }

  /**
   * Quick client-side validation before sending to server.
   */
  quickValidation(content: string): boolean {
    // Basic validation - not empty, reasonable length
    return content.trim().length > 0 && content.length <= 5000;
  }
}
