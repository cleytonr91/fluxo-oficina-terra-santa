type ItemIdentity = {
  id: string;
  chassi?: string;
  osNumber?: string;
};

type PostCaseIdentity = {
  vehicleFlowId: string;
  chassi?: string;
  osNumber?: string;
};

function normalizeChassi(value?: string) {
  return (value ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function uniqueIdentityKeys(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

export function itemIdentityKeys(item: ItemIdentity) {
  const chassi = normalizeChassi(item.chassi);
  const osNumber = item.osNumber?.trim();
  return uniqueIdentityKeys([chassi || osNumber || item.id, chassi, osNumber, item.id]);
}

export function postCaseIdentityKeys(postCase: PostCaseIdentity) {
  return uniqueIdentityKeys([
    postCase.vehicleFlowId,
    normalizeChassi(postCase.chassi),
    postCase.osNumber,
  ]);
}

export function hasSharedIdentity(firstKeys: string[], secondKeys: string[]) {
  const second = new Set(secondKeys);
  return firstKeys.some((key) => second.has(key));
}
