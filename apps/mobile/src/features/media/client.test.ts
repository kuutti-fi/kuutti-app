import { clearSession, saveSession } from "@/lib/session";
import { FakeXhr, partsOf } from "@/test/xhr";
import { uploadPhoto } from "./client";

const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const session = {
  sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
  accessToken: token("access"),
  accessExpiresAt: "2030-01-01T00:15:00.000Z",
  refreshToken: token("refresh"),
  refreshExpiresAt: "2030-04-01T00:00:00.000Z",
};
const stored = {
  id: "0b1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4c",
  blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  width: 1600,
  height: 1200,
  state: "pending",
  rejectionReason: null,
  position: 0,
  createdAt: "2026-09-25T12:00:00.000Z",
};
const picked = {
  uri: "file:///cache/photo.jpg#resized",
  width: 1600,
  height: 1200,
  mimeType: "image/jpeg",
};

beforeEach(async () => {
  FakeXhr.install();
  await clearSession();
});

describe("uploading a photo", () => {
  it("posts the file as multipart with the session's token and reports progress", async () => {
    await saveSession(session);
    FakeXhr.answers = [{ status: 201, body: JSON.stringify(stored), progress: [25, 100] }];
    const seen: number[] = [];
    const photo = await uploadPhoto(picked, (fraction) => seen.push(fraction));
    expect(photo).toEqual(stored);
    expect(seen).toEqual([0.25, 1]);
    const sent = FakeXhr.sent[0];
    expect(sent?.method).toBe("POST");
    expect(sent?.url).toMatch(/\/photos$/);
    expect(sent?.headers.authorization).toBe(`Bearer ${session.accessToken}`);
    // The file reference React Native's FormData streams from disk: uri, name and type, no bytes in JavaScript.
    const parts = partsOf(sent);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      fieldName: "photo",
      uri: picked.uri,
      type: "image/jpeg",
      name: "photo.jpg",
    });
  });

  it("surfaces the API's code on a refusal", async () => {
    await saveSession(session);
    FakeXhr.answers = [
      {
        status: 409,
        body: JSON.stringify({ error: { code: "photo_limit", message: "x", requestId: "r" } }),
      },
    ];
    await expect(uploadPhoto(picked)).rejects.toMatchObject({ status: 409, code: "photo_limit" });
  });

  it("refuses to upload without a session and sends nothing", async () => {
    await expect(uploadPhoto(picked)).rejects.toMatchObject({ status: 401 });
    expect(FakeXhr.sent).toHaveLength(0);
  });

  it("answers one 401 with one refresh and one retry", async () => {
    await saveSession(session);
    const refreshed = { ...session, accessToken: token("fresh"), refreshToken: token("fresh-r") };
    globalThis.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(refreshed), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    FakeXhr.answers = [
      {
        status: 401,
        body: JSON.stringify({ error: { code: "session_expired", message: "x", requestId: "r" } }),
      },
      { status: 201, body: JSON.stringify(stored) },
    ];
    expect(await uploadPhoto(picked)).toEqual(stored);
    expect(FakeXhr.sent).toHaveLength(2);
    expect(FakeXhr.sent[1]?.headers.authorization).toBe(`Bearer ${refreshed.accessToken}`);
  });
});
