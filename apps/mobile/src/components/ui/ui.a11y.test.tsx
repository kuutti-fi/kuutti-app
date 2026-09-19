import { act, screen } from "@testing-library/react-native";
import X from "lucide-react-native/icons/x";
import { colorScheme } from "nativewind";
import { Pressable } from "react-native";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { renderWithTheme } from "@/test/render";
import { Button, type ButtonProps } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";
import { Icon } from "./icon";
import { Input } from "./input";
import { Label } from "./label";
import { Skeleton } from "./skeleton";
import { Switch } from "./switch";
import { Text } from "./text";

/** Every primitive of src/components/ui in one tree, the dialog open. */
function Everything() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Title</CardTitle>
        <CardDescription>Description</CardDescription>
      </CardHeader>
      <CardContent>
        <Text variant="h1">Heading</Text>
        <Text variant="muted">Muted</Text>
        <Button onPress={() => undefined}>Save</Button>
        <Button variant="destructive" size="lg" onPress={() => undefined}>
          Delete
        </Button>
        <Button variant="outline" size="icon" accessibilityLabel="Close" onPress={() => undefined}>
          <Icon as={X} />
        </Button>
        <Label nativeID="name">Name</Label>
        <Input accessibilityLabel="Name" placeholder="Name" />
        <Switch accessibilityLabel="Notifications" checked onCheckedChange={() => undefined} />
        <Skeleton className="h-4 w-10" />
        <Dialog open>
          <DialogContent closeLabel="Close dialog">
            <DialogHeader>
              <DialogTitle>Dialog</DialogTitle>
              <DialogDescription>Body</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

describe("ui primitives: accessibility baseline", () => {
  afterEach(async () => {
    await act(async () => colorScheme.set("system"));
  });

  it.each(["light", "dark"] as const)(
    "every pressable has a role, a label and a 44 pt target in %s",
    async (scheme) => {
      await act(async () => colorScheme.set(scheme));
      await renderWithTheme(<Everything />);
      const found = pressables(screen.toJSON() as HostNode | HostNode[] | null);
      // Three buttons, the input, the switch and the dialog's close control at least.
      expect(found.length).toBeGreaterThanOrEqual(6);
      expect(found.flatMap((node) => a11yProblems(node).map((p) => `${node.type}: ${p}`))).toEqual(
        [],
      );
    },
  );

  it("fails a pressable without a role, a label or a full-size target", async () => {
    // The negative control: what the suite above would report if a primitive lost its label.
    await renderWithTheme(
      <Pressable onPress={() => undefined} style={{ width: 20, height: 20 }} />,
    );
    const [bare] = pressables(screen.toJSON() as HostNode | HostNode[] | null);
    if (!bare) throw new Error("the bare pressable was not found");
    expect(a11yProblems(bare)).toEqual([
      "no accessibilityRole",
      "no accessibilityLabel and no text",
      "touch target 20x20 pt, needs 44x44",
    ]);
  });

  it("labels the switch and the dialog's close control for screen readers", async () => {
    await renderWithTheme(<Everything />);
    expect(screen.getByRole("switch", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("caps font scaling at twice the OS size instead of switching it off", async () => {
    await renderWithTheme(<Text>Scaled</Text>);
    const text = screen.getByText("Scaled");
    expect(text.props.maxFontSizeMultiplier).toBe(2);
    expect(text.props.allowFontScaling).not.toBe(false);
  });

  it("makes an icon-only button without a label a type error", () => {
    // Compile-time assertions: tsc fails on an unused @ts-expect-error, so this
    // test breaks the typecheck the day the label stops being required.
    const iconOnly = { children: <Icon as={X} /> };
    // @ts-expect-error an icon child needs an accessibilityLabel
    const unlabelled: ButtonProps = iconOnly;
    const labelled: ButtonProps = { ...iconOnly, accessibilityLabel: "Close" };
    const text: ButtonProps = { children: "Close" };
    expect([unlabelled, labelled, text]).toHaveLength(3);
  });
});
