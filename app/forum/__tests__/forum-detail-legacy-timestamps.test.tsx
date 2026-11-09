/**
 * Legacy timestamp values on the forum page: no crash, no "Invalid Date",
 * and the message form appears only when the server would accept a message.
 * The clock is fixed.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { MemoryRouter, Route, Routes } from "react-router";
import ForumDetailPage from "../forum-detail";

jest.mock("../../components/navbar/navbar", () => ({ NavBar: () => <nav /> }));
jest.mock("../../components/footer/footer", () => ({ Footer: () => <footer /> }));
jest.mock("../../message/components/TeaModal", () => () => <div>Tea modal</div>);
jest.mock("firebase/auth", () => ({
  ...jest.requireActual("firebase/auth"),
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    cb({ uid: "dana" });
    return () => {};
  },
}));

const NOW = new Date("2026-06-01T12:00:00Z");
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

const mockCreateComment = jest.fn();
let mockForum: Record<string, unknown>;
let mockComments: Array<Record<string, unknown>>;
jest.mock("../../hooks/useFirestore", () => ({
  useFirestore: () => ({ createComment: mockCreateComment }),
  useComments: () => ({ comments: mockComments, loading: false, error: null }),
  useForum: () => ({ forum: mockForum, loading: false, error: null }),
}));

const renderPage = (forum: Record<string, unknown>, comments: Array<Record<string, unknown>> = []) => {
  mockForum = { id: "f1", title: "Forum", description: "D", question: "Q", creatorName: "Owner", tags: [], ...forum };
  mockComments = comments;
  return render(
    <MemoryRouter initialEntries={["/forum/f1"]}>
      <Routes>
        <Route path="/forum/:forumId" element={<ForumDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
};
const form = () => screen.queryByPlaceholderText(/write your message/i);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, doNotFake: ["setTimeout", "setInterval", "queueMicrotask", "nextTick"] });
  global.alert = jest.fn();
});
afterEach(() => jest.useRealTimers());

describe("forum dates", () => {
  it("shows a valid creation date as before and Unknown date for unreadable ones", () => {
    const { unmount } = renderPage({ createdAt: "2026-01-15T10:00:00Z" });
    expect(screen.getByText(`Created by Owner • ${new Date("2026-01-15T10:00:00Z").toLocaleDateString()}`)).toBeInTheDocument();
    unmount();
    renderPage({ createdAt: { toDate: "never" } });
    expect(screen.getByText("Created by Owner • Unknown date")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it("shows comment times as before and Unknown date for legacy values", () => {
    const valid = ts("2026-05-30T08:00:00Z");
    renderPage({}, [
      { id: "c1", userName: "A", content: "one", createdAt: valid },
      { id: "c2", userName: "B", content: "two", createdAt: "yesterday" },
      { id: "c3", userName: "C", content: "three", createdAt: { toDate: () => { throw new Error("boom"); } } },
      { id: "c4", userName: "D", content: "four" },
    ]);
    expect(screen.getByText(valid.toDate().toLocaleString())).toBeInTheDocument();
    expect(screen.getAllByText("Unknown date")).toHaveLength(3);
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });
});

describe("posting follows the server's comment rule", () => {
  it("offers the form before a Timestamp end time, with the existing wording", () => {
    const end = ts("2026-06-02T00:00:00Z").toDate();
    renderPage({ endTime: ts("2026-06-02T00:00:00Z") });
    expect(form()).toBeInTheDocument();
    expect(screen.getByText(`Forum closes on ${end.toLocaleDateString()} at ${end.toLocaleTimeString()}`)).toBeInTheDocument();
  });

  it("hides the form after a Timestamp end time", () => {
    const end = ts("2026-05-01T00:00:00Z").toDate();
    renderPage({ endTime: ts("2026-05-01T00:00:00Z") });
    expect(form()).not.toBeInTheDocument();
    expect(screen.getByText(`Forum closed on ${end.toLocaleDateString()} at ${end.toLocaleTimeString()}`)).toBeInTheDocument();
  });

  it("keeps a forum with no end time open, with no end-time line", () => {
    renderPage({});
    expect(form()).toBeInTheDocument();
    expect(screen.queryByText(/Forum clos|Not accepting/)).not.toBeInTheDocument();
  });

  it.each([
    ["a future ISO string", "2030-01-01T00:00:00Z"],
    ["an impossible date", "2026-02-30T00:00:00Z"],
    ["null", null],
    ["a number", 1767225600000],
    ["a malformed timestamp-like value", { toDate: () => new Date(NaN) }],
  ])("hides the form for %s instead of treating it as open indefinitely", (_label, endTime) => {
    renderPage({ endTime });
    expect(form()).not.toBeInTheDocument();
    expect(screen.getByText("Not accepting new messages")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it("still posts a comment on an open forum", async () => {
    mockCreateComment.mockResolvedValue({ id: "c9" });
    renderPage({ endTime: ts("2026-06-02T00:00:00Z") });
    fireEvent.change(form()!, { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    await waitFor(() => expect(mockCreateComment).toHaveBeenCalledWith(expect.objectContaining({ forumId: "f1", content: "Hello" })));
    expect(global.alert).not.toHaveBeenCalled();
  });

  it("still opens What's Tea on a closed legacy forum with messages", () => {
    renderPage({ endTime: "2026-02-30T00:00:00Z" }, [{ id: "c1", userName: "A", content: "one", createdAt: "bad" }]);
    fireEvent.click(screen.getByRole("button", { name: /What's Tea/ }));
    expect(screen.getByText("Tea modal")).toBeInTheDocument();
  });
});
