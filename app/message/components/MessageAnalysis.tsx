/**
 * components/MessageAnalysis.tsx
 * Displays OpenAI analysis results in a clean format
 */

import React from 'react';
import type { MessageAnalysisResponse } from '../services/AnalysisService';

interface MessageAnalysisProps {
  analysis: MessageAnalysisResponse;
}

export const MessageAnalysis: React.FC<MessageAnalysisProps> = ({ analysis }) => {
  return (
    <div className="analysis-results">
      <h3>💡 Message Analysis Results</h3>
      <div className="analysis-summary">
        <p><strong>Total Messages:</strong> {analysis.totalMessages}</p>
        <div className="top-phrases">
          <h4>🔍 Top Discussion Topics:</h4>
          <ul>
            {analysis.topPhrases.map((phrase, index) => (
              <li key={index}>• {phrase}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
