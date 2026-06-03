/**
 * models/Message.ts
 * Defines the Message data model used in the messaging system.
 */

export interface MessageData {
  id: number;
  author: string;
  content: string;
  timestamp: string;
  forumId?: number;
  forumTitle?: string;
  reactions?: ReactionData[];
}

export interface ReactionData {
  id: number;
  userId: number;
  messageId: number;
  type: string;
  timestamp: string;
}

export class Message {
  /**
   * Represents a user-submitted message in the system.
   */
  public id: number;
  public author: string;
  public content: string;
  public timestamp: string;
  public forumId?: number;
  public forumTitle?: string;
  public reactions: ReactionData[];

  constructor(data: MessageData) {
    this.id = data.id;
    this.author = data.author;
    this.content = data.content;
    this.timestamp = data.timestamp;
    this.forumId = data.forumId;
    this.forumTitle = data.forumTitle;
    this.reactions = data.reactions || [];
  }

  /**
   * Return a plain object representation of the message.
   */
  toObject(): MessageData {
    return {
      id: this.id,
      author: this.author,
      content: this.content,
      timestamp: this.timestamp,
      forumId: this.forumId,
      forumTitle: this.forumTitle,
      reactions: this.reactions
    };
  }

  /**
   * Check if the message content is valid.
   */
  isValid(): boolean {
    // Placeholder for validation logic
    return this.content.trim().length > 0;
  }

  /**
   * Get formatted timestamp for display
   */
  getFormattedTime(): string {
    return new Date(this.timestamp).toLocaleString();
  }
}
