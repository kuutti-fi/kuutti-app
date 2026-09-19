import Settings from "lucide-react-native/icons/settings";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { type SchemePreference, useTheme } from "@/theme/ThemeProvider";

const SCHEMES: ReadonlyArray<{ value: SchemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Theme and high-contrast toggles for builds that are not production (#12):
 * how all four token sets are looked at on a device. Strings are inline until
 * #13, like the rest of the smoke screen.
 */
export function DevSettings() {
  const { preference, setPreference, highContrast, setHighContrast } = useTheme();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" accessibilityLabel="Appearance settings">
          <Icon as={Settings} />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel="Close appearance settings">
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription>Development builds only.</DialogDescription>
        </DialogHeader>
        <View accessibilityRole="radiogroup" accessibilityLabel="Theme" className="flex-row gap-2">
          {SCHEMES.map(({ value, label }) => (
            <Button
              key={value}
              variant={preference === value ? "default" : "outline"}
              accessibilityRole="radio"
              accessibilityState={{ checked: preference === value }}
              // react-native-web reads the ARIA prop, not accessibilityState.
              aria-checked={preference === value}
              className="flex-1"
              onPress={() => setPreference(value)}
            >
              {/* The selected option is marked in text too, not by colour alone. */}
              {preference === value ? `✓ ${label}` : label}
            </Button>
          ))}
        </View>
        <View className="flex-row items-center justify-between gap-4">
          <Label nativeID="high-contrast-label" onPress={() => setHighContrast(!highContrast)}>
            High contrast
          </Label>
          <Switch
            accessibilityLabel="High contrast"
            checked={highContrast}
            onCheckedChange={setHighContrast}
          />
        </View>
      </DialogContent>
    </Dialog>
  );
}
