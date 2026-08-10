export const collections = {
  users: "users",
  importBatches: "importBatches",
  appointments: "appointments",
  preparations: "preparations",
  vehiclesFlow: "vehiclesFlow",
  walkInCustomers: "walkInCustomers",
  flowEvents: "flowEvents",
  complementaryBudgets: "complementaryBudgets",
  partOrders: "partOrders",
  partsCatalog: "partsCatalog",
  publicPartLookups: "publicPartLookups",
  deliveries: "deliveries",
  postServiceCases: "postServiceCases",
  hgsiRecords: "hgsiRecords",
  hgsiAnswers: "hgsiAnswers",
  bodyShopProcesses: "bodyShopProcesses",
  partsCounterEntries: "partsCounterEntries",
  partsSalesGoals: "partsSalesGoals",
} as const;

export type CollectionName = (typeof collections)[keyof typeof collections];
