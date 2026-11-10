import { pageIdFromWidgetURL } from "../../../shared/schema";

/** Let Expo Router own both cold-start and subsequent widget navigation.
 * Returning null discards the link; a separate mount effect can race startup.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const id = pageIdFromWidgetURL(path);
    return id ? `/page?id=${encodeURIComponent(id)}` : path;
  } catch {
    return "/";
  }
}
