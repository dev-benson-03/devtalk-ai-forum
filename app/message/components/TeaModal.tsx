/**
 * components/TeaModal.tsx
 * Modal popup for displaying AI analysis results in a chat-like interface
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../firebase/config';
import type { Message } from '../models/Message';
import { AnalysisService, type MessageAnalysisResponse } from '../services/AnalysisService';

interface TeaModalProps {
  onClose: () => void;
  messages: Message[];
  forumId: string;
  forumTitle: string;
  forumDescription?: string;
  forumQuestion?: string;
  category?: string;
}

const analysisService = new AnalysisService();

export default function TeaModal({ onClose, forumId, forumTitle, forumDescription, forumQuestion, category }: TeaModalProps) {
  const [analysis, setAnalysis] = useState<MessageAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const fetchMessages = async () => {
      console.log('[TeaModal] Fetching messages from Firestore for forum:', forumId);
      const q = query(collection(db, 'comments'), where('forumId', '==', forumId));
      const snapshot = await getDocs(q);
      const fetchedMessages = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          content: data.content,
          userName: data.userName,
          createdAt: data.createdAt,
          forumId: data.forumId,
          // Add other fields as needed from Message model
        };
      });
      console.log('[TeaModal] Number of messages fetched:', fetchedMessages.length);
      setMessages(fetchedMessages as unknown as Message[]);
    };
    fetchMessages();
  }, [forumId]);

  useEffect(() => {
    if (messages.length === 0) return;
    const fetchAnalysis = async () => {
      try {
        console.log('[TeaModal] Sending', messages.length, 'messages for analysis');
        console.log('[TeaModal] Analyzing forumId:', forumId);
        // Debug: Log what we're sending to the API
        console.log('TeaModal sending to API:', {
          forumId,
          forumTitle,
          forumDescription,
          forumQuestion,
          category,
          messages: messages.map(m => m)
        });
        const result = await analysisService.analyzeMessages({
          forumId,
          forumTitle,
          forumDescription,
          forumQuestion,
          category,
          messages
        });
        setAnalysis(result);
      } catch (error) {
        console.error('Analysis failed:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalysis();
  }, [messages, forumId, forumTitle, forumDescription, forumQuestion, category]);

  return (
    <div className="fixed inset-0 bg-blue-900 bg-opacity-50 flex items-center justify-center z-50 animate-fadeIn">
      <div className="relative bg-white rounded-lg shadow-lg w-full max-w-lg mx-4 sm:mx-auto max-h-[90vh] overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-gray-300">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
        >
          ✕
        </button>
        {/* Header */}
        <h2 className="text-xl font-semibold text-gray-900 mb-4 text-center">What's Tea?</h2>
        {/* Forum Metadata */}
        <div className="mb-4">
          <h3 className="text-lg font-bold text-blue-700 break-words">{forumTitle}</h3>
          {forumDescription && (
            <p className="text-gray-700 text-sm mb-1 break-words">{forumDescription}</p>
          )}
          {forumQuestion && (
            <p className="text-blue-800 text-sm italic mb-1 break-words">Q: {forumQuestion}</p>
          )}
          {category && (
            <span className="inline-block bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs">{category}</span>
          )}
        </div>
        {/* Body Content */}
        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              <p className="text-gray-600">Fetching the tea...</p>
            </div>
          ) : analysis ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">{analysis.totalMessages} messages • {analysis.uniqueAuthors} authors</p>
              
              {/* Summary */}
              <div className="bg-blue-50 p-3 rounded-lg">
                <h3 className="font-medium text-blue-900 mb-2">The Tea ☕</h3>
                <p className="text-blue-800">{analysis.summary}</p>
              </div>
              
              {/* Action Roadmap */}
              <div className="bg-green-50 p-3 rounded-lg">
                <h3 className="font-medium text-green-900 mb-2">Action Plan 🚀</h3>
                <div className="space-y-1">
                  {analysis.actionRoadmap.map((step, index) => (
                    <p key={index} className="text-green-800 text-sm">{step}</p>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-red-600">Unable to spill the tea right now 🫖</p>
          )}
        </div>
      </div>
    </div>
  );
}
