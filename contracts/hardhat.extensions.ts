import { ContractFactory } from "ethers";

declare module "ethers" {
  interface ContractFactory {
    getAddress(...args: any[]): Promise<string>;
  }
}

if (!(ContractFactory.prototype as any).getAddress) {
  ContractFactory.prototype.getAddress = async function (...args: any[]): Promise<string> {
    const contract = await this.deploy(...args);
    await contract.waitForDeployment();
    return contract.getAddress();
  };
}
