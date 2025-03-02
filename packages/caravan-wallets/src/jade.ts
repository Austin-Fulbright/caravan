import { DirectKeystoreInteraction, PENDING, ACTIVE, INFO } from './interaction'; // or your actual base class location
import { JadeAPI, getRootFingerprint, get_multisig_name} from 'jadejs-api';
import { BitcoinNetwork, ExtendedPublicKey, getPsbtVersionNumber, PsbtV2, MultisigAddressType} from "@caravan/bitcoin";
import { MultisigWalletConfig} from './types';


export const JADE = "jade";


function convertToMyMultisigVariant(
  addressType: MultisigAddressType,
  threshold: number
): string {
  switch (addressType) {
    case 'P2WSH':
      return `wsh(multi(${threshold}))`;
    case 'P2SH-P2WSH':
      return `sh(wsh(multi(${threshold})))`;
    default:
      throw new Error(`Unsupported multisig address type: ${addressType}`);
  }
}

function parseBip32Path(path_i: string): number[] {
  let path = path_i;
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

export class JadeInteraction extends DirectKeystoreInteraction {
  protected jadeApi: JadeAPI;

  protected rootFingerprint: string = "";

  constructor() {
    super();
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
      if (this.rootFingerprint === "") {
        const xpub = await this.jadeApi.getXpub("mainnet", [0, 0]);
        this.rootFingerprint = getRootFingerprint(xpub);
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
  //helper function to get MultisigWalletConfig into an object that can be accepted by jade register multisig function

convertMultisig(walletConfig: MultisigWalletConfig): any {
  return {
    network: walletConfig.network,
    multisig_name: walletConfig.name || "",
    descriptor: {
      variant: convertToMyMultisigVariant(
        walletConfig.addressType,
        walletConfig.quorum.requiredSigners
      ),
      sorted_keys: false,
      threshold: walletConfig.quorum.requiredSigners,
      signers: walletConfig.extendedPublicKeys.map(signer => ({
        fingerprint: signer.xfp,
        derivation: parseBip32Path(signer.bip32Path),
        xpub: signer.xpub,
        path: []
    }))
  }
  };
}

confirmMultisig(multisig_name: string): Promise<any> {
  return this.jadeApi.getRegisteredMultisig(multisig_name);
}

async registerMultisig(walletConfig: MultisigWalletConfig): Promise<any> {

  const multisigRegisterObject = this.convertMultisig(walletConfig);
  const jade_multisig_name = get_multisig_name(multisigRegisterObject);

  const {
    network,
    variant,
    sorted_keys,
    threshold,
    signers
  } = multisigRegisterObject;
  //need to get registered multisig by name to check and see if the multisig is already registered

  await this.jadeApi.registerMultisig(
    network,
    jade_multisig_name,
    variant,
    sorted_keys,
    threshold,
    signers
  );
  const result = await this.jadeApi.getRegisteredMultisig(jade_multisig_name);

  return { result };
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
      const path = parseBip32Path(this.bip32Path);
      const xpub = await this.jadeApi.getXpub(this.network, path);
      const publicKey = ExtendedPublicKey.fromBase58(xpub).pubkey;
      if (this.includeXFP) {
        return { publicKey, rootFingerprint: this.rootFingerprint };
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
        return { xpub, rootFingerprint: this.rootFingerprint };
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
      await this.registerMultisig(this.walletConfig);
    });
}

}

export class JadeConfirmMultisigAddress extends JadeInteraction {
  network: BitcoinNetwork;

  bip32Path: string;

  walletConfig: MultisigWalletConfig;


  constructor({ network, bip32Path, walletConfig}: {
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
      // Confirm the multisig configuration on the device
      const multisigScript = await this.confirmMultisig(this.walletConfig.name!);
      if (multisigScript!) {
        await this.registerMultisig(this.walletConfig);
      }
  
      // Extract path suffixes from extended public keys
      const paths = this.walletConfig.extendedPublicKeys.map(signer => {
        const pathComponents = signer.bip32Path.split('/').slice(1);
        return pathComponents.slice(-2).map(component => {
          if (component.endsWith("'")) {
            return parseInt(component.slice(0, -1), 10) + 0x80000000;
          }
          return parseInt(component, 10);
        });
      });
      // Request the receive address from the device
      const address = await this.jadeApi.getMultisigReceiveAddress(this.walletConfig.network, this.walletConfig.name!, paths);
  
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
        const rootFingerprint = this.rootFingerprint;
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
          const pubKey = bip32Derivation.key.substr(2);
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


