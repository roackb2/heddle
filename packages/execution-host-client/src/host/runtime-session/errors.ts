export class RuntimeExecutionPreparationError extends Error {
  readonly name = 'RuntimeExecutionPreparationError';

  constructor(
    readonly category: RuntimeExecutionPreparationCategory,
    options: { cause?: unknown } = {},
  ) {
    super('The agent execution dependency could not be prepared.', options);
  }
}

export type RuntimeExecutionPreparationCategory =
  | 'authority'
  | 'configuration'
  | 'contract'
  | 'dependency';

export class RuntimeBusyError extends Error {
  readonly name = 'RuntimeBusyError';
}

export class RuntimeDuplicateInvocationError extends Error {
  readonly name = 'RuntimeDuplicateInvocationError';
}

export class RuntimeDeadlineError extends Error {
  readonly name = 'RuntimeDeadlineError';
}

export class RuntimeScopeMismatchError extends Error {
  readonly name = 'RuntimeScopeMismatchError';
}
