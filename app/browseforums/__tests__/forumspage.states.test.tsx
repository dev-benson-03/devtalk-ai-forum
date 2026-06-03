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

describe("ForumsPage States", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Loading State", () => {
    it("displays spinner and loading text when loading", () => {
      mockUseForums.mockReturnValue({
        forums: [],
        loading: true,
        error: null,
      });

      renderWithRouter(<ForumsPage />);

      expect(screen.getByText("Loading forums...")).toBeInTheDocument();
      // Check for spinner element (div with animate-spin class)
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it("shows only loading content when in loading state", () => {
      mockUseForums.mockReturnValue({
        forums: [],
        loading: true,
        error: null,
      });

      renderWithRouter(<ForumsPage />);

      expect(screen.getByText("Loading forums...")).toBeInTheDocument();
      expect(screen.queryByText("Discussion Forums")).not.toBeInTheDocument();
    });
  });

  describe("Error State", () => {
    it("displays error message and retry button when there is an error", () => {
      const errorMessage = "Failed to load forums";
      mockUseForums.mockReturnValue({
        forums: [],
        loading: false,
        error: errorMessage,
      });

      renderWithRouter(<ForumsPage />);

      expect(screen.getByText(errorMessage)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    it("shows only error content when in error state", () => {
      mockUseForums.mockReturnValue({
        forums: [],
        loading: false,
        error: "Some error",
      });

      renderWithRouter(<ForumsPage />);

      expect(screen.getByText("Some error")).toBeInTheDocument();
      expect(screen.queryByText("Discussion Forums")).not.toBeInTheDocument();
    });
  });

  describe("Empty State", () => {
    it("shows 'No forums yet' message with create forum link when forums array is empty", () => {
      mockUseForums.mockReturnValue({
        forums: [],
        loading: false,
        error: null,
      });

      renderWithRouter(<ForumsPage />);

      expect(screen.getByText("No forums found")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /create your first forum/i })).toBeInTheDocument();
    });

    it("create forum link in empty state has correct href", () => {
      mockUseForums.mockReturnValue({
        forums: [],
        loading: false,
        error: null,
      });

      renderWithRouter(<ForumsPage />);

      const createLink = screen.getByRole("link", { name: /create your first forum/i });
      expect(createLink).toHaveAttribute("href", "/create-forum");
    });
  });

  describe("Forums List", () => {
    it("renders forums with open status", () => {
      mockUseForums.mockReturnValue({
        forums: [
          { id: "1", title: "Forum 1", status: "Open" },
          { id: "2", title: "Forum 2", status: "Closed" },
        ],
        loading: false,
        error: null,
      });

      renderWithRouter(<ForumsPage />);

      // Check that at least one 'Open' status is present
      const openElements = screen.getAllByText("Open");
      expect(openElements.length).toBeGreaterThan(0);
    });
  });
});
