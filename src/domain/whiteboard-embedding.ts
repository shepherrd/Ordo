import type { Operation } from "./model";
import type { ManagedAsset } from "./modules";
import { newModuleDefinition } from "./modules";
import { addOperationModule } from "./module-authoring";
import { newBriefingSlide } from "./briefings";
export function insertWhiteboardImage(
  op: Operation,
  asset: ManagedAsset,
  caption: string,
  target:
    { kind: "order"; productId: string } | { kind: "briefing"; deckId: string },
  uid: () => string,
  at: string,
) {
  if (asset.operationId !== op.id || asset.mimeType !== "image/png")
    throw Error("Whiteboard snapshot must belong to this operation");
  if (target.kind === "order") {
    if (
      target.productId !== op.orderId &&
      !op.attachments.some((a) => a.id === target.productId)
    )
      throw Error("Choose an existing order product");
    const definition = newModuleDefinition("IMAGE", uid());
    definition.title = "Whiteboard snapshot";
    const m = addOperationModule(op, target.productId, definition, uid, at);
    op.modules!.assets.push(asset);
    m.content = {
      type: "IMAGE",
      image: {
        id: uid(),
        assetId: asset.assetId,
        title: "",
        caption,
        alt: caption,
        width: "full",
        alignment: "center",
      },
    };
    return m.moduleInstanceId;
  }
  const deck = op.briefings?.decks.find((d) => d.id === target.deckId);
  if (!deck || deck.slides.length >= 40)
    throw Error("Choose a briefing with space for another slide");
  const slide = newBriefingSlide(uid(), "graphic");
  slide.title = "Whiteboard snapshot";
  slide.body = caption;
  slide.notes = caption;
  slide.graphic = { kind: "image", asset };
  deck.slides.push(slide);
  return slide.id;
}
