import { DirectKeystoreInteraction, PENDING, ACTIVE, INFO } from './interaction'; // or your actual base class location
import { JadeAPI } from 'jade-hw-api';


export const JADE = "jade";

/**
 * Base class for interactions with Jade hardware.
 * This class wraps a JadeAPI instance and provides helper methods
 * to perform operations on the device.
 */
export class JadeInteraction extends DirectKeystoreInteraction {
  protected jadeApi: JadeAPI;

  constructor() {
    super();
    // For now, we create a JadeAPI instance using defaults.
    // You can extend this constructor to accept device info if needed.
    this.jadeApi = JadeAPI.createSerial();
  }

  /**
   * Provides a list of status messages for the UI.
   */
  messages() {
    const messages = super.messages();
    messages.push({
      state: PENDING,
      level: INFO,
      text: "Please connect your Jade device.",
      code: "device.setup",
    });
    messages.push({
      state: ACTIVE,
      level: INFO,
      text: "Communicating with Jade...",
      code: "device.active",
    });
    return messages;
  }

  /**
   * Establish a connection to the Jade device, execute the callback,
   * and then disconnect. This abstracts the device lifecycle.
   * @param f Callback function that receives the JadeAPI instance.
   */
  async withDevice<T>(f: (jadeApi: JadeAPI) => Promise<T>): Promise<T> {
    try {
      await this.jadeApi.connect();
      //add code to unlock the device using authUser
      try {
        return await f(this.jadeApi);
      } finally {
        await this.jadeApi.disconnect();
      }
    } catch (err: any) {
      throw new Error("Error interacting with Jade device: ", err.message);
    }
  }

  // Dummy run method to satisfy abstract interface requirements.
  async run(): Promise<any> {
    return null;
  }
}

/**
 * Interaction class for fetching Jade device metadata.
 */
export class JadeGetMetadata extends JadeInteraction {
  async run(): Promise<{
    spec: string;
    version: { major: string; minor: string; patch: string; string: string };
    model: string;
  }> {
    return this.withDevice(async (jadeApi: JadeAPI) => {
      const versionInfo = await jadeApi.getVersionInfo();
      const version = versionInfo.JADE_VERSION || "";
      const [major, minor, patch] = version.split(".");
      return {
        spec: `Jade v${version}`,
        version: {
          major: major || "",
          minor: minor || "",
          patch: patch || "",
          string: version,
        },
        model: versionInfo.BOARD_TYPE,
      };
    });
  }
}
