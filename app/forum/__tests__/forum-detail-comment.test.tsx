import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import ForumDetailPage from "../forum-detail";
import { PublishError } from "../publish-client";

jest.mock("../../components/navbar/navbar", () => ({ NavBar: () => <nav /> }));
jest.mock("../../components/footer/footer", () => ({ Footer: () => <footer /> }));
jest.mock("../../message/components/TeaModal", () => () => null);
jest.mock("firebase/auth", () => ({
  ...jest.requireActual("firebase/auth"),
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: "dana", displayName: "Dana" });
    return () => {};
  },
}));

const mockCreateComment = jest.fn();
jest.mock("../../hooks/useFirestore", () => ({
  useFirestore: () => ({ createComment: mockCreateComment }),
  useComments: () => ({ comments: [], loading: false, error: null }),
  useForum: () => ({
    forum: {
      id: "f1",
      title: "Forum",
      description: "D",
      question: "Q",
      creatorName: "Owner",
      tags: [],
      endTime: { toDate: () => new Date(Date.now() + 3_600_000) },
    },
    loading: false,
    error: null,
  }),
}));

global.alert = jest.fn();

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/forum/f1"]}>
      <Routes>
        <Route path="/forum/:forumId" element={<ForumDetailPage />} />
      </Routes>
    </MemoryRouter>
  );

const box = () => screen.getByPlaceholderText(/write your message/i);
const send = (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /send message/i }));
};

describe("ForumDetailPage comment publishing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("sends the message, the anonymous preference and a request ID, but no author fields", async () => {
    window.sessionStorage.setItem("anonymous", "false");
    mockCreateComment.mockResolvedValue("c1");
    renderPage();
    send("  Hello there  ");
    await waitFor(() => expect(box()).toHaveValue(""));
    expect(mockCreateComment).toHaveBeenCalledWith({
      forumId: "f1",
      content: "Hello there",
      anonymous: false,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("keeps the draft on a moderation rejection and shows the reason", async () => {
    mockCreateComment.mockRejectedValue(new PublishError("rejected", 422, "hate_harassment", "content"));
    renderPage();
    send("A draft to revise");
    await waitFor(() =>
      expect(global.alert).toHaveBeenCalledWith(
        "Your message doesn't meet DevTalk's community guidelines (hate or harassment). Please revise it and try again."
      )
    );
    expect(box()).toHaveValue("A draft to revise");
    expect(screen.getByRole("button", { name: /send message/i })).toBeEnabled();
  });

  it("keeps the draft and the request ID when publishing is unavailable, then uses a new ID after success", async () => {
    mockCreateComment.mockRejectedValueOnce(new PublishError("unavailable", 503)).mockResolvedValue("c1");
    renderPage();
    send("Retry me");
    await waitFor(() => expect(global.alert).toHaveBeenCalledWith(expect.stringMatching(/temporarily unavailable/)));
    expect(box()).toHaveValue("Retry me");

    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    await waitFor(() => expect(box()).toHaveValue(""));
    send("Next message");
    await waitFor(() => expect(mockCreateComment).toHaveBeenCalledTimes(3));
    const ids = mockCreateComment.mock.calls.map(([arg]) => arg.requestId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("starts a new request ID after the server reports the old one was used for different content", async () => {
    mockCreateComment.mockRejectedValueOnce(new PublishError("failed", 409, "request_reused")).mockResolvedValue("c2");
    renderPage();
    send("Edited after a lost response");
    await waitFor(() => expect(global.alert).toHaveBeenCalledWith("Failed to post message. Please try again."));
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    await waitFor(() => expect(mockCreateComment).toHaveBeenCalledTimes(2));
    const [first, second] = mockCreateComment.mock.calls.map(([arg]) => arg.requestId);
    expect(second).not.toBe(first);
  });

  it("tells the user when the forum closed in the meantime", async () => {
    mockCreateComment.mockRejectedValue(new PublishError("closed", 409, "forum_closed"));
    renderPage();
    send("Late reply");
    await waitFor(() =>
      expect(global.alert).toHaveBeenCalledWith("This forum has closed and no longer accepts new messages.")
    );
    expect(box()).toHaveValue("Late reply");
  });
});
