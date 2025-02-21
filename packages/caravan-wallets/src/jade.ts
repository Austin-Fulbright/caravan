import { DirectKeystoreInteraction, PENDING, ACTIVE, INFO } from './interaction'; // or your actual base class location
import { JadeAPI } from 'jade-hw-api';
import { BitcoinNetwork, ExtendedPublicKey, getPsbtVersionNumber, PsbtV2, MultisigAddressType} from "@caravan/bitcoin";
import { MultisigWalletConfig } from './types';
import { BtcScriptConfig } from 'bitbox-api';


export const JADE = "jade";


/**
 * Converts a BIP32 path string (e.g., "m/49'/0'/0'/0/143") into an array
 * of unsigned 32-bit integers. Hardened indices are represented by adding 2^31.
 *
 * @param path - The BIP32 path string.
 * @returns An array of numbers representing the path.
 * @throws An error if any segment cannot be parsed as a number.
 */
export function parseBip32Path(path: string): number[] {
  if (path.startsWith('m/')) {
    path = path.substring(2);
  } else if (path.startsWith('m')) {
    path = path.substring(1);
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
  }
  const segments = path.split('/');
  const result: number[] = [];
  for (const segment of segments) {
    // Check if the segment is hardened (ends with "'" or "h")
    let hardened = false;
    let numStr = segment;
    if (segment.endsWith("'") || segment.endsWith("h")) {
      hardened = true;
      numStr = segment.slice(0, -1);
    }
    const index = parseInt(numStr, 10);
    if (isNaN(index)) {
      throw new Error(`Invalid path segment: ${segment}`);
    }
    // Hardened index = index + 0x80000000 (2^31)
    result.push(index + (hardened ? 0x80000000 : 0));
  }
  return result;
}
/**
 * Base class for interactions with Jade hardware.
 * This class wraps a JadeAPI instance and provides helper methods
 * to perform operations on the device.
 */
