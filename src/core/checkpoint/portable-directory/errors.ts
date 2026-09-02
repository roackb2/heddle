/** Raised when a portable-directory policy contains unsafe or ambiguous limits. */
export class PortableDirectoryCheckpointPolicyError extends Error {
  readonly code = 'PORTABLE_DIRECTORY_CHECKPOINT_POLICY_ERROR';

  constructor(readonly detail: string, options?: ErrorOptions) {
    super(`Invalid portable directory checkpoint policy: ${detail}`, options);
    this.name = 'PortableDirectoryCheckpointPolicyError';
  }
}

/** Raised when a local directory cannot be captured within its selected policy. */
export class PortableDirectoryCheckpointCaptureError extends Error {
  readonly code = 'PORTABLE_DIRECTORY_CHECKPOINT_CAPTURE_ERROR';

  constructor(
    readonly directoryRoot: string,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(`Failed to capture portable directory checkpoint from ${directoryRoot}: ${detail}`, options);
    this.name = 'PortableDirectoryCheckpointCaptureError';
  }
}

/** Raised when checkpoint file metadata, content, or paths cannot be trusted. */
export class PortableDirectoryCheckpointCorruptionError extends Error {
  readonly code = 'PORTABLE_DIRECTORY_CHECKPOINT_CORRUPTION';

  constructor(readonly detail: string, options?: ErrorOptions) {
    super(`Invalid portable directory checkpoint: ${detail}`, options);
    this.name = 'PortableDirectoryCheckpointCorruptionError';
  }
}

/** Raised when restore would merge with or overwrite a local directory. */
export class PortableDirectoryCheckpointRestoreTargetError extends Error {
  readonly code = 'PORTABLE_DIRECTORY_CHECKPOINT_RESTORE_TARGET_NOT_EMPTY';

  constructor(readonly directoryRoot: string) {
    super(`Portable directory checkpoint restore requires an absent or empty directory: ${directoryRoot}`);
    this.name = 'PortableDirectoryCheckpointRestoreTargetError';
  }
}
