/** A subscription consumer fell behind the stream's bounded in-memory buffer. */
export class RuntimeSubscriptionOverflowError extends Error {
  readonly code = 'RUNTIME_SUBSCRIPTION_OVERFLOW';

  constructor(
    readonly maxBufferedEvents: number,
    readonly bufferedEvents: number,
  ) {
    super(
      `Runtime subscription consumer exceeded the ${maxBufferedEvents}-event buffer. Reconnect and replay from the last acknowledged cursor when the source supports replay.`,
    );
    this.name = 'RuntimeSubscriptionOverflowError';
  }
}
