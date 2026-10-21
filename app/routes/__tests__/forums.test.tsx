import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Forums from '../forums';

// Avoid opening a real Firestore listener, which crashes Jest under jsdom
jest.mock('../../hooks/useFirestore', () => ({
  useForums: () => ({ forums: [], loading: false, error: null }),
}));

describe('Forums route', () => {
  it('renders without crashing', () => {
    render(<MemoryRouter><Forums /></MemoryRouter>);
  });
});
