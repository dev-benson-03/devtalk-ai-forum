/**
 * The forum page's posting controls follow the server's comment rule
 * (forumGate → acceptsComments in app/api/publish.server.ts), separately from
 * who may view the forum. A creator or admin can view a hidden or deleted
 * forum but can't post there. The clock is fixed; nothing talks to Firebase.
 */
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { MemoryRouter, Route, Routes } from "react-router";
import ForumDetailPage from "../forum-detail";
import { PublishError, SUPPORT_MESSAGE } from "../publish-client";

jest.mock("../../components/navbar/navbar", () => ({ NavBar: () => <nav /> }));
jest.mock("../../components/footer/footer", () => ({ Footer: () => <footer /> }));
jest.mock("../../message/components/TeaModal", () => () => <div>Tea modal</div>);
jest.mock("firebase/auth", () => ({
  ...jest.requireActual("firebase/auth"),
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: "creator-1" });
    return () => {};
  },
}));

const NOW = new Date("2026-06-01T12:00:00Z");
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const FUTURE = ts("2026-06-02T00:00:00Z");

const mockCreateComment = jest.fn();
let mockForum: Record<string, unknown>;
const COMMENTS = [{ id: "c1", userName: "A", content: "Earlier message", createdAt: ts("2026-05-30T08:00:00Z") }];
jest.mock("../../hooks/useFirestore", () => ({
  useFirestore: () => ({ createComment: mockCreateComment }),
  useComments: () => ({ comments: COMMENTS, loading: false, error: null }),
  useForum: () => ({ forum: mockForum, loading: false, error: null }),
}));

const setForum = (fields: Record<string, unknown>) => {
  mockForum = { id: "f1", title: "Forum", description: "D", question: "Q", creatorId: "creator-1", creatorName: "Owner", tags: [], ...fields };
};
const page = () => (
  <MemoryRouter initialEntries={["/forum/f1"]}>
    <Routes>
      <Route path="/forum/:forumId" element={<ForumDetailPage />} />
    </Routes>
  </MemoryRouter>
);
const box = () => screen.queryByPlaceholderText(/write your message/i) as HTMLTextAreaElement | null;
const sendButton = () => screen.queryByRole("button", { name: /send message/i });
const statusBadge = () => screen.getByText(/^(Open|Closed)$/);
const type = (text: string) => fireEvent.change(box()!, { target: { value: text } });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, doNotFake: ["setTimeout", "setInterval", "queueMicrotask", "nextTick"] });
  global.alert = jest.fn();
  window.sessionStorage.clear();
});
afterEach(() => jest.useRealTimers());

