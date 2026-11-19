import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';
import { Recorder } from '../masterdata/helpers.js';
import { SitesController, SitesService } from './sites.js';

@Module({
  controllers: [OrganizationController, SitesController],
  providers: [OrganizationService, SitesService, Recorder],
  exports: [OrganizationService, SitesService],
})
export class OrganizationModule {}
