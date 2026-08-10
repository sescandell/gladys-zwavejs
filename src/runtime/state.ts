/** One state waiting to be published, with the policy that drives batching. */
export interface PendingState {
  readonly featureExternalId: string
  readonly state: number
  /**
   * Only the latest value of a window matters (a temperature, a meter): the
   * publisher may coalesce it. Opt-in — see StatePublisher.
   */
  readonly sampled: boolean
  /** Every occurrence counts (a button press): never deduplicated. */
  readonly event: boolean
}
