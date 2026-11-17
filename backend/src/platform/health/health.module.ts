import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MetaController } from './meta.controller.js';
import { HealthController } from './health.controller.js';

@Module({ imports: [TerminusModule], controllers: [HealthController, MetaController] })
export class HealthModule {}
