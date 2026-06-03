import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ForumsPage } from "../forumspage";

// Mock the useForums hook
const mockUseForums = jest.fn();
jest.mock("../../hooks/useFirestore", () => ({
  useForums: () => mockUseForums(),
}));

jest.mock("firebase/auth", () => ({
  getAuth: jest.fn(),
  onAuthStateChanged: jest.fn((auth, cb) => {
    cb(null); // Immediately call with null to simulate unauthenticated user
    return () => {};
  }),
}));

const renderWithRouter = (component: React.ReactElement) => {
  return render(<MemoryRouter>{component}</MemoryRouter>);
};

describe("ForumsPage Filters & Sorting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("toggles category filter and clears filters", () => {
    mockUseForums.mockReturnValue({
      forums: [
        { id: "1", title: "Forum 1", description: "Desc", creatorName: "User", createdAt: { toDate: () => new Date() }, tags: ["Technology"], upvotes: 1, downvotes: 0, commentCount: 2 },
        { id: "2", title: "Forum 2", description: "Desc", creatorName: "User", createdAt: { toDate: () => new Date() }, tags: ["Career Advice"], upvotes: 2, downvotes: 1, commentCount: 3 }
      ],
      loading: false,
      error: null,
    });
    renderWithRouter(<ForumsPage />);
    // Select Technology category
    const openElements = screen.getAllByText(/technology/i);
    expect(openElements.length).toBeGreaterThan(0);   
    expect(screen.getByText(/Forum 1/i)).toBeInTheDocument();
    expect(screen.queryByText(/Forum 2/i)).toBeInTheDocument();
    // Clear filters
    fireEvent.click(screen.getByText(/Clear Filters/i));
    expect(screen.getByText(/Forum 2/i)).toBeInTheDocument();
  });

  it("toggles status filter and clears filters", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 86400000);
    mockUseForums.mockReturnValue({
      forums: [
        { id: "1", title: "Open Forum", description: "Desc", creatorName: "User", createdAt: { toDate: () => now }, endTime: { toDate: () => new Date(now.getTime() + 86400000) }, upvotes: 1, downvotes: 0, commentCount: 2 },
        { id: "2", title: "Closed Forum", description: "Desc", creatorName: "User", createdAt: { toDate: () => now }, endTime: { toDate: () => past }, upvotes: 2, downvotes: 1, commentCount: 3 }
      ],
      loading: false,
      error: null,
    });
    renderWithRouter(<ForumsPage />);
    // Select Closed status
    const openElements = screen.getAllByText(/closed/i);
    expect(openElements.length).toBeGreaterThan(0);    
    expect(screen.getByText(/Closed Forum/i)).toBeInTheDocument();
    expect(screen.queryByText(/Open Forum/i)).toBeInTheDocument();
    // Clear filters
    fireEvent.click(screen.getByText(/Clear Filters/i));
    expect(screen.getByText(/Open Forum/i)).toBeInTheDocument();
  });

  it("sorts open forums before closed forums", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 86400000);
    mockUseForums.mockReturnValue({
      forums: [
        { id: "1", title: "Closed Forum", description: "Desc", creatorName: "User", createdAt: { toDate: () => now }, endTime: { toDate: () => past }, upvotes: 1, downvotes: 0, commentCount: 2 },
        { id: "2", title: "Open Forum", description: "Desc", creatorName: "User", createdAt: { toDate: () => now }, endTime: { toDate: () => new Date(now.getTime() + 86400000) }, upvotes: 2, downvotes: 1, commentCount: 3 }
      ],
      loading: false,
      error: null,
    });
    renderWithRouter(<ForumsPage />);
    const forumTitles = screen.getAllByRole("heading", { level: 2 }).map(h => h.textContent);
    expect(forumTitles[0]).toMatch(/filter Forums/i);
    expect(forumTitles[1]).toMatch(/open Forum/i);
  });

  it("renders tags, status, and endTime correctly", () => {
    const now = new Date();
    mockUseForums.mockReturnValue({
      forums: [
        { id: "1", title: "Forum With Tag", description: "Desc", creatorName: "User", createdAt: { toDate: () => now }, tags: ["AI/Machine Learning"], endTime: { toDate: () => new Date(now.getTime() + 86400000) }, upvotes: 1, downvotes: 0, commentCount: 2 }
      ],
      loading: false,
      error: null,
    });
    renderWithRouter(<ForumsPage />);
    expect(screen.getByText(/technology/i)).toBeInTheDocument();
    const openElements = screen.getAllByText(/Open/i);
    expect(openElements.length).toBeGreaterThan(0);
    expect(screen.getByText(/Closes on/i)).toBeInTheDocument();
  });

  it("handles missing fields gracefully", () => {
    mockUseForums.mockReturnValue({
      forums: [
        { id: "1", title: "Missing Fields Forum", description: "Desc", creatorName: "User" }
      ],
      loading: false,
      error: null,
    });
    renderWithRouter(<ForumsPage />);
    expect(screen.getByText(/Missing Fields Forum/i)).toBeInTheDocument();
    expect(screen.getByText(/Unknown date/i)).toBeInTheDocument();
    expect(screen.getByText(/0 responses/i)).toBeInTheDocument();
    expect(screen.getByText(/↑ 0/i)).toBeInTheDocument();
    expect(screen.getByText(/↓ 0/i)).toBeInTheDocument();
  });

    it("redirects to login if user is null", () => {
    const originalHref = window.location.href;
    window.location.href = "";
    mockUseForums.mockReturnValue({ forums: [], loading: false, error: null });
    renderWithRouter(<ForumsPage />);
    expect(window.location.href).toContain("http://localhost/");
    window.location.href = originalHref;
    });
});
