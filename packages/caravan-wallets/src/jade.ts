import { DirectKeystoreInteraction, PENDING, ACTIVE, INFO } from './interaction'; // or your actual base class location
import { JadeAPI } from 'jade-hw-api';
import { BitcoinNetwork, ExtendedPublicKey } from "@caravan/bitcoin";

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
      // Connect to the device.
      await this.jadeApi.connect();
  
      const httpRequestFn = async (params: any): Promise<{ body: any }> => {
        const url = params.urls[0];
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params.data),
        });
        if (!response.ok) {
          throw new Error('HTTP request failed in authUser');
        }
        const body = await response.json();
        return { body };
      };
  
      const unlockResult = await this.jadeApi.authUser("mainnet", httpRequestFn);
      if (unlockResult !== true) {
        throw new Error("Failed to unlock Jade device");
      }
  
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
export class JadeExportPublicKey extends JadeInteraction {

  network: BitcoinNetwork;
  
  bip32Path: string;

  includeXFP: boolean

  constructor({ network, bip32Path, includeXFP }: {
    network: BitcoinNetwork;
    bip32Path: string;
    includeXFP: boolean;
  }) {
    super();
    this.network = network;
    this.bip32Path = bip32Path;
    this.includeXFP = includeXFP;
  }
  //make sure network comes out right

  messages() {
    return super.messages();
  }

  async run() {
    return await this.withDevice(async (jadeApi)  => {
      //need to convert the bip32Path into an integer array
      const xpub = await jadeApi.getXpub(this.network, this.bip32Path);
      const publicKey = ExtendedPublicKey.fromBase58(xpub).pubKey;
      if (this.includeXFP) {
        const rootFingerprint = await jadeApi.rootFingerprint();
        return { publicKey, rootFingerprint };
      }
      return publicKey;

    });
  }
}
export class JadeExportExtendedPublicKey extends JadeInteraction {

  network: BitcoinNetwork;
  
  bip32Path: string;

  includeXFP: boolean

  constructor({ network, bip32Path, includeXFP }: {
    network: BitcoinNetwork;
    bip32Path: string;
    includeXFP: boolean;
  }) {
    super();
    this.network = network;
    this.bip32Path = bip32Path;
    this.includeXFP = includeXFP;
  }
  //make sure network comes out right

  messages() {
    return super.messages();
  }

  async run() {
    return await this.withDevice(async (jadeApi)  => {
      //need to convert the bip32Path into an integer array
      const xpub = await jadeApi.getXpub(this.network, this.bip32Path);
      if (this.includeXFP) {
        const rootFingerprint = await jadeApi.rootFingerprint();
        return { xpub, rootFingerprint };
      }
      return xpub;

    });
  }

}
export class JadeRegisterWalletPolicy extends JadeInteraction {

}

export class JadeConfirmMultisigAddress extends JadeInteraction{

}
export class JadeSignMultisigTransaction extends JadeInteraction{

}


