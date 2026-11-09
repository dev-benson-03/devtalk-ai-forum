/**
 * Legacy timestamp values on the forum list: none of them may crash the
 * page, show "Invalid Date", or list a forum as open when the server would
 * refuse new messages on it. The clock is fixed.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { MemoryRouter } from "react-router";
import { ForumsPage } from "../forumspage";

const mockUseForums = jest.fn();
jest.mock("../../hooks/useFirestore", () => ({ useForums: () => mockUseForums() }));

const NOW = new Date("2026-06-01T12:00:00Z");
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const forum = (id: string, fields: Record<string, unknown>) => ({
  id, title: `Forum ${id}`, description: "D", creatorName: "Pat", createdAt: ts("2026-01-15T10:00:00Z"), ...fields,
});

const LEGACY = [
  forum("future", { endTime: ts("2026-06-02T00:00:00Z") }),
  forum("past", { endTime: ts("2026-05-01T00:00:00Z") }),
  forum("none", {}),
  forum("iso-string", { endTime: "2030-01-01T00:00:00Z" }),
  forum("bad-string", { endTime: "2026-02-30T00:00:00Z" }),
  forum("null-end", { endTime: null }),
  forum("number-end", { endTime: 1767225600000 }),
  forum("malformed-end", { endTime: { toDate: "soon" } }),
  forum("string-created", { createdAt: "2026-01-15T10:00:00Z" }),
  forum("bad-created", { createdAt: { toDate: () => { throw new Error("boom"); } } }),
];

const card = (id: string) => screen.getByText(`Forum ${id}`).closest("a") as HTMLElement;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["setTimeout", "setInterval", "queueMicrotask", "nextTick"] });
  mockUseForums.mockReturnValue({ forums: LEGACY, loading: false, error: null });
});
afterEach(() => jest.useRealTimers());

const renderPage = () => render(<MemoryRouter><ForumsPage /></MemoryRouter>);

it("renders every legacy shape without crashing or showing Invalid Date", () => {
  renderPage();
  for (const f of LEGACY) expect(card(f.id)).toBeInTheDocument();
  expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
});

it("shows creation dates as before, and Unknown date when unreadable", () => {
  renderPage();
  const day = new Date("2026-01-15T10:00:00Z").toLocaleDateString();
  expect(within(card("future")).getByText(`By Pat • ${day}`)).toBeInTheDocument();
  expect(within(card("string-created")).getByText(`By Pat • ${day}`)).toBeInTheDocument();
  expect(within(card("bad-created")).getByText("By Pat • Unknown date")).toBeInTheDocument();
});

it("labels only forums the server would accept messages on as Open", () => {
  renderPage();
  const status = (id: string) => within(card(id)).getByText(/^(Open|Closed)$/).textContent;
  expect(["future", "none", "string-created", "bad-created"].map(status)).toEqual(["Open", "Open", "Open", "Open"]);
  expect(["past", "iso-string", "bad-string", "null-end", "number-end", "malformed-end"].map(status)).toEqual(
    Array(6).fill("Closed")
  );
});

it("keeps the end-time wording for real Timestamps and says no new messages otherwise", () => {
  renderPage();
  const future = new Date("2026-06-02T00:00:00Z");
  const past = new Date("2026-05-01T00:00:00Z");
  expect(within(card("future")).getByText(`Closes on ${future.toLocaleDateString()} at ${future.toLocaleTimeString()}`)).toBeInTheDocument();
  expect(within(card("past")).getByText(`Closed on ${past.toLocaleDateString()} at ${past.toLocaleTimeString()}`)).toBeInTheDocument();
  expect(within(card("iso-string")).getByText("Not accepting new messages")).toBeInTheDocument();
  expect(within(card("null-end")).getByText("Not accepting new messages")).toBeInTheDocument();
  expect(within(card("none")).queryByText(/Closes|Closed on|Not accepting/)).not.toBeInTheDocument();
});

it("filters by the same status and lists open forums first, keeping order within each group", () => {
  renderPage();
  const order = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).filter((t) => t?.startsWith("Forum ")).map((t) => t!.slice(6));
  expect(order()).toEqual(["future", "none", "string-created", "bad-created", "past", "iso-string", "bad-string", "null-end", "number-end", "malformed-end"]);
  fireEvent.click(screen.getByLabelText("Open"));
  expect(order()).toEqual(["future", "none", "string-created", "bad-created"]);
});
