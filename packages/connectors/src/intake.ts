import { FeatureDisabled } from "./errors";

/** Placeholder for future EHR/CRM intake sync. Disabled until a compliant production integration exists. */
export interface IntakeConnector {
  status: "disabled";
  listChanges(): Promise<never>;
  sync(): Promise<never>;
}

export const disabledIntakeConnector: IntakeConnector = {
  status: "disabled",
  listChanges: async () => {
    throw new FeatureDisabled("Intake system sync");
  },
  sync: async () => {
    throw new FeatureDisabled("Intake system sync");
  },
};
