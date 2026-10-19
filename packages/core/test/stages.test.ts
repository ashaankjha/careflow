import { describe, expect, it } from "vitest";
import { allowedTransitions, assertTransition, BOARD_STAGES, eventTypeForTransition, legalMoves, transitionNeedsInput, TransitionError } from "../src/stages";

describe("stage machine", () => {
  it("advances one step at a time", () => {
    expect(allowedTransitions("new")).toContain("contacted");
    expect(() => assertTransition("new", "benefits_verified")).toThrow(TransitionError);
    expect(() => assertTransition("ready_to_start", "started")).not.toThrow();
  });
  it("started is terminal", () => {
    expect(allowedTransitions("started")).toEqual([]);
    expect(() => assertTransition("started", "contacted")).toThrow(TransitionError);
  });
  it("exits require a reason; waitlist can return to an active stage", () => {
    expect(() => assertTransition("qualified", "waitlisted")).toThrow(/reason/);
    expect(() => assertTransition("qualified", "waitlisted", "No verified capacity")).not.toThrow();
    expect(allowedTransitions("waitlisted")).toContain("qualified");
    expect(() => assertTransition("withdrawn", "contacted", "Family re-engaged")).not.toThrow();
  });
  it("maps transitions to canonical events", () => {
    expect(eventTypeForTransition("ready_to_start", "started")).toBe("care_started_verified_by_staff");
    expect(eventTypeForTransition("withdrawn", "contacted")).toBe("inquiry_reopened");
    expect(eventTypeForTransition("qualified", "closed_unserviceable")).toBe("inquiry_closed");
  });
});

describe("board moves (Kanban drag targets)", () => {
  it("only offers the next step and waitlist from an active stage", () => {
    expect(legalMoves("new", BOARD_STAGES)).toEqual([
      { to: "contacted", needsInput: false },
      { to: "waitlisted", needsInput: true },
    ]);
    expect(legalMoves("contacted", BOARD_STAGES).map((m) => m.to)).not.toContain("benefits_verified");
  });
  it("never offers the current column or skips verification steps", () => {
    for (const from of BOARD_STAGES) {
      const moves = legalMoves(from, BOARD_STAGES);
      expect(moves.map((m) => m.to)).not.toContain(from);
      for (const m of moves) expect(() => assertTransition(from, m.to, "reason")).not.toThrow();
    }
  });
  it("lets waitlisted return to any active column without a reason", () => {
    const moves = legalMoves("waitlisted", BOARD_STAGES);
    expect(moves.map((m) => m.to)).toEqual(BOARD_STAGES.filter((s) => s !== "waitlisted"));
    expect(moves.every((m) => !m.needsInput)).toBe(true);
  });
  it("keeps board order and excludes columns not on the board", () => {
    expect(legalMoves("ready_to_start", BOARD_STAGES).map((m) => m.to)).toEqual(["waitlisted"]);
    expect(legalMoves("ready_to_start").map((m) => m.to)).toEqual(["started", "waitlisted", "closed_unserviceable", "withdrawn", "inactive"]);
    expect(legalMoves("started")).toEqual([]);
  });
  it("routes reasons and verified care starts through the drawer", () => {
    expect(transitionNeedsInput("qualified", "benefits_pending")).toBe(false);
    expect(transitionNeedsInput("qualified", "waitlisted")).toBe(true);
    expect(transitionNeedsInput("ready_to_start", "started")).toBe(true);
    expect(transitionNeedsInput("withdrawn", "contacted")).toBe(true);
    expect(legalMoves("withdrawn")).toEqual([{ to: "contacted", needsInput: true }]);
  });
});
