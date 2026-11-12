import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'auth:public';

/** Opts a route out of authentication (health, login, and the operator endpoints that carry their own guard). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
