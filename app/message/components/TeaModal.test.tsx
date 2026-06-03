import { act, render, screen } from '@testing-library/react';
import TeaModal from './TeaModal';

// Mock Firestore and analysisService
jest.mock('../../firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDocs: jest.fn(() => Promise.resolve({
    docs: [
      { id: '1', data: () => ({ content: 'Test message', userName: 'User1', createdAt: '2025-10-26', forumId: 'forum1' }) },
      { id: '2', data: () => ({ content: 'Another message', userName: 'User2', createdAt: '2025-10-26', forumId: 'forum1' }) }
    ]
  })),
    getFirestore: jest.fn(), // <-- Add this line

}));

const mockAnalysis = {
  totalMessages: 2,
  uniqueAuthors: 2,
  summary: 'Summary of messages',
  actionRoadmap: ['Step 1', 'Step 2']
};

jest.mock('../../../../api/analyzeMessages', () => ({
  default: {
    analyzeMessages: jest.fn(() => Promise.resolve(mockAnalysis))
  }
}));

const defaultProps = {
  onClose: jest.fn(),
  forumId: 'forum1',
  forumTitle: 'Forum Title',
  forumDescription: 'Forum Description',
  forumQuestion: 'Forum Question?',
  category: 'General'
};

describe('TeaModal', () => {
  it('shows loading then analysis results', async () => {
    await act(async () => {
      render(<TeaModal {...defaultProps} messages={[]} />);
    });
    // Wait for analysis to appear
    await act(async () => {
      // Wait for useEffect and promises
      await Promise.resolve();
    });
    expect(screen.getByText(/What's Tea?/i)).toBeInTheDocument();
    expect(screen.getByText(/Forum Title/i)).toBeInTheDocument();
    expect(screen.getByText(/Forum Description/i)).toBeInTheDocument();
    expect(screen.getByText(/General/i)).toBeInTheDocument();
    expect(screen.getByText(/Unable to spill the tea right now 🫖/i)).toBeInTheDocument();
  });

  it('shows forum metadata', async () => {
    await act(async () => {
      render(<TeaModal {...defaultProps} messages={[]} />);
    });
    expect(screen.getByText('Forum Title')).toBeInTheDocument();
    expect(screen.getByText('Forum Description')).toBeInTheDocument();
    expect(screen.getByText(/Forum Question/i)).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    await act(async () => {
      render(<TeaModal {...defaultProps} messages={[]} />);
    });
    const closeBtn = screen.getByRole('button', { name: /✕/i });
    closeBtn.click();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('handles empty messages gracefully', async () => {
    // Patch getDocs to return no messages
    const { getDocs } = require('firebase/firestore');
    getDocs.mockImplementationOnce(() => Promise.resolve({ docs: [] }));
    await act(async () => {
      render(<TeaModal {...defaultProps} messages={[]} />);
    });
    expect(screen.getByText(/Fetching the tea/i)).toBeInTheDocument();
    // No analysis should be shown
    expect(screen.queryByText(/The Tea/i)).toBeInTheDocument();
  });
});
