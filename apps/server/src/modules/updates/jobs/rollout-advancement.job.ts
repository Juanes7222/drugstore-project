import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UpdatesService } from '../updates.service';

/**
 * Scheduled job that evaluates all active phased rollouts every hour and
 * advances or pauses them based on telemetry success rates.
 */
@Injectable()
export class RolloutAdvancementJob {
  private readonly logger = new Logger(RolloutAdvancementJob.name);

  constructor(private readonly updatesService: UpdatesService) {}

  /**
   * Run every hour to evaluate rollout progress.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleRolloutAdvancement() {
    this.logger.log('Evaluating rollout advancement...');
    try {
      const results = await this.updatesService.evaluateRollouts();
      for (const result of results) {
        this.logger.log(`Rollout ${result.versionId}: ${result.action}`);
      }
    } catch (err) {
      this.logger.error(
        'Rollout advancement evaluation failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
