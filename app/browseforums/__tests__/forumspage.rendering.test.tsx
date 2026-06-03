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

describe("ForumsPage Rendering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders without crashing", () => {
    mockUseForums.mockReturnValue({
      forums: [],
      loading: false,
      error: null,
    });

    expect(() => renderWithRouter(<ForumsPage />)).not.toThrow();
  });

  it("renders the main page structure when forums are available", () => {
    const mockForums = [
      {
        id: "1",
        title: "Test Forum",
        description: "Test Description",
        creatorName: "John Doe",
        createdAt: { toDate: () => new Date("2023-01-01") },
        upvotes: 5,
        downvotes: 1,
        commentCount: 3,
      },
    ];

    mockUseForums.mockReturnValue({
      forums: mockForums,
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    expect(screen.getByText("Discussion Forums")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("renders all major components", () => {
    mockUseForums.mockReturnValue({
      forums: [],
      loading: false,
      error: null,
    });

    renderWithRouter(<ForumsPage />);

    // Check for navbar (navigation role)
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    
    // Check for main content
    expect(screen.getByRole("main")).toBeInTheDocument();
    
    // Check for page title
    expect(screen.getByText("Discussion Forums")).toBeInTheDocument();
    
    // Check for Create Forum buttons (there should be multiple)
    const createForumLinks = screen.getAllByRole("link", { name: /create forum/i });
    expect(createForumLinks.length).toBeGreaterThanOrEqual(1); // At least navbar + page header
  });
});
