import { checkPhoto, setLocalCheck } from "./localCheck";

afterEach(() => setLocalCheck(null));

describe("the on-device check", () => {
  it("passes every picture until a classifier is installed", async () => {
    expect(await checkPhoto("file:///photo.jpg")).toBe("allow");
  });

  it("answers with the installed classifier's verdict and forgets it when uninstalled", async () => {
    setLocalCheck(async (uri) => (uri.includes("nude") ? "refuse" : "allow"));
    expect(await checkPhoto("file:///nude.jpg")).toBe("refuse");
    expect(await checkPhoto("file:///beach.jpg")).toBe("allow");
    setLocalCheck(null);
    expect(await checkPhoto("file:///nude.jpg")).toBe("allow");
  });

  it("refuses when the classifier fails: a picture it could not look at is not sent", async () => {
    setLocalCheck(async () => {
      throw new Error("model not loaded");
    });
    expect(await checkPhoto("file:///photo.jpg")).toBe("refuse");
  });
});
