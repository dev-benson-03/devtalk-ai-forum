import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ForumsPage } from "../forumspage";

// Mock the useForums hook
const mockUseForums = jest.fn();
jest.mock("../../hooks/useFirestore", () => ({
  useForums: () => mockUseForums(),
}));

const renderWithRouter = (component: React.ReactElement) => {
  return render(<MemoryRouter>{component}</MemoryRouter>);
};

describe("ForumsPage Forum Display", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders forums list when data is available", () => {
    const mockForums = [
      {
        id: "1",
        title: "How to learn React",
        description: "Looking for the best resources to learn React",
        creatorName: "John Doe",
        createdAt: { toDate: () => new Date("2023-01-01") },
        upvotes: 5,
        downvotes: 1,
        commentCount: 3,
      },
      {
        id: "2",
        title: "Best AI tools for students",
        description: "What are the best AI tools that students can use?",
        creatorName: "Jane Smith",
        createdAt: { toDate: () => new Date("2023-01-02") },
        upvotes: 8,
        downvotes: 0,
        commentCount: 12,
      },
    ];

    mockUseForums.mockReturnValue({
      forums: mockForums,
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    expect(screen.getByText("How to learn React")).toBeInTheDocument();
    expect(screen.getByText("Best AI tools for students")).toBeInTheDocument();
    expect(screen.getByText("Looking for the best resources to learn React")).toBeInTheDocument();
  });

  it("displays correct forum information in cards", () => {
    const mockForum = {
      id: "1",
      title: "Test Forum Title",
      description: "Test forum description content",
      creatorName: "Test Creator",
      createdAt: { toDate: () => new Date("2023-01-01") },
      upvotes: 10,
      downvotes: 2,
      commentCount: 5,
    };

    mockUseForums.mockReturnValue({
      forums: [mockForum],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    expect(screen.getByText("Test Forum Title")).toBeInTheDocument();
    expect(screen.getByText("Test forum description content")).toBeInTheDocument();
    expect(screen.getByText(/By Test Creator/)).toBeInTheDocument();
    expect(screen.getByText("5 responses")).toBeInTheDocument();
    expect(screen.getByText("↑ 10")).toBeInTheDocument();
    expect(screen.getByText("↓ 2")).toBeInTheDocument();
  });

  it("shows forum status as 'Open' when no endTime is provided", () => {
    const mockForum = {
      id: "1",
      title: "Open Forum",
      description: "This forum has no end time",
      creatorName: "User",
      createdAt: { toDate: () => new Date() },
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
    };

    mockUseForums.mockReturnValue({
      forums: [mockForum],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    const openElements = screen.getAllByText("Open");
    expect(openElements.length).toBeGreaterThan(0);
  });

  it("shows forum status as 'Closed' when endTime is in the past", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1); // Yesterday

    const mockForum = {
      id: "1",
      title: "Closed Forum",
      description: "This forum is closed",
      creatorName: "User",
      createdAt: { toDate: () => new Date("2023-01-01") },
      endTime: { toDate: () => pastDate },
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
    };

    mockUseForums.mockReturnValue({
      forums: [mockForum],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    const closedElements = screen.getAllByText("Closed");
    expect(closedElements.length).toBeGreaterThan(0);
  });

  it("shows forum status as 'Open' when endTime is in the future", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1); // Tomorrow

    const mockForum = {
      id: "1",
      title: "Future Forum",
      description: "This forum is still open",
      creatorName: "User",
      createdAt: { toDate: () => new Date() },
      endTime: { toDate: () => futureDate },
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
    };

    mockUseForums.mockReturnValue({
      forums: [mockForum],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    const openElements = screen.getAllByText("Open");
    expect(openElements.length).toBeGreaterThan(0);
  });

  it("renders at least one forum status as 'Open'", () => {
    const mockForum1 = {
      id: "1",
      title: "Open Forum 1",
      description: "This forum is open",
      creatorName: "User1",
      createdAt: { toDate: () => new Date() },
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
    };

    const mockForum2 = {
      id: "2",
      title: "Closed Forum 1",
      description: "This forum is closed",
      creatorName: "User2",
      createdAt: { toDate: () => new Date("2023-01-01") },
      endTime: { toDate: () => new Date("2023-01-02") },
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
    };

    mockUseForums.mockReturnValue({
      forums: [mockForum1, mockForum2],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    const openElements = screen.getAllByText("Open");
    expect(openElements.length).toBeGreaterThan(0);
  });

  it("renders at least one forum status as 'Closed'", () => {
    const mockForum1 = {
      id: "1",
      title: "Open Forum 1",
      description: "This forum is open",
      creatorName: "User1",
      createdAt: { toDate: () => new Date() },
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
    };

    const mockForum2 = {
      id: "2",
      title: "Closed Forum 1",
      description: "This forum is closed",
      creatorName: "User2",
      createdAt: { toDate: () => new Date("2023-01-01") },
      endTime: { toDate: () => new Date("2023-01-02") },
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
    };

    mockUseForums.mockReturnValue({
      forums: [mockForum1, mockForum2],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    const closedElements = screen.getAllByText("Closed");
    expect(closedElements.length).toBeGreaterThan(0);
  });
});
