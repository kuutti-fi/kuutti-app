import {
  type ApiComponents,
  CardPreviewResponse,
  ErrorResponse,
  ProfileResponse,
  type ProfileUpdate,
} from "@kuutti/schema";
import { ApiError, api } from "@/lib/api";

// The profile routes as the app calls them (#47), through the typed client;
// the zod contracts guard the runtime (ADR-003).

function failed(response: Response, error: unknown, what: string): ApiError {
  const parsed = ErrorResponse.safeParse(error);
  return new ApiError(
    `${what} answered ${response.status}`,
    response.status,
    parsed.success ? parsed.data.error.code : undefined,
  );
}

export async function fetchProfile(): Promise<ProfileResponse> {
  const { data, error, response } = await api.GET("/profile");
  if (!data) throw failed(response, error, "profile");
  return ProfileResponse.parse(data);
}

export async function saveProfile(update: ProfileUpdate): Promise<ProfileResponse> {
  // The generated body type spells the strict objects with an index signature
  // the zod type has no room for; the contract is the zod schema (ADR-003).
  const { data, error, response } = await api.PUT("/profile", {
    body: update as unknown as ApiComponents["schemas"]["ProfileUpdate"],
  });
  if (!data) throw failed(response, error, "profile save");
  return ProfileResponse.parse(data);
}

export async function fetchCardPreview(): Promise<CardPreviewResponse> {
  const { data, error, response } = await api.GET("/profile/card");
  if (!data) throw failed(response, error, "card preview");
  return CardPreviewResponse.parse(data);
}
