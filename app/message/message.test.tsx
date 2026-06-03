import { fireEvent, render } from '@testing-library/react';
import MessagePage from './message';

jest.mock('./components/MessageComposer', () => ({
  MessageComposer: ({ onMessageCreated }: any) => (
    <button data-testid="composer" onClick={onMessageCreated}>Compose</button>
  )
}));
jest.mock('./components/MessageList', () => ({
  MessageList: ({ onMessageSelect }: any) => (
    <button data-testid="list" onClick={() => onMessageSelect({
      author: 'Test',
      getFormattedTime: () => 'now',
      content: 'Hello',
      reactions: []
    })}>Select Message</button>
  )
}));

describe('MessagePage', () => {
  it('renders without crashing', () => {
    render(<MessagePage />);
  });

  it('handles message creation and refresh', () => {
    const { getByTestId } = render(<MessagePage />);
    fireEvent.click(getByTestId('composer'));
  });

  it('handles message selection and detail view', () => {
    const { getByTestId, getByText } = render(<MessagePage />);
    fireEvent.click(getByTestId('list'));
    expect(getByText('Message Details')).toBeInTheDocument();
    expect(getByText('Test')).toBeInTheDocument();
    expect(getByText('Hello')).toBeInTheDocument();
    expect(getByText('now')).toBeInTheDocument();
    fireEvent.click(getByText('Close Details'));
  });
});
