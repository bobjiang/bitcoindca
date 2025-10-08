import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";
import { http } from "viem";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "";

if (!projectId) {
  console.warn(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set. Get one at https://cloud.walletconnect.com"
  );
}

export const config = getDefaultConfig({
  appName: "Bitcoin DCA",
  projectId,
  chains: [
    ...(process.env.NEXT_PUBLIC_CHAIN_ID === "1" ? [mainnet] : []),
    sepolia,
  ],
  transports: {
    [mainnet.id]: http(
      alchemyApiKey
        ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`
        : undefined
    ),
    [sepolia.id]: http(
      alchemyApiKey
        ? `https://eth-sepolia.g.alchemy.com/v2/${alchemyApiKey}`
        : undefined
    ),
  },
  ssr: true,
});
