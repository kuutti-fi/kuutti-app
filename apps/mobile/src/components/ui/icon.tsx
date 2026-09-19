import type { LucideIcon, LucideProps } from "lucide-react-native";
import { cssInterop } from "nativewind";
import * as React from "react";
import { Platform } from "react-native";
import { TextClassContext } from "@/components/ui/text";
import { cn } from "@/lib/utils";

type IconProps = LucideProps & { as: LucideIcon } & React.RefAttributes<LucideIcon>;

function IconImpl({ as: IconComponent, ...props }: IconProps) {
  return <IconComponent {...props} />;
}

cssInterop(IconImpl, {
  className: { target: "style", nativeStyleToProp: { height: "size", width: "size" } },
});

// Hidden from screen readers with each platform's own props: react-native-svg
// on web hands unknown props to the DOM.
const DECORATIVE = Platform.select({
  web: { "aria-hidden": true },
  default: { accessibilityElementsHidden: true, importantForAccessibility: "no" as const },
});

/**
 * A lucide icon with className support, from React Native Reusables (#12).
 * Icons are decorative: hidden from screen readers, because the control around
 * them carries the label (Button requires one for icon-only content). Colour
 * comes from the surrounding text class or a token class, never a literal.
 */
function Icon({ as: IconComponent, className, size = 20, ...props }: IconProps) {
  const textClass = React.useContext(TextClassContext);
  return (
    <IconImpl
      as={IconComponent}
      {...DECORATIVE}
      className={cn("text-foreground", textClass, className)}
      size={size}
      {...props}
    />
  );
}

export { Icon };
