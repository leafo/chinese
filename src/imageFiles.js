export async function encodeImageFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return {
    dataUrl,
    base64Data: dataUrl.split(',')[1],
    mimeType: file.type,
  };
}

export function extractPastedImages(clipboardData) {
  const files = [];
  for (const item of clipboardData?.items || []) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}