describe("rendering follows the server's posting rule", () => {
  it("offers the form on an active, not deleted forum before its end time", () => {
    setForum({ isActive: true, isAdminDeleted: false, endTime: FUTURE });
    render(page());
    expect(statusBadge()).toHaveTextContent("Open");
    expect(box()).toBeInTheDocument();
  });

  it.each([
    ["hidden by its creator, viewed by the creator", { isActive: false, isAdminDeleted: false }],
    ["hidden, viewed by an admin", { isActive: false }],
    ["admin-deleted, viewed by an admin", { isActive: true, isAdminDeleted: true }],
  ])("shows a forum %s but not the form", (_label, flags) => {
    setForum({ ...flags, endTime: FUTURE });
    render(page());
    expect(statusBadge()).toHaveTextContent("Closed");
    expect(box()).not.toBeInTheDocument();
    expect(screen.getByText("Not accepting new messages")).toBeInTheDocument();
    expect(screen.queryByText(/Forum closes on/)).not.toBeInTheDocument();
    // Viewing stays intact: metadata, messages and What's Tea
    expect(screen.getByText("Earlier message")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /What's Tea/ }));
    expect(screen.getByText("Tea modal")).toBeInTheDocument();
  });

  it.each([
    ["missing flags", {}],
    ["missing isActive", { isAdminDeleted: false }],
    ["missing isAdminDeleted", { isActive: true }],
    ["isActive as the string 'false' (not === false)", { isActive: "false" }],
    ["isAdminDeleted as the string 'true' (not === true)", { isAdminDeleted: "true" }],
    ["isActive null", { isActive: null }],
    ["isAdminDeleted 1", { isAdminDeleted: 1 }],
  ])("keeps the server's exact comparisons for %s: posting allowed", (_label, flags) => {
    setForum({ ...flags, endTime: FUTURE });
    render(page());
    expect(statusBadge()).toHaveTextContent("Open");
    expect(box()).toBeInTheDocument();
  });

  it("allows posting with no end time only while the forum is visible", () => {
    setForum({ isActive: true });
    const { unmount } = render(page());
    expect(box()).toBeInTheDocument();
    unmount();
    setForum({ isActive: false });
    render(page());
    expect(box()).not.toBeInTheDocument();
  });

  it.each([
    ["a string", "2030-01-01T00:00:00Z"],
    ["null", null],
    ["a malformed value", { toDate: "soon" }],
    ["exactly now", ts("2026-06-01T12:00:00Z")],
  ])("keeps posting closed for an end time that is %s", (_label, endTime) => {
    setForum({ isActive: true, isAdminDeleted: false, endTime });
    render(page());
    expect(statusBadge()).toHaveTextContent("Closed");
    expect(box()).not.toBeInTheDocument();
  });
});

describe("the submit-time check", () => {
  it("blocks a stale form after expiry: no request, draft kept, with an explanation", async () => {
    setForum({ isActive: true, endTime: ts("2026-06-01T12:00:30Z") });
    render(page());
    type("Still typing");
    act(() => jest.setSystemTime(new Date("2026-06-01T12:00:31Z")));
    fireEvent.click(sendButton()!);
    expect(mockCreateComment).not.toHaveBeenCalled();
    expect(global.alert).toHaveBeenCalledWith("This forum has closed and no longer accepts new messages.");
    // The draft stays readable but can't be sent
    await waitFor(() => expect(box()).toHaveAttribute("readonly"));
    expect(box()).toHaveValue("Still typing");
    expect(sendButton()).toBeDisabled();
    expect(statusBadge()).toHaveTextContent("Closed");
  });

  it("keeps the draft and its request ID when the forum becomes unavailable and later available again", async () => {
    setForum({ isActive: true, endTime: FUTURE });
    mockCreateComment.mockRejectedValueOnce(new PublishError("unavailable", 503));
    const { rerender } = render(page());
    type("Draft one");
    fireEvent.click(sendButton()!);
    await waitFor(() => expect(mockCreateComment).toHaveBeenCalledTimes(1));
    const firstId = mockCreateComment.mock.calls[0][0].requestId;

    // The creator hides the forum (seen after a reload of the forum data)
    setForum({ isActive: false, endTime: FUTURE });
    rerender(page());
    expect(box()).toHaveValue("Draft one");
    expect(box()).toHaveAttribute("readonly");
    expect(sendButton()).toBeDisabled();
    fireEvent.submit(box()!.closest("form")!);
    expect(mockCreateComment).toHaveBeenCalledTimes(1);
    expect(global.alert).toHaveBeenLastCalledWith("This forum isn't accepting new messages.");

    // Shown again: the same draft is sent with the same request ID
    setForum({ isActive: true, endTime: FUTURE });
    mockCreateComment.mockResolvedValueOnce({ id: "c9", duplicate: false });
    rerender(page());
    fireEvent.click(sendButton()!);
    await waitFor(() => expect(mockCreateComment).toHaveBeenCalledTimes(2));
    expect(mockCreateComment.mock.calls[1][0]).toMatchObject({ content: "Draft one", requestId: firstId });
  });

  it("keeps the draft when the server refuses a locally permitted send", async () => {
    setForum({ isActive: true, endTime: FUTURE });
    mockCreateComment.mockRejectedValue(new PublishError("closed", 409, "forum_closed"));
    render(page());
    type("Racing the close");
    fireEvent.click(sendButton()!);
    await waitFor(() => expect(global.alert).toHaveBeenCalledWith("This forum has closed and no longer accepts new messages."));
    expect(box()).toHaveValue("Racing the close");
  });

  it("still sends normally and shows the support message when the server returns one", async () => {
    setForum({ isActive: true, isAdminDeleted: false, endTime: FUTURE });
    mockCreateComment.mockResolvedValue({ id: "c2", duplicate: false, support: true });
    render(page());
    type("Hello");
    fireEvent.click(sendButton()!);
    await waitFor(() => expect(box()).toHaveValue(""));
    expect(mockCreateComment).toHaveBeenCalledWith(expect.objectContaining({ forumId: "f1", content: "Hello" }));
    expect(global.alert).toHaveBeenCalledWith(SUPPORT_MESSAGE);
  });
});
