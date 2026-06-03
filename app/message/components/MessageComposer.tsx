/**
 * components/MessageComposer.tsx
 * Form component for creating new messages.
 */

import React, { useState } from 'react';
import type { CreateMessageRequest } from '../services/MessageService';
import { MessageService } from '../services/MessageService';
import { ModerationService } from '../services/ModerationService';

interface MessageComposerProps {
  onMessageCreated?: (message: any) => void;
  placeholder?: string;
  className?: string;
}

export const MessageComposer: React.FC<MessageComposerProps> = ({
  onMessageCreated,
  placeholder = "What's on your mind?",
  className = ''
}) => {
  const [content, setContent] = useState('');
  const [author, setAuthor] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageService = React.useMemo(() => new MessageService(), []);
  const moderationService = React.useMemo(() => new ModerationService(), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!content.trim() || !author.trim()) {
      setError('Please fill in all fields');
      return;
    }

    // Quick client-side validation
    if (!moderationService.quickValidation(content)) {
      setError('Message content is invalid');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Check content moderation
      const moderationResult = await moderationService.checkContent(content);
      
      if (!moderationResult.isApproved) {
        setError(`Message rejected: ${moderationResult.suggestedAction}`);
        setIsSubmitting(false);
        return;
      }

      // Create the message
      const messageData: CreateMessageRequest = {
        author: author.trim(),
        content: content.trim()
      };

      const newMessage = await messageService.createMessage(messageData);
      
      // Reset form
      setContent('');
      setAuthor('');
      onMessageCreated?.(newMessage);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create message');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    if (error) setError(null); // Clear error when user starts typing
  };

  const handleAuthorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAuthor(e.target.value);
    if (error) setError(null); // Clear error when user starts typing
  };

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-4 ${className}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Author Input */}
        <div>
          <label htmlFor="author" className="block text-sm font-medium text-gray-700 mb-1">
            Your Name
          </label>
          <input
            id="author"
            type="text"
            value={author}
            onChange={handleAuthorChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter your name"
            disabled={isSubmitting}
            required
          />
        </div>

        {/* Message Content */}
        <div>
          <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-1">
            Message
          </label>
          <textarea
            id="content"
            value={content}
            onChange={handleContentChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={placeholder}
            rows={4}
            disabled={isSubmitting}
            maxLength={5000}
            required
          />
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-500">
              {content.length}/5000 characters
            </span>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || !content.trim() || !author.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isSubmitting && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
            <span>{isSubmitting ? 'Posting...' : 'Post Message'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
