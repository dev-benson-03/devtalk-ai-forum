import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { UserDashboardPage } from '../UserDashboard';

// Mock Firebase and window.location
jest.mock('~/components/footer/footer', () => ({
  Footer: () => <div>2025 DevTalk.</div>
}));
jest.mock('~/components/navbar/navbar', () => ({
  NavBar: () => <nav>Mock NavBar</nav>
}));
const mockSetItem = jest.fn();
Object.defineProperty(window, 'sessionStorage', {
  value: { setItem: mockSetItem, getItem: jest.fn(() => 'user') },
  writable: true,
});

const mockSignOut = jest.fn();
jest.mock('firebase/auth', () => ({
  signOut: (...args: any) => mockSignOut(...args),
  onAuthStateChanged: jest.fn(() => () => {}),
  getAuth: jest.fn(() => ({})),
}));


describe('UserDashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignOut.mockClear();
  });

  beforeAll(() => {
  // @ts-ignore
  delete window.location;
  // @ts-ignore
  window.location = { href: '', assign: jest.fn(url => { window.location.href = url; }) };
});

  test('toggles anonymous mode', () => {
    render(<UserDashboardPage />);
    // Simulate toggle button click
    const toggleButton = screen.getByRole('button', { name: /Go Anonymous/i });
    fireEvent.click(toggleButton);
    expect(mockSetItem).toHaveBeenCalledWith('anonymous', 'false');
  });

  test('toggles anonymous mode ON', () => {
    // Simulate anonymous toggle ON
    render(<UserDashboardPage />);
    const toggleButton = screen.getByRole('button', { name: /Go Anonymous/i });
    fireEvent.click(toggleButton);
    // Simulate second click to toggle ON
    fireEvent.click(toggleButton);
    expect(mockSetItem).toHaveBeenCalledWith('anonymous', 'false');
  });

  test('sets role from session storage', () => {
    render(<UserDashboardPage />);
    expect(window.sessionStorage.getItem).toHaveBeenCalledWith('role');
  });

  test('renders dashboard and navigation', () => {
    render(<UserDashboardPage />);
    expect(screen.getByText(/user settings/i)).toBeInTheDocument();
    expect(screen.getByText(/log out/i)).toBeInTheDocument();
  });

  test('renders footer', () => {
    render(<UserDashboardPage />);
    expect(screen.getByText(/2025 DevTalk./i)).toBeInTheDocument();
  });
});
