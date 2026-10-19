import { describe, expect, it } from "vitest";
import { allowedTransitions, assertTransition, eventTypeForTransition, TransitionError } from "../src/stages";

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
