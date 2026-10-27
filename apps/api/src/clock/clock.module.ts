import { Module } from '@nestjs/common';
import { ClockController } from './clock.controller.js';
import { ClockService } from './clock.service.js';

@Module({ controllers: [ClockController], providers: [ClockService], exports: [ClockService] })
export class ClockModule {}
