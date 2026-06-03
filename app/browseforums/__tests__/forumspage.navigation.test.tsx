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

describe("ForumsPage Navigation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("Create Forum button in header links to create page", () => {
    mockUseForums.mockReturnValue({
      forums: [],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    // Get all Create Forum buttons and verify at least one exists
    const createForumButtons = screen.getAllByRole("link", { name: /create forum/i });
    expect(createForumButtons.length).toBeGreaterThanOrEqual(1); // navbar + page header
    
    // Verify they all have the correct href
    createForumButtons.forEach(button => {
      expect(button).toHaveAttribute("href", "/create-forum");
    });
  });

  it("links to individual forums work correctly", () => {
    const mockForum = {
      id: "test-forum-id",
      title: "Test Forum",
      description: "Test Description",
      creatorName: "John Doe",
      createdAt: { toDate: () => new Date("2023-01-01") },
      upvotes: 5,
      downvotes: 1,
      commentCount: 3,
    };

    mockUseForums.mockReturnValue({
      forums: [mockForum],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    const forumLink = screen.getByRole("link", { name: /test forum/i });
    expect(forumLink).toBeInTheDocument();
    expect(forumLink).toHaveAttribute("href", "/forum/test-forum-id");
  });

  it("empty state create forum link has correct href", () => {
    mockUseForums.mockReturnValue({
      forums: [],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    const emptyStateLink = screen.getByRole("link", { name: /create your first forum/i });
    expect(emptyStateLink).toHaveAttribute("href", "/create-forum");
  });

  it("all forum cards are clickable links", () => {
    const mockForums = [
      {
        id: "1",
        title: "Forum One",
        description: "Description One",
        creatorName: "User One",
        createdAt: { toDate: () => new Date() },
        upvotes: 0,
        downvotes: 0,
        commentCount: 0,
      },
      {
        id: "2",
        title: "Forum Two",
        description: "Description Two",
        creatorName: "User Two",
        createdAt: { toDate: () => new Date() },
        upvotes: 0,
        downvotes: 0,
        commentCount: 0,
      },
    ];

    mockUseForums.mockReturnValue({
      forums: mockForums,
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    const forumLinks = screen.getAllByRole("link");
    // Should have at least the forum links plus the Create Forum link
    const forumSpecificLinks = forumLinks.filter(link => 
      link.getAttribute("href")?.includes("/forum/")
    );
    
    expect(forumSpecificLinks).toHaveLength(2);
    expect(forumSpecificLinks[0]).toHaveAttribute("href", "/forum/1");
    expect(forumSpecificLinks[1]).toHaveAttribute("href", "/forum/2");
  });
});
