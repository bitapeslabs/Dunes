export const validators = {
  validInt: (n: string): boolean => {
    return !isNaN(n as unknown as number) && Number(n) >= 0;
  },

  validTransactionHash: (hash: string): boolean => {
    const regex = /^[a-fA-F0-9]{64}$/;
    return regex.test(hash);
  },

  validProtocolId: (protocolId: string): boolean => {
    const parts = protocolId.split(":");
    return parts.length === 2 && parts.every((p) => /^\d+$/.test(p));
  },
};