//TODO - possibly change around api so that you create a device class/object that you can pass around to functions outside classes
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
      //TODO - figure out how to tell the user to enter the pin in the jade device
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

  async convertMultisig(walletConfig: MultisigWalletConfig): Promise<{ scriptConfig: BtcScriptConfig; keypathAccount: string; }> {
    const ourRootFingerprint = await this.jadeApi.getRootFingerprint();
  
    const ourXpubIndex = walletConfig.extendedPublicKeys.findIndex(key => key.xfp == ourRootFingerprint);
    if (ourXpubIndex === -1) {
      throw new Error('This BitBox02 seems to not be present in the multisig quorum.');
    }
    const scriptConfig = {
      multisig: {
        threshold: walletConfig.quorum.requiredSigners,
        scriptType: walletConfig.addressType,
        xpubs: walletConfig.extendedPublicKeys.map(key => key.xpub),
        ourXpubIndex,
      },
    };
    const keypathAccount = walletConfig.extendedPublicKeys[ourXpubIndex].bip32Path;
    return {
      scriptConfig,
      keypathAccount,
    }
  }


  //TODO - add the jade device object as a parameter and pass it through
  async maybeRegisterMultisig(walletConfig: MultisigWalletConfig): Promise<{ scriptConfig: BtcScriptConfig, keypathAccount: string; }> {
    // create the convert multisig function that will return the scriptConfig and keypathaccount
    const {scriptConfig, keypathAccount } = await this.convertMultisig(walletConfig);
    const isRegistered = await this.jadeApi.scriptConfigRegistered(
      walletConfig.network,
      scriptConfig,
      keypathAccount
    )

    if (!isRegistered) {
      await this.jadeApi.registerMultisig(
        walletConfig.network,
        scriptConfig,
        keypathAccount,
      );
    }

    return {scriptConfig, keypathAccount};

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
    return await this.withDevice(async ()  => {
      //need to convert the bip32Path into an integer array
      const path = parseBip32Path(this.bip32Path)
      const xpub = await this.jadeApi.getXpub(this.network, path);
      const publicKey = ExtendedPublicKey.fromBase58(xpub).pubKey;
      if (this.includeXFP) {
        const rootFingerprint = await this.jadeApi.getRootFingerprint();
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
    return await this.withDevice(async ()  => {
      const path = parseBip32Path(this.bip32Path)
      const xpub = await this.jadeApi.getXpub(this.network, path);
      if (this.includeXFP) {
        //TODO - need to add root fingerprint or get xfp to the jade-hw-api
        const rootFingerprint = await this.jadeApi.getRootFingerprint();
        return { xpub, rootFingerprint };
      }
      return xpub;

    });
  }

}
export class JadeRegisterWalletPolicy extends JadeInteraction {

  walletConfig: MultisigWalletConfig;


  constructor({
    walletConfig
  }: {
    walletConfig: MultisigWalletConfig;
  }) {
    super();
    this.walletConfig = walletConfig;
  }

  message() {
    const messages = super.messages();
    return messages;
  }

  async run() {
    return await this.withDevice(async () => {
      await this.maybeRegisterMultisig(this.walletConfig);
    });
}

}

export class JadeConfirmMultisigAddress extends JadeInteraction {
  network: BitcoinNetwork;

  bip32Path: string;

  walletConfig: MultisigWalletConfig;

  constructor({ network, bip32Path, walletConfig }: {
    network: BitcoinNetwork;
    bip32Path: string;
    walletConfig: MultisigWalletConfig;
  }) {
    super();
    this.network = network;
    this.bip32Path = bip32Path;
    this.walletConfig = walletConfig;
  }

  /**
   * Adds messages about BIP32 path warnings.
   */
  messages() {
    const messages = super.messages();
    return messages;
  }

  async run() {
    return await this.withDevice(async () => {
      const { scriptConfig } = await this.maybeRegisterMultisig(this.walletConfig);
      const address = await this.jadeApi.getBitcoinAddress(
        this.network,
        this.bip32Path,
        scriptConfig
      );
      return {
        address,
        serializedPath: this.bip32Path,
      };
    });
  }
}

function parsePsbt(psbt: string): PsbtV2 {
  const psbtVersion = getPsbtVersionNumber(psbt);
  switch (psbtVersion) {
    case 0:
      return PsbtV2.FromV0(psbt, true);
    case 2:
      return new PsbtV2(psbt);
    default:
      throw new Error(`PSBT of unsupported version ${psbtVersion}`);
  }
}
export class JadeSignMultisigTransaction extends JadeInteraction {
  private walletConfig: MultisigWalletConfig;

  private returnSignatureArray: boolean;

  // keeping this until we have a way to add signatures to psbtv2 directly
  // this will store the the PSBT that was was passed in via args
  private unsignedPsbt: string;

  constructor({
    walletConfig,
    psbt,
    returnSignatureArray = false,
  }: {
    walletConfig: MultisigWalletConfig;
    psbt: any;
    returnSignatureArray: boolean;
  }) {
    super();
    this.walletConfig = walletConfig;
    this.returnSignatureArray = returnSignatureArray;

    this.unsignedPsbt = Buffer.isBuffer(psbt) ? psbt.toString("base64") : psbt;
  }

  async run() {
    return await this.withDevice(async () => {
      const signedPsbt = await this.jadeApi.signPSBT(
        this.walletConfig.network,
        this.unsignedPsbt
      );
      if (this.returnSignatureArray) {
        const rootFingerprint = await this.jadeApi.getRootFingerprint();
        const parsedPsbt = parsePsbt(signedPsbt);
        let sigArray: string[] = [];
        for (let i = 0; i < parsedPsbt.PSBT_GLOBAL_INPUT_COUNT; i++) {
          const bip32Derivations = parsedPsbt.PSBT_IN_BIP32_DERIVATION[i];
          if (!Array.isArray(bip32Derivations)) {
            throw new Error('bip32 derivations expected to be an array');
          }
          const bip32Derivation = bip32Derivations.find(entry => entry.value!.substr(0, 8) == rootFingerprint);
          if (!bip32Derivation) {
            throw new Error('could not find our pubkey in the signed PSBT');
          }
          // First byte of the key is 0x06, the PSBT key.
          const pubKey = bip32Derivation.key.substr(2);
          // First byte of the key is 0x02, the PSBT key.
          const partialSig = parsedPsbt.PSBT_IN_PARTIAL_SIG[i].find(e => e.key.substr(2) === pubKey);
          if (!partialSig) {
            throw new Error('could not find our signature in the signed PSBT');
          }
          sigArray.push(partialSig.value!);
        }

        return sigArray;
      }
      return signedPsbt;
    });
  }
}


