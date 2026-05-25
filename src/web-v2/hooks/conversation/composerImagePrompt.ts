export function appendUploadedImagePaths(prompt: string, imagePaths: string[]) {
  if (!imagePaths.length) {
    return prompt;
  }

  const imageBlock = ['Uploaded images:', ...imagePaths.map((path) => `- ${path}`)].join('\n');
  return [prompt, imageBlock].filter(Boolean).join('\n\n').trim();
}
