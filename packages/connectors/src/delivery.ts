import { FeatureDisabled } from "./errors";

/** Outbound delivery is never enabled in the MVP: `send` always throws. */
export interface DeliveryProvider {
  preview(input: { title: string; bodyMd: string }): { channel: string; rendered: string };
  send(input: { title: string; bodyMd: string; to?: string }): Promise<never>;
}

export const disabledDeliveryProvider: DeliveryProvider = {
  preview: ({ title, bodyMd }) => ({ channel: "local_preview", rendered: `# ${title}\n\n${bodyMd}` }),
  send: async () => {
    throw new FeatureDisabled("Sending email/messages");
  },
};
