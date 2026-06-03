import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import CreateForumPage from "../create-forum";

// Mock the useFirestore hook
const mockCreateForum = jest.fn();
jest.mock("../../hooks/useFirestore", () => ({
  useFirestore: () => ({
    createForum: mockCreateForum,
  }),
}));

// Mock alert
global.alert = jest.fn();

// Wrapper component to provide Router context
const CreateForumPageWithRouter = () => (
  <MemoryRouter>
    <CreateForumPage />
  </MemoryRouter>
);

describe("CreateForumPage - Form Submission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper function to fill valid form data
  const fillValidForm = () => {
    fireEvent.change(screen.getByLabelText(/forum title/i), { 
      target: { value: "Test Forum" } 
    });
    fireEvent.change(screen.getByLabelText(/description/i), { 
      target: { value: "Test description" } 
    });
    fireEvent.change(screen.getByLabelText(/main question/i), { 
      target: { value: "Test question?" } 
    });
    fireEvent.change(screen.getByLabelText(/category/i), { 
      target: { value: "Technology" } 
    });
  };

  it("prevents submission when required fields are empty", () => {
    render(<CreateForumPageWithRouter />);
    const submitButton = screen.getByRole("button", { name: /create forum/i });
    
    fireEvent.click(submitButton);
    
    // Check that createForum was not called
    expect(mockCreateForum).not.toHaveBeenCalled();
  });

  it("calls createForum with correct data structure on successful submission", async () => {
    mockCreateForum.mockResolvedValue("forum-id-123");
    
    render(<CreateForumPageWithRouter />);
    fillValidForm();
    
    const submitButton = screen.getByRole("button", { name: /create forum/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockCreateForum).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Test Forum",
          description: "Test description",
          question: "Test question?",
          creatorId: "anonymous",
          creatorName: "Anonymous User",
          isActive: true,
          isAdminDeleted: false,
          tags: ["Technology"]
        })
      );
    });
  });

  it("shows loading state during submission", async () => {
    mockCreateForum.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
    
    render(<CreateForumPageWithRouter />);
    fillValidForm();
    
    const submitButton = screen.getByRole("button", { name: /create forum/i });
    fireEvent.click(submitButton);

    expect(screen.getByText("Creating...")).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
  });

  it("successfully submits the form", async () => {
    mockCreateForum.mockResolvedValue("forum-id-123");
    
    render(<CreateForumPageWithRouter />);
    fillValidForm();
    
    const submitButton = screen.getByRole("button", { name: /create forum/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockCreateForum).toHaveBeenCalled();
    });
  });

  it("shows error alert on failed submission", async () => {
    mockCreateForum.mockRejectedValue(new Error("Creation failed"));
    
    render(<CreateForumPageWithRouter />);
    fillValidForm();
    
    const submitButton = screen.getByRole("button", { name: /create forum/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith("Failed to create forum. Please try again.");
    });
  });
});
