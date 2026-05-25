import { useMutation } from '@tanstack/react-query';

export type ControlPlaneSessionImageUpload = {
  id: string;
  path: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
};

export type UploadControlPlaneSessionImagesInput = {
  sessionId: string;
  files: File[];
};

export async function uploadControlPlaneSessionImages(
  { sessionId, files }: UploadControlPlaneSessionImagesInput,
): Promise<ControlPlaneSessionImageUpload[]> {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('images', file, file.name);
  });

  const response = await fetch(`/control-plane/sessions/${encodeURIComponent(sessionId)}/uploads`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Image upload failed (${response.status})`);
  }

  const body = await response.json();
  if (!isUploadResponse(body)) {
    throw new Error('Image upload response was invalid.');
  }

  return body.uploads;
}

export function useUploadControlPlaneSessionImagesMutation() {
  return useMutation({
    mutationFn: uploadControlPlaneSessionImages,
  });
}

function isUploadResponse(body: unknown): body is { uploads: ControlPlaneSessionImageUpload[] } {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { uploads?: unknown }).uploads)) {
    return false;
  }

  return (body as { uploads: unknown[] }).uploads.every((upload) => {
    if (!upload || typeof upload !== 'object') {
      return false;
    }

    const candidate = upload as Record<string, unknown>;
    return typeof candidate.id === 'string'
      && typeof candidate.path === 'string'
      && typeof candidate.originalName === 'string'
      && typeof candidate.mediaType === 'string'
      && typeof candidate.sizeBytes === 'number';
  });
}
