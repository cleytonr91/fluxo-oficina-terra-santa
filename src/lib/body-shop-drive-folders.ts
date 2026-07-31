import type { BodyShopProcess } from "@/types/domain";

export const BODY_SHOP_DRIVE_ROOT_URL =
  "https://drive.google.com/drive/folders/1Dlv-T0GQKwMPd-2bSfOZEfAaWR7IH5xA";

const folderIdsByPlate: Record<string, string> = {
  "QMA-2228": "1HTREKK_gafMk67s7XY92zBhYyCM8yK8r",
  "QMG-5538": "1-umMadhIac6DFoi7F06b3sscbcS8Q01L",
  "QMH-0789": "1kXVQtIayCgb-2GivDXzWgeTDDfyc0knj",
  "QMJ-3A67": "1fWXg1QjbgND66TFEdQo2TeOyFRoKPWUw",
  "QMJ-9D72": "1Wpo3l7aN4srcIBWGffvIi7UvRumAsTxH",
  "QMM-7I27": "106KUue1YBsSY_eiR5FyRr6ULLV1X4AnD",
  "QMO-5D95": "1WvSbwSY5vvoCoYOkdsIN98slHgtKQ1du",
  "QMO-6E26": "1oT00dWuiQs9bNcE3NRG87F7kGd_cGQm3",
  "QMO-6E33": "1mJqw83AyIjfVLOE1wNk0HichL5MmDw8l",
  "QMP-0A90": "1_881VxgGIUDZrg949HduK6RWyEcB2nYj",
  "QMP-8E05": "1LS19S9msXTbeU9rjVGuPCwenpYjGwgda",
  "RQW-9D94": "1MUWLORG8ZkamY83AnnOPl_vsEesviruo",
  "RQX-1E46": "1vkEWPmK86SQQNpQHf-uELp61fAEqv78w",
  "RQY-4J53": "1407Rm1gWOCGkvvyrCPFXrHCpYItGeB_o",
  "RQY-7G30": "1rpD5so2Zt2rQp2wZLla3tEWrOEmV03hy",
  "RQZ-0I38": "1nhkNZjTWkIPtxTLGlBfuaXjGbtaWqStj",
  "RQZ-0I40": "1Lw24LpicwdXjBHEoZFHAIcB-sItxX6uq",
  "RQZ-9F81": "1g3uJhyX3lP8VlSZ94fiBruF8h2J_TxgX",
  "RRA-2D75": "1WQbSRFJ4wzM78TpRkb6UufLsw-iYsRi_",
  "RRA-5D16": "1D8QWmqSAVurXriP-lliOncS5-lc3SAww",
  "RRA-6I65": "1uylpqEQmmGz5axMlhyChECBWt-_JilPu",
  "RRA-7B25": "18C7qC3Y5fQ9nlJKvjm-8lIy3c4Z70oo2",
  "RRB-4C30": "1Lamh7cUeDOCI-nyoZ3VznZzaMK3_6zqk",
  "RRB-6A14": "1M_gprty7EI82s_XwKVAtgS5uOrsFC_Ql",
  "RRC-4B41": "1GGwKkudIXE_kSC8OZkHw9pv7iOhC9Q4d",
  "RRC-4E71": "1xxgrQkCEpNm7VPoSeS-J1Q81nUuFOTet",
  "RRC-6A39": "1NAhHuFY_abieRECfNzUQXU9dqKdsUxae",
  "RRE-1F54": "1fzNgNL8eL5KvlznvvMYIHQ2_9Wf2yhy-",
  "RRF-0C08": "1zllwx-HS89-zRzAKglY5G4eLIgBz8Xdo",
  "RRF-3C63": "1SqR0OQfdm0czYiyM4nDfnu3X-_sizxOY",
  "RRF-7H70": "1mL8vU2W1GItAzIk69KAEfB-S5XxM56M7",
  "RRG-1A44": "1k0a0_HEtMuOgsKVxIrUzygrtngVB7u7E",
  "RRH-4D88": "1VxxINFv84lK4qzsr9hQlCZcZn7ENYJuo",
  "RRH-4J93": "1sswxkbCsRQxKY9Xd0JGS8wq0mTspVg2P",
  "RRH-6E60": "15q12thhRQ6ctH0zxs1dkEt3wSFtaC2bu",
  "RRH-9A67": "1WFvgyySo4JWhCg37CfrKL4MjF--uXhSY",
  "RTU-8B26": "1bLjP1eIV4j4NBzuamVCqiP3tUzCYbulJ",
  "TNU-4A99": "1YWD25OW7AWJZgsDni2wQayPkTFum2ii7",
  "TNU-8A33": "1ctu-aJioaoe9ft3T8cOXQP1zCGY9bpEF",
  "TNU-9C91": "1kGiE4kIIP0rMQ0mB4U2-syzwNIgey1-2",
  "TNV-1E03": "17i0XKr8mqO78g0V7-HiJxEG1qcz76Nvr",
  "TNV-3H19": "1p14YOwHvkn8PdMdhcHQPTTYX0846YkQh",
  "TNV-5B70": "1pMMjQzDZeE-RM7hcweblhCFSu7b6bX69",
  "TNV-5H36": "1h9i7Fwt5G9548r4STEB8x-10xMPBr-HS",
  "TNW-3D18": "1wa6I_f25vNA3hrsNXy46aZsNEhO0xj0_",
  "TNW-7E51": "1kibq3CHxuProolBCyK-CwGOQx1MkLJMj",
  "TNW-7E75": "1Bo6SmuAFGPNR_KUt6c5Ks6fDLLaCxnwf",
  "TNZ-7G71": "1pQXfN5MDekqzR3bWrZqw-6SnkrCXqMey",
};

const folderIdsByServiceOrder: Record<string, string> = {
  "41398": "1J9Ddmt8YqE_5MNCCYCElDdoXmINQTlOR",
};

function normalizePlate(value?: string) {
  const plate = (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return plate.length === 7 ? `${plate.slice(0, 3)}-${plate.slice(3)}` : plate;
}

export function getBodyShopDriveFolder(process: BodyShopProcess) {
  const plate = normalizePlate(process.plate);
  const folderId = folderIdsByServiceOrder[process.serviceOrder ?? ""] ?? folderIdsByPlate[plate];

  return {
    folderName: process.serviceOrder === "41398" ? `${plate} 2° Sinistro` : plate || "Documentos",
    isDirect: Boolean(folderId),
    url: folderId
      ? `https://drive.google.com/drive/folders/${folderId}`
      : BODY_SHOP_DRIVE_ROOT_URL,
  };
}
