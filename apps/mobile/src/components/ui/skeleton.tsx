import type * as React from "react";
import { View } from "react-native";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/theme/useReducedMotion";

// From React Native Reusables (#12), adapted: the pulse stops under
// reduce-motion, and the placeholder is hidden from screen readers (the
// loading state is announced by the screen that shows it).
function Skeleton({
  className,
  ...props
}: React.ComponentProps<typeof View> & React.RefAttributes<View>) {
  const reduced = useReducedMotion();
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn("rounded-md bg-accent", !reduced && "animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
