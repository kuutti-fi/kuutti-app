import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

/** The long edge the app sends (rules/mobile.md Images); the API makes the variants. */
export const UPLOAD_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.9;

export type PickedPhoto = { uri: string; width: number; height: number; mimeType: string };

export type PickOutcome =
  | { kind: "picked"; asset: { uri: string; width: number; height: number } }
  | { kind: "cancelled" }
  | { kind: "denied" };

/** Opens the phone's photo library for one still image. Denied covers a permission the person did not grant. */
export async function pickPhoto(): Promise<PickOutcome> {
  let result: ImagePicker.ImagePickerResult;
  try {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      allowsEditing: false,
      quality: 1,
      exif: false,
    });
  } catch {
    return { kind: "denied" };
  }
  if (result.canceled) return { kind: "cancelled" };
  const asset = result.assets[0];
  if (!asset) return { kind: "cancelled" };
  return { kind: "picked", asset: { uri: asset.uri, width: asset.width, height: asset.height } };
}

/**
 * Pre-resize to 1600 px and re-save as JPEG (rules/mobile.md Images): the
 * manipulator writes a new file without the original's EXIF, so location and
 * camera data never leave the phone even before the API strips them again
 * (rule 4). A picture already within the edge is re-saved all the same.
 */
export async function prepareForUpload(asset: {
  uri: string;
  width: number;
  height: number;
}): Promise<PickedPhoto> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > UPLOAD_LONG_EDGE) {
    context.resize(
      asset.width >= asset.height ? { width: UPLOAD_LONG_EDGE } : { height: UPLOAD_LONG_EDGE },
    );
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: saved.uri, width: saved.width, height: saved.height, mimeType: "image/jpeg" };
}
