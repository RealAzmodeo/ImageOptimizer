export interface OptimizationOptions {
    profile: 'sprites' | 'ui' | 'background' | 'extreme' | 'custom';
    resizeMode: 'percentage' | 'fixed';
    resizeValue: number;
    quality: number; // 0-100
    compressionLevel: 'very_low' | 'low' | 'optimal' | 'high' | 'very_high';
    preserveStructure: boolean;
    unityReady: boolean;
    enforcePOT: boolean;
    potSize: 'auto' | 16 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096;
    potMode: 'pad' | 'stretch' | 'crop' | 'fit';
    smartPadding: boolean;
    // Experimental Features
    smartCrop: boolean;
    outputFormat: 'original' | 'webp';
    maskMode: boolean;
    namePrefix: string;
    nameSuffix: string;
}

export interface ImageFile {
    id: string;
    file: File;
    relativePath: string;
    originalSize: number;
    compressedSize?: number;
    status: 'pending' | 'processing' | 'done' | 'error';
    previewUrl: string;
    compressedBlob?: Blob;
    selected: boolean; // For Include/Skip toggle
    width?: number;   // For POT Auditor
    height?: number;  // For POT Auditor
}

export const getFilesFromItems = async (items: DataTransferItemList) => {
    const files: { file: File; relativePath: string }[] = [];

    const traverse = async (entry: FileSystemEntry, path = "") => {
        if (entry.isFile) {
            const fileEntry = entry as FileSystemFileEntry;
            const file = await new Promise<File>((resolve) => fileEntry.file(resolve));
            files.push({ file, relativePath: path + file.name });
        } else if (entry.isDirectory) {
            const dirEntry = entry as FileSystemDirectoryEntry;
            const reader = dirEntry.createReader();
            const entries = await new Promise<FileSystemEntry[]>((resolve) => {
                reader.readEntries(resolve);
            });
            for (const child of entries) {
                await traverse(child, path + entry.name + "/");
            }
        }
    };

    const traversePromises = [];
    for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) {
            traversePromises.push(traverse(entry));
        }
    }
    await Promise.all(traversePromises);
    return files;
};

export const getNextPOT = (value: number) => {
    return Math.pow(2, Math.ceil(Math.log2(value)));
};

export const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
