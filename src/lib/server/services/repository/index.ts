export { DrizzleTermixServicesRepository } from './drizzle';
export { InMemoryTermixServicesRepository } from './memory';

import { DrizzleTermixServicesRepository } from './drizzle';

export const termixRepository = new DrizzleTermixServicesRepository();
