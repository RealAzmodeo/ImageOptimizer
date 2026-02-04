import type { ImageFile, OptimizationOptions } from './utils/fileHelpers';

export class OptimizationManager {
    private worker: Worker;
    private onUpdate: (fileId: string, updates: Partial<ImageFile>) => void;
    private resolvers: Map<string, () => void> = new Map();

    constructor(onUpdate: (fileId: string, updates: Partial<ImageFile>) => void) {
        this.onUpdate = onUpdate;
        this.worker = new Worker(new URL('./workers/optimization.worker.ts', import.meta.url), {
            type: 'module'
        });

        this.worker.onmessage = (e) => {
            const { id, blob, status, error } = e.data;
            if (status === 'done') {
                this.onUpdate(id, {
                    status: 'done',
                    compressedSize: blob.size,
                    compressedBlob: blob
                });
            } else if (status === 'error') {
                console.error('Worker reported error:', error);
                this.onUpdate(id, { status: 'error' });
            }

            const resolve = this.resolvers.get(id);
            if (resolve) {
                this.resolvers.delete(id);
                resolve();
            }
        };

        this.worker.onerror = (e) => {
            console.error('Worker execution error:', e);
            // Fail all pending
            this.resolvers.forEach((resolve, id) => {
                this.onUpdate(id, { status: 'error' });
                resolve();
            });
            this.resolvers.clear();
        };

        this.worker.onmessageerror = (e) => {
            console.error('Worker message error:', e);
        };
    }

    async processBatch(files: ImageFile[], options: OptimizationOptions) {
        // Only filter out what is actively processing, allow 'pending' (and 'done' if forcefully passed as pending)
        const batch = files.filter(f => f.status !== 'processing');

        return Promise.all(batch.map(file => {
            return new Promise<void>((resolve) => {
                const timeoutId = setTimeout(() => {
                    console.warn(`Worker timed out for ${file.relativePath}. Switching to main thread.`);
                    this.worker.terminate();
                    this.processInMainThread(file, options).then(() => {
                        resolve();
                    });
                }, 5000); // 5s timeout before fallback

                this.resolvers.set(file.id, () => {
                    clearTimeout(timeoutId);
                    resolve();
                });

                this.onUpdate(file.id, { status: 'processing' });
                this.worker.postMessage({
                    id: file.id,
                    file: file.file,
                    options
                });
            });
        }));
    }

    async processInMainThread(file: ImageFile, options: OptimizationOptions) {
        try {
            console.log(`[MainThread] Processing ${file.file.name}...`);
            const img = new Image();
            const url = URL.createObjectURL(file.file);
            await new Promise((r, j) => {
                img.onload = r;
                img.onerror = j;
                img.src = url;
            });

            const width = img.width;
            const height = img.height;

            let targetWidth = width;
            let targetHeight = height;

            if (options.resizeValue && options.resizeValue !== 100) {
                const scale = options.resizeValue / 100;
                targetWidth = Math.max(1, Math.floor(width * scale));
                targetHeight = Math.max(1, Math.floor(height * scale));
            }

            let canvasWidth = targetWidth;
            let canvasHeight = targetHeight;
            let drawX = 0;
            let drawY = 0;

            if (options.enforcePOT) {
                canvasWidth = Math.pow(2, Math.ceil(Math.log2(targetWidth)));
                canvasHeight = Math.pow(2, Math.ceil(Math.log2(targetHeight)));

                // Center the image in the POT canvas (Padding/Contain)
                drawX = Math.floor((canvasWidth - targetWidth) / 2);
                drawY = Math.floor((canvasHeight - targetHeight) / 2);
            }

            const canvas = document.createElement('canvas');
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Main thread canvas context failed');

            // Draw image centered (preserving aspect ratio of targetWidth/Height)
            ctx.drawImage(img, drawX, drawY, targetWidth, targetHeight);

            // Posterization / Color Reduction for PNG
            if (file.file.type === 'image/png' && options.quality < 100) {
                const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
                const data = imageData.data;

                // Map quality 10-100 to levels 2-255
                // Lower quality = fewer levels = more compression
                // We want significant reduction below 80%
                // Levels: 10% -> 4 levels, 50% -> 16 levels, 80% -> 32 levels, 100% -> 255
                const levels = Math.max(2, Math.floor((options.quality / 100) * 32));
                const step = 255 / (levels - 1);

                for (let i = 0; i < data.length; i += 4) {
                    // Simple channel quantization
                    data[i] = Math.round(Math.round(data[i] / step) * step);
                    data[i + 1] = Math.round(Math.round(data[i + 1] / step) * step);
                    data[i + 2] = Math.round(Math.round(data[i + 2] / step) * step);

                    // Apply Alpha Bleed if transparent
                    if (data[i + 3] === 0 && (options.profile === 'extreme' || options.profile === 'sprites')) {
                        // Check if any near pixel is opaque (simple 1px bleed)
                        if (i > 4 && data[i - 1] > 0) {
                            data[i] = data[i - 4]; data[i + 1] = data[i - 3]; data[i + 2] = data[i - 2];
                        }
                    }
                }
                ctx.putImageData(imageData, 0, 0);
            }

            const mimeType = file.file.type === 'image/png' ? 'image/png' : 'image/jpeg';
            // Map slider 10-100 to quality 0.1-1.0 for JPEG
            const jpegQuality = Math.max(0.1, options.quality / 100);

            canvas.toBlob((blob) => {
                if (blob) {
                    this.onUpdate(file.id, {
                        status: 'done',
                        compressedSize: blob.size,
                        compressedBlob: blob
                    });
                } else {
                    this.onUpdate(file.id, { status: 'error' });
                }
                URL.revokeObjectURL(url);
            }, mimeType, mimeType === 'image/jpeg' ? jpegQuality : undefined);

        } catch (err) {
            console.error('[MainThread] Error:', err);
            this.onUpdate(file.id, { status: 'error' });
        }
    }

    terminate() {
        this.worker.terminate();
    }
}
