import type { GateResponse } from "@kuutti/schema";
import { act, fireEvent } from "@testing-library/react-native";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { renderWithTheme } from "@/test/render";
import { GateCard } from "./GateCard";

// The gate card (#94, ADR-015): where the person stands, in words.

const gate = (state: Partial<GateResponse> & Pick<GateResponse, "state">): GateResponse => ({
  within: null,
  needed: null,
  step: 10,
  ...state,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function answering(answers: Array<() => Response>) {
  const calls: Request[] = [];
  let n = 0;
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = input instanceof Request ? input : new Request(input);
    calls.push(request);
    const answer = answers[Math.min(n, answers.length - 1)];
    n += 1;
    if (!answer) throw new Error("no answer prepared");
    return answer();
  }) as unknown as typeof fetch;
  return calls;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

describe("GateCard", () => {
  it("says about how many more are needed, who counts and why the number is round", async () => {
    const calls = answering([() => json(gate({ state: "closed", needed: 20 }))]);
    const screen = await renderWithTheme(<GateCard />);
    await settle();
    expect(screen.getByLabelText("When matching opens for you")).toBeTruthy();
    expect(
      screen.getByText("About 20 more people are needed before matching opens for you."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "They are people in your area who are what you seek, and who seek somebody like you.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Numbers here are said in steps of 10, so that they do not follow each person who comes or goes.",
      ),
    ).toBeTruthy();
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/gate");
  });

  it("says one person in the singular", async () => {
    answering([() => json(gate({ state: "closed", needed: 1 }))]);
    const screen = await renderWithTheme(<GateCard />);
    await settle();
    expect(
      screen.getByText("About 1 more person is needed before matching opens for you."),
    ).toBeTruthy();
  });

  it("says the place in line in tens and why there is a line, naming no gender", async () => {
    answering([() => json(gate({ state: "waiting", within: 20 }))]);
    const screen = await renderWithTheme(<GateCard />);
    await settle();
    expect(screen.getByText("You are among the next 20 in line for your area.")).toBeTruthy();
    const why = screen.getByText(/Those who wait are let in in the order they registered/);
    expect(why).toBeTruthy();
    expect(screen.getByText(/Numbers here are said in steps of 10/)).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toMatch(/\b(men|women|man|woman)\b/i);
  });

  it.each([
    ["open", "Matching is open for you."],
    ["incomplete", "Matching opens for finished profiles. Yours still lacks something."],
    ["pending", "Your profile is finished. Where you stand is counted tonight."],
  ] as const)("says %s in one sentence and no number", async (state, text) => {
    answering([() => json(gate({ state }))]);
    const screen = await renderWithTheme(<GateCard />);
    await settle();
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/\d/)).toBeNull();
  });

  it("offers to try again when the gate could not be read, and reads it then", async () => {
    const calls = answering([
      () => json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500),
      () => json(gate({ state: "open" })),
    ]);
    const screen = await renderWithTheme(<GateCard />);
    await settle();
    expect(screen.getByText("Where you stand could not be read.")).toBeTruthy();
    const retry = screen.getByLabelText("Try again");
    expect(retry.props.accessibilityRole).toBe("button");
    await act(async () => {
      fireEvent.press(retry);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });
    await settle();
    expect(screen.getByText("Matching is open for you.")).toBeTruthy();
    expect(calls).toHaveLength(2);
  });

  it("refuses an answer that says a place and a number at once", async () => {
    answering([() => json({ state: "closed", within: 10, needed: 10, step: 10 })]);
    const screen = await renderWithTheme(<GateCard />);
    await settle();
    expect(screen.getByText("Where you stand could not be read.")).toBeTruthy();
  });

  it("has a label and a role on everything that can be pressed", async () => {
    answering([() => json({}, 500)]);
    const screen = await renderWithTheme(<GateCard />);
    await settle();
    const found = pressables(screen.toJSON() as HostNode);
    expect(found).toHaveLength(1);
    expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
  });
});
