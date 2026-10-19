export class FeatureDisabled extends Error {
  readonly code = "FEATURE_DISABLED" as const;
  constructor(feature: string) {
    super(`${feature} is disabled in the CareFlow MVP (synthetic sandbox only)`);
  }
}
