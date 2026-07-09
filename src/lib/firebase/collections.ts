export const collections = {
  users: "users",
  importBatches: "importBatches",
  appointments: "appointments",
  preparations: "preparations",
  vehiclesFlow: "vehiclesFlow",
  walkInCustomers: "walkInCustomers",
  flowEvents: "flowEvents",
  complementaryBudgets: "complementaryBudgets",
  deliveries: "deliveries",
  postServiceCases: "postServiceCases",
  hgsiRecords: "hgsiRecords",
  hgsiAnswers: "hgsiAnswers",
} as const;

export type CollectionName = (typeof collections)[keyof typeof collections];
