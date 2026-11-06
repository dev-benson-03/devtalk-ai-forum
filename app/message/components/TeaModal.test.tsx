import { act, render, screen } from '@testing-library/react';
import TeaModal from './TeaModal';

// TeaModal no longer reads Firestore; it only calls AnalysisService with the forum ID
const mockAnalyze = jest.fn();
jest.mock('../services/AnalysisService', () => ({
  AnalysisAuthError: jest.requireActual('../services/AnalysisService').AnalysisAuthError,
  AnalysisService: jest.fn().mockImplementation(() => ({
    analyzeMessages: (...args: unknown[]) => mockAnalyze(...args)
  }))
}));

const defaultProps = {
  onClose: jest.fn(),
  forumId: 'forum1',
  forumTitle: 'Forum Title',
  forumDescription: 'Forum Description',
  forumQuestion: 'Forum Question?',
  category: 'General'
};

const renderModal = async () => {
  await act(async () => {
    render(<TeaModal {...defaultProps} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

describe('TeaModal', () => {
  let info: jest.SpyInstance;

  beforeEach(() => {
    mockAnalyze.mockReset();
    mockAnalyze.mockRejectedValue(Object.assign(new Error('Failed to analyze messages'), { status: 500 }));
    info = jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => info.mockRestore());

  it('requests analysis with only the forum ID', async () => {
    await renderModal();
    expect(mockAnalyze).toHaveBeenCalledWith({ forumId: 'forum1' });
  });

  it('shows loading while the analysis is pending', async () => {
    mockAnalyze.mockReturnValue(new Promise(() => {}));
    await renderModal();
    expect(screen.getByText(/Fetching the tea/i)).toBeInTheDocument();
  });

  it('shows the analysis results', async () => {
    mockAnalyze.mockResolvedValue({
      totalMessages: 3,
      uniqueAuthors: 2,
      summary: 'Test summary',
      actionRoadmap: ['Step 1', 'Step 2', 'Step 3'],
    });
    await renderModal();
    expect(screen.getByText('3 messages • 2 authors')).toBeInTheDocument();
    expect(screen.getByText('Test summary')).toBeInTheDocument();
    expect(screen.getByText('Step 3')).toBeInTheDocument();
  });

  it('shows the error state when analysis fails', async () => {
    await renderModal();
    expect(screen.getByText(/What's Tea?/i)).toBeInTheDocument();
    expect(screen.getByText(/Unable to spill the tea right now 🫖/i)).toBeInTheDocument();
    expect(info).toHaveBeenCalledWith('[TeaModal] analysis', expect.objectContaining({ forumId: 'forum1', outcome: 'failed_500' }));
  });

  it('shows forum metadata', async () => {
    await renderModal();
    expect(screen.getByText('Forum Title')).toBeInTheDocument();
    expect(screen.getByText('Forum Description')).toBeInTheDocument();
    expect(screen.getByText(/Forum Question/i)).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    await renderModal();
    screen.getByRole('button', { name: /✕/i }).click();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('asks the user to sign in again when analysis auth fails', async () => {
    const { AnalysisAuthError } = jest.requireActual('../services/AnalysisService');
    mockAnalyze.mockRejectedValue(new AnalysisAuthError('unauthorized'));
    await renderModal();
    expect(screen.getByText(/Please sign in again to spill the tea/i)).toBeInTheDocument();
    expect(info).toHaveBeenCalledWith('[TeaModal] analysis', expect.objectContaining({ outcome: 'auth_unauthorized' }));
  });

  it('logs only content-free diagnostics', async () => {
    mockAnalyze.mockResolvedValue({ totalMessages: 1, uniqueAuthors: 1, summary: 'PRIVATE SUMMARY', actionRoadmap: [] });
    await renderModal();
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('PRIVATE SUMMARY');
    expect(Object.keys(info.mock.calls[0][1]).sort()).toEqual(['elapsedMs', 'forumId', 'outcome']);
  });
});
