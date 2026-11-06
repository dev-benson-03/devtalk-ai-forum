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

  it("sends only the form's fields to the server, never an author or server-controlled fields", async () => {
    mockCreateForum.mockResolvedValue("forum-id-123");
    
    render(<CreateForumPageWithRouter />);
    fillValidForm();
    
    const submitButton = screen.getByRole("button", { name: /create forum/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockCreateForum).toHaveBeenCalledWith({
        title: "Test Forum",
        description: "Test description",
        question: "Test question?",
        category: "Technology",
        timeLimitHours: 0.083,
        anonymous: true,
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
    });
  });

  it("keeps the draft and the same request ID after a moderation rejection, so a revision can be resubmitted", async () => {
    const { PublishError } = jest.requireActual("../publish-client");
    mockCreateForum.mockRejectedValueOnce(new PublishError("rejected", 422, "profanity", "title")).mockResolvedValueOnce("id");

    render(<CreateForumPageWithRouter />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /create forum/i }));

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith(
        "Your title doesn't meet DevTalk's community guidelines (strong profanity). Please revise it and try again."
      );
    });
    expect(screen.getByLabelText(/forum title/i)).toHaveValue("Test Forum");
    expect(screen.getByLabelText(/description/i)).toHaveValue("Test description");

    fireEvent.change(screen.getByLabelText(/forum title/i), { target: { value: "Revised" } });
    fireEvent.click(screen.getByRole("button", { name: /create forum/i }));
    await waitFor(() => expect(mockCreateForum).toHaveBeenCalledTimes(2));
    const [first, second] = mockCreateForum.mock.calls.map(([arg]) => arg);
    expect(second).toMatchObject({ title: "Revised", requestId: first.requestId });
  });

  it("explains a moderation outage and keeps the draft", async () => {
    const { PublishError } = jest.requireActual("../publish-client");
    mockCreateForum.mockRejectedValue(new PublishError("unavailable", 503, "moderation_unavailable"));

    render(<CreateForumPageWithRouter />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /create forum/i }));

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith(
        "Publishing is temporarily unavailable. Your draft is still here, so you can try again in a moment."
      );
    });
    expect(screen.getByLabelText(/main question/i)).toHaveValue("Test question?");
    expect(screen.getByRole("button", { name: /create forum/i })).toBeEnabled();
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
