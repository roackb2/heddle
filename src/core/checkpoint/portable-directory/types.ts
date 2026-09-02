export type PortableDirectoryCheckpointLimits = Readonly<{
  maxFileCount: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}>;

export type PortableDirectoryCheckpointPolicyOptions = {
  limits: PortableDirectoryCheckpointLimits;
  includeFile: (relativePath: string) => boolean;
  /** Defaults to `reject`; `exclude` exists only for versioned compatibility policies. */
  unsafePathBehavior?: 'reject' | 'exclude';
};
