import { describe, expect, it } from "vitest";
import { findUiStrings } from "./ui-strings.ts";

const hits = (source: string) =>
  findUiStrings("probe.tsx", source).map((h) => `${h.where}: ${h.text}`);

describe("check:ui-strings", () => {
  it("fails <Text>Hello</Text>", () => {
    expect(hits("const a = <Text>Hello</Text>;")).toEqual(["text between tags: Hello"]);
  });

  it("fails a literal child and a literal in a prop that is read or heard", () => {
    expect(
      hits('const a = <Button accessibilityLabel="Close" placeholder={`Name`}>{"Save"}</Button>;'),
    ).toEqual([
      "accessibilityLabel prop: Close",
      "placeholder prop: Name",
      "literal as a child: Save",
    ]);
    // The probe is source text: its ${name} is meant literally.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: TSX under test, not a template of this file
    expect(hits("const a = <Text>{`Hello ${name}`}</Text>;")).toEqual([
      "literal as a child: Hello",
    ]);
  });

  it("passes t(), symbols, and literals that nobody reads", () => {
    expect(
      hits(`const a = (
        <View className="flex-row gap-2" testID="root" accessibilityRole="button" accessibilityLabel={t("smoke.retry")}>
          <Text>{t("smoke.title")}</Text>
          <Text> · </Text>
          <Text>{"✓"}</Text>
          <Text>{count}</Text>
        </View>
      );`),
    ).toEqual([]);
  });

  it("reports where the string is", () => {
    expect(findUiStrings("probe.tsx", "const a = (\n  <Text>Hello</Text>\n);")[0]).toMatchObject({
      line: 2,
      column: 9,
    });
  });
});
