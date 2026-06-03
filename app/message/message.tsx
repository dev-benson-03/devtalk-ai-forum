/**
 * message.tsx
 * Main messaging page component integrating all messaging functionality.
 */

import { useCallback, useState } from 'react';
import { MessageComposer } from './components/MessageComposer';
import { MessageList } from './components/MessageList';
import { Message } from './models/Message';
import type { MessageFilters } from './services/MessageService';

export default function MessagePage() {
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [filters, setFilters] = useState<MessageFilters>({});
  const [refreshKey, setRefreshKey] = useState(0);

  const handleMessageCreated = useCallback(() => {
    // Refresh the message list when a new message is created
    setRefreshKey(prev => prev + 1);
  }, []);

  const handleMessageSelect = useCallback((message: Message) => {
    setSelectedMessage(message);
  }, []);

  const handleFilterChange = useCallback((newFilters: MessageFilters) => {
    setFilters(newFilters);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Messages</h1>
          <p className="text-gray-600">Connect and communicate with your community</p>
        </div>

        {/* Message Composer */}
        <div className="mb-8">
          <MessageComposer 
            onMessageCreated={handleMessageCreated}
            placeholder="Share your thoughts with the community..."
          />
        </div>

        {/* Filter Controls */}
        <div className="mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-lg font-medium text-gray-900 mb-3">Filter Messages</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Author
                </label>
                <input
                  type="text"
                  placeholder="Filter by author..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onChange={(e) => handleFilterChange({ ...filters, author: e.target.value || undefined })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onChange={(e) => handleFilterChange({ ...filters, startDate: e.target.value || undefined })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Limit
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onChange={(e) => handleFilterChange({ ...filters, limit: parseInt(e.target.value) || undefined })}
                >
                  <option value="">All messages</option>
                  <option value="10">10 messages</option>
                  <option value="25">25 messages</option>
                  <option value="50">50 messages</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Messages List */}
        <div className="mb-8">
          <MessageList
            filters={filters}
            onMessageSelect={handleMessageSelect}
            key={refreshKey} // Force refresh when new message is created
          />
        </div>

        {/* Selected Message Detail (if any) */}
        {selectedMessage && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">Message Details</h3>
            <div className="space-y-3">
              <div>
                <span className="font-medium text-gray-700">Author:</span>
                <span className="ml-2 text-gray-900">{selectedMessage.author}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Posted:</span>
                <span className="ml-2 text-gray-900">{selectedMessage.getFormattedTime()}</span>
              </div>
              <div>
                <span className="font-medium text-gray-700">Content:</span>
                <p className="mt-1 text-gray-900 whitespace-pre-wrap">{selectedMessage.content}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700">Reactions:</span>
                <span className="ml-2 text-gray-900">{selectedMessage.reactions.length} reaction(s)</span>
              </div>
            </div>
            <button
              onClick={() => setSelectedMessage(null)}
              className="mt-4 px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
            >
              Close Details
            </button>
          </div>
        )}
      </div>
    </div>
  );
}