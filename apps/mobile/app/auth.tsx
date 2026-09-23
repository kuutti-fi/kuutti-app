import { useLocalSearchParams } from "expo-router";
import { SignInScreen } from "@/features/identity";

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** `kuutti://auth?code=…` or `?error=…`: the bank login's return lands here (#36). */
export default function AuthReturnRoute() {
  const params = useLocalSearchParams<{ code?: string; error?: string; until?: string }>();
  return (
    <SignInScreen
      code={first(params.code)}
      error={first(params.error)}
      until={first(params.until)}
    />
  );
}
