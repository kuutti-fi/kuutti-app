import { useLocalSearchParams } from "expo-router";
import { PhotoZoomScreen } from "@/features/media";

/** The zoom screen; the grid passes what the label needs so nothing is fetched here but the URL. */
export default function PhotoZoomRoute() {
  const params = useLocalSearchParams<{
    id: string;
    blurhash?: string;
    position?: string;
    total?: string;
  }>();
  return (
    <PhotoZoomScreen
      id={params.id}
      blurhash={params.blurhash ?? ""}
      position={Number(params.position ?? "1")}
      total={Number(params.total ?? "1")}
    />
  );
}
