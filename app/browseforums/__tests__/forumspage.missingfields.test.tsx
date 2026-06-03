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

describe("ForumsPage Missing Fields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles forums with missing optional fields gracefully", () => {
    const forumWithMissingFields = {
      id: "1",
      title: "Forum with Missing Fields",
      description: "This forum has some missing optional fields",
      creatorName: "Test User",
      createdAt: { toDate: () => new Date("2023-01-01") },
      // Missing upvotes, downvotes, commentCount, tags, endTime
    };

    mockUseForums.mockReturnValue({
      forums: [forumWithMissingFields],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    expect(screen.getByText("Forum with Missing Fields")).toBeInTheDocument();
    expect(screen.getByText("This forum has some missing optional fields")).toBeInTheDocument();
    
    // Should display default values for missing fields
    expect(screen.getByText("0 responses")).toBeInTheDocument();
    expect(screen.getByText("↑ 0")).toBeInTheDocument();
    expect(screen.getByText("↓ 0")).toBeInTheDocument();
    
    // Should show Open status when no endTime
    const openElements = screen.getAllByText("Open");
    expect(openElements.length).toBeGreaterThan(0);
  });

  it("handles forum with missing createdAt gracefully", () => {
    const forumWithoutCreatedAt = {
      id: "1",
      title: "No Creation Date",
      description: "This forum has no creation date",
      creatorName: "Test User",
      // Missing createdAt
      upvotes: 5,
      downvotes: 1,
      commentCount: 2,
    };

    mockUseForums.mockReturnValue({
      forums: [forumWithoutCreatedAt],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    expect(screen.getByText("No Creation Date")).toBeInTheDocument();
    expect(screen.getByText(/Unknown date/)).toBeInTheDocument();
  });

  it("handles forum with tags array", () => {
    const forumWithTags = {
      id: "1",
      title: "Forum with Tags",
      description: "This forum has tags",
      creatorName: "Test User",
      createdAt: { toDate: () => new Date("2023-01-01") },
      tags: ["javascript", "react", "programming"],
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
    };

    mockUseForums.mockReturnValue({
      forums: [forumWithTags],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    expect(screen.getByText("Forum with Tags")).toBeInTheDocument();
    // Should display the first tag
    expect(screen.getByText("javascript")).toBeInTheDocument();
  });

  it("handles forum with empty tags array", () => {
    const forumWithEmptyTags = {
      id: "1",
      title: "Forum with Empty Tags",
      description: "This forum has empty tags array",
      creatorName: "Test User",
      createdAt: { toDate: () => new Date("2023-01-01") },
      tags: [],
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
    };

    mockUseForums.mockReturnValue({
      forums: [forumWithEmptyTags],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    expect(screen.getByText("Forum with Empty Tags")).toBeInTheDocument();
    // Should not crash and should not display any tag badge
    expect(screen.queryByText("javascript")).not.toBeInTheDocument();
  });

  it("displays end time information when present", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);

    const forumWithEndTime = {
      id: "1",
      title: "Forum with End Time",
      description: "This forum has an end time",
      creatorName: "Test User",
      createdAt: { toDate: () => new Date() },
      endTime: { toDate: () => futureDate },
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
    };

    mockUseForums.mockReturnValue({
      forums: [forumWithEndTime],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    expect(screen.getByText("Forum with End Time")).toBeInTheDocument();
    expect(screen.getByText(/Closes on/)).toBeInTheDocument();
  });
});
