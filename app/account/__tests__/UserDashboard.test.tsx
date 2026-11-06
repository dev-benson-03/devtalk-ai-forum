import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
const mockGetIdTokenResult = jest.fn(async () => ({ claims: {} as Record<string, unknown> }));
let mockTokenListener: ((user: unknown) => void) | null = null;
jest.mock('firebase/auth', () => ({
  signOut: (...args: any) => mockSignOut(...args),
  onIdTokenChanged: jest.fn((_auth: unknown, listener: (user: unknown) => void) => {
    mockTokenListener = listener;
    return () => {};
  }),
  getIdTokenResult: (...args: any) => (mockGetIdTokenResult as any)(...args),
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

  test('never reads an admin role from session storage', () => {
    (window.sessionStorage.getItem as jest.Mock).mockImplementation((key: string) => (key === 'admin' ? 'true' : 'false'));
    render(<UserDashboardPage />);
    expect(window.sessionStorage.getItem).not.toHaveBeenCalledWith('role');
    expect(window.sessionStorage.getItem).not.toHaveBeenCalledWith('admin');
    expect(screen.getByText(/user view/i)).toBeInTheDocument();
    (window.sessionStorage.getItem as jest.Mock).mockImplementation(() => 'user');
  });

  test('shows the admin view only for a verified admin claim', async () => {
    mockGetIdTokenResult.mockResolvedValueOnce({ claims: { admin: true } });
    render(<UserDashboardPage />);
    await act(async () => {
      mockTokenListener?.({ uid: 'root' });
    });
    expect(screen.getByText(/admin view/i)).toBeInTheDocument();
  });

  test('drops the admin view when a refreshed token no longer has the claim', async () => {
    mockGetIdTokenResult.mockResolvedValueOnce({ claims: { admin: true } }).mockResolvedValueOnce({ claims: {} });
    render(<UserDashboardPage />);
    await act(async () => {
      mockTokenListener?.({ uid: 'root' });
    });
    expect(screen.getByText(/admin view/i)).toBeInTheDocument();
    await act(async () => {
      mockTokenListener?.({ uid: 'root' });
    });
    expect(screen.getByText(/user view/i)).toBeInTheDocument();
  });

  test('treats a token error or a non-boolean claim as not admin', async () => {
    mockGetIdTokenResult.mockRejectedValueOnce(new Error('revoked')).mockResolvedValueOnce({ claims: { admin: 'true' } });
    render(<UserDashboardPage />);
    await act(async () => {
      mockTokenListener?.({ uid: 'x' });
    });
    expect(screen.getByText(/user view/i)).toBeInTheDocument();
    await act(async () => {
      mockTokenListener?.({ uid: 'x' });
    });
    expect(screen.getByText(/user view/i)).toBeInTheDocument();
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
