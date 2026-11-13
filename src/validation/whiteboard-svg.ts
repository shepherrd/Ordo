import { assertGeneratedSvg } from "./generated-svg";
/** The whiteboard renderer adds only inert embedded PNGs or validated generated SVGs. */
export function assertWhiteboardSvg(svg: string) {
  if (new TextEncoder().encode(svg).length > 16 * 1024 * 1024)
    throw Error("Whiteboard SVG exceeds 16 MiB");
  const rest = svg.replace(/<image\s[^>]*\/>/g, (tag) => {
    const match = tag.match(
      /^<image x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" preserveAspectRatio="xMidYMid meet" href="data:image\/(png|svg\+xml);base64,([A-Za-z0-9+/=]+)"\/>$/,
    );
    if (!match) throw Error("Unsafe whiteboard graphic");
    const binary = atob(match[2]);
    if (match[1] === "svg+xml")
      assertGeneratedSvg(
        new TextDecoder().decode(
          Uint8Array.from(binary, (c) => c.charCodeAt(0)),
        ),
      );
    else if (!binary.startsWith("\x89PNG\r\n\x1a\n"))
      throw Error("Invalid whiteboard PNG");
    return "";
  });
  assertGeneratedSvg(rest);
}
