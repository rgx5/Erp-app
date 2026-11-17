import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ENV, type Env } from '../../config/env.js';
import { Public } from '../http/public.js';

/** What a client needs to know before anyone has signed in: that this is a OneSyncERP server, its API version and how it lets people in. */
@ApiTags('meta')
@Public()
@Controller('v1/meta')
export class MetaController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  meta() {
    return {
      app: 'onesync-erp',
      apiVersion: 'v1',
      auth: { passwordLogin: true, mfa: true, apiKeys: true, selfSignup: this.env.SELF_SIGNUP_ENABLED === true },
      limits: { requestBodyBytes: this.env.REQUEST_BODY_LIMIT_BYTES },
      time: new Date().toISOString(),
    };
  }
}
