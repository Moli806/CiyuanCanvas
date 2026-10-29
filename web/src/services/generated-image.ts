import { uploadImage, type UploadedImage } from "@/services/image-storage";
import type { GeneratedImageItem } from "@/services/api/image";

/**
 * Cache a freshly generated image locally and carry its server copy forward, so
 * node content can fall back to the durable URL when IndexedDB is cleared or the
 * project is opened on another browser.
 */
export async function stageGeneratedImage(item: GeneratedImageItem, options?: { signal?: AbortSignal }): Promise<UploadedImage> {
    const image = await uploadImage(item.dataUrl, options);
    return item.serverUrl ? { ...image, serverUrl: item.serverUrl } : image;
}
